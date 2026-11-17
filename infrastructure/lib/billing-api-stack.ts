/**
 * MerchOS Billing API Stack
 *
 * Provisions the subscription / credit / payment (PayFast) API:
 * - DynamoDB billing table (single-table, `TENANT#<id>` partition), CMK-encrypted
 * - Secrets Manager secret holding the PayFast merchant credentials
 * - HTTP API (v2) with Cognito JWT authorizer on the seller routes
 *     GET  /billing                -> BillingOverview
 *     GET  /billing/invoices       -> InvoiceSummary[]
 *     POST /billing/plan           -> PayFast hosted-checkout redirect
 *     POST /billing/payfast/itn    -> PayFast ITN webhook (NO JWT — PayFast
 *                                     cannot present one; authenticity is
 *                                     verified by signature inside the handler)
 * - Least-privilege IAM per Lambda
 * - SSM parameter exports for cross-stack references
 *
 * Lessons from earlier stacks baked in up front: ESM createRequire banner,
 * COGNITO_ISSUER for rbacMiddleware, KMS access on every role that touches the
 * CMK-encrypted table, and Powertools bundled (no Lambda layer).
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export interface BillingApiStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.UserPool;
  sellerDashboardClient: cognito.UserPoolClient;
  platformKey: kms.Key;
}

export class BillingApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;
  public readonly billingTable: dynamodb.Table;
  public readonly payfastSecret: secretsmanager.Secret;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: BillingApiStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const ssmPrefix = `/merch-os/${env}`;

    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'Billing');
    cdk.Tags.of(this).add('TenantScope', 'tenant');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // Deploy-time settings (CDK context, with safe defaults)
    // -----------------------------------------------------------------------

    // 'sandbox' until live PayFast credentials are deliberately switched on.
    const payfastMode =
      (this.node.tryGetContext('payfastMode') as string | undefined) ?? 'sandbox';
    // Launch gate for starting checkouts. Closed unless explicitly opened with
    // `--context checkoutEnabled=true` (prices are placeholders until finalised).
    const checkoutEnabled =
      String(this.node.tryGetContext('checkoutEnabled') ?? 'false') === 'true' ? 'true' : 'false';
    // Where PayFast sends the buyer back to (the seller-dashboard origin).
    const appBaseUrl =
      (this.node.tryGetContext('appBaseUrl') as string | undefined) ??
      `https://${env === 'production' ? 'app' : env}.merchos.io`;

    // -----------------------------------------------------------------------
    // DynamoDB — billing table
    //
    // All items live under PK = TENANT#<tenantId>:
    //   SK = SUBSCRIPTION#current   current subscription
    //   SK = CREDITS#<yyyyMM>       monthly credit ledger
    //   SK = PAYMENT#<mPaymentId>   payment idempotency record
    //   SK = INVOICE#<invoiceId>    invoice records
    // -----------------------------------------------------------------------

    this.billingTable = new dynamodb.Table(this, 'BillingTable', {
      tableName: `merch-os-billing-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      pointInTimeRecovery: true,
      // Unpaid CHECKOUT#<id> intents carry a `ttl` (epoch seconds) and expire on
      // their own; payment/subscription/credit/invoice records have no ttl.
      timeToLiveAttribute: 'ttl',
      // Billing records are financial data — never delete with the stack.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // Secrets Manager — PayFast merchant credentials
    //
    // JSON: { "merchantId": "...", "merchantKey": "...", "passphrase": "..." }
    // Created with a generated placeholder value; the real values are written
    // out-of-band (aws secretsmanager put-secret-value) so they never touch
    // source control or the CloudFormation template. Read by the Lambdas at
    // runtime, never placed in Lambda environment variables.
    // -----------------------------------------------------------------------

    this.payfastSecret = new secretsmanager.Secret(this, 'PayFastSecret', {
      secretName: `merch-os/${env}/payfast`,
      description: 'PayFast merchant credentials (merchantId, merchantKey, passphrase)',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // HTTP API + JWT authorizer
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'BillingHttpApi', {
      apiName: `merch-os-billing-api-${env}`,
      description: 'MerchOS Billing API — subscriptions, credits and PayFast payments',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowOrigins: [
          `https://${env === 'production' ? 'app' : env}.merchos.io`,
          ...(env === 'production' ? [] : ['http://localhost:3000']),
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Default stage throttle (also bounds ITN webhook abuse).
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as
      | cdk.aws_apigatewayv2.CfnStage
      | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 50,
        throttlingRateLimit: 25,
      };
    }

    const jwtAuthorizer = new HttpJwtAuthorizer(
      'BillingCognitoJwtAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      { jwtAudience: [props.sellerDashboardClient.userPoolClientId] }
    );

    // -----------------------------------------------------------------------
    // Shared Lambda configuration (ESM bundling)
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/billing/api/handlers');

    const commonEnv: Record<string, string> = {
      ENVIRONMENT: env,
      BILLING_TABLE: this.billingTable.tableName,
      // rbacMiddleware validates the token issuer against this value; without it
      // every token is rejected with INVALID_ISSUER (401).
      COGNITO_ISSUER: `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      PAYFAST_SECRET_ARN: this.payfastSecret.secretArn,
      PAYFAST_MODE: payfastMode,
      CHECKOUT_ENABLED: checkoutEnabled,
      APP_BASE_URL: appBaseUrl,
      POWERTOOLS_SERVICE_NAME: 'billing',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'DEBUG',
    };

    const defaultLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: commonEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        // CJS dependencies doing require('util') crash an ESM bundle at INIT with
        // "Dynamic require not supported". Inject a real require (same fix as the
        // Supplier / Product Intelligence / Image stacks).
        banner: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
      },
    };

    // -----------------------------------------------------------------------
    // IAM statements — least privilege
    // -----------------------------------------------------------------------

    // TenantDynamoClient uses Get/Put/Update/Query only (no delete, no scan).
    const billingTableAccess = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [this.billingTable.tableArn, `${this.billingTable.tableArn}/index/*`],
    });
    const billingTableReadOnly = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [this.billingTable.tableArn, `${this.billingTable.tableArn}/index/*`],
    });
    // The table is encrypted with the platform CMK — every role touching it needs this.
    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });
    const payfastSecretRead = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [this.payfastSecret.secretArn],
    });

    const createLambda = (
      logicalId: string,
      entry: string,
      policyStatements: iam.PolicyStatement[]
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for Billing ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });
      for (const statement of policyStatements) role.addToPolicy(statement);

      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        ...defaultLambdaProps,
        functionName: `merch-os-billing-${logicalId.toLowerCase()}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // Lambdas
    // -----------------------------------------------------------------------

    const getBillingFn = createLambda('GetBilling', path.join(handlersPath, 'get-billing.ts'), [
      billingTableReadOnly,
      kmsPolicy,
    ]);

    const listInvoicesFn = createLambda(
      'ListInvoices',
      path.join(handlersPath, 'list-invoices.ts'),
      [billingTableReadOnly, kmsPolicy]
    );

    // change-plan writes the pending subscription intent and reads the PayFast secret.
    const changePlanFn = createLambda('ChangePlan', path.join(handlersPath, 'change-plan.ts'), [
      billingTableAccess,
      kmsPolicy,
      payfastSecretRead,
    ]);

    // ITN activates subscriptions, records payments and grants credits.
    const payfastItnFn = createLambda('PayfastItn', path.join(handlersPath, 'payfast-itn.ts'), [
      billingTableAccess,
      kmsPolicy,
      payfastSecretRead,
    ]);

    // -----------------------------------------------------------------------
    // Routes
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/billing',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetBillingIntegration', getBillingFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/billing/invoices',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListInvoicesIntegration', listInvoicesFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/billing/plan',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ChangePlanIntegration', changePlanFn),
      authorizer: jwtAuthorizer,
    });

    // PayFast ITN webhook — intentionally NO authorizer. PayFast calls this
    // server-to-server and cannot present a Cognito JWT. The handler verifies the
    // MD5 signature, payment status, expected amount and idempotency itself.
    this.httpApi.addRoutes({
      path: '/billing/payfast/itn',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('PayfastItnIntegration', payfastItnFn),
    });

    // -----------------------------------------------------------------------
    // Payment monitoring
    //
    // Every alarm notifies one SNS topic. Pass `--context billingAlarmEmail=you@x`
    // to subscribe an address (AWS emails a confirmation link first).
    //
    // Signals come from the handlers' structured (Powertools JSON) log lines, so
    // each alarm maps to a specific, actionable failure:
    //   - ItnErrors:        unhandled ITN error -> 5xx; PayFast retries, but a
    //                       paid seller may not be activated yet.
    //   - ItnRetrying:      we could not complete verification (PayFast/DNS
    //                       unreachable) and asked PayFast to retry.
    //   - ItnRejected:      a notification failed signature/IP/postback checks.
    //                       At our volume any rejection is worth a look: a real
    //                       PayFast ITN failing here is a lost activation.
    //   - ItnAnomaly:       amount mismatch, unknown checkout, missing tenant or
    //                       payment id - tampering or a bug.
    //   - CheckoutErrors:   sellers cannot start a checkout.
    // -----------------------------------------------------------------------

    this.alarmTopic = new sns.Topic(this, 'BillingAlarmTopic', {
      topicName: `merch-os-billing-alarms-${env}`,
      displayName: `MerchOS billing alarms (${env})`,
    });
    const alarmEmail = this.node.tryGetContext('billingAlarmEmail') as string | undefined;
    if (alarmEmail) {
      this.alarmTopic.addSubscription(new snsSubs.EmailSubscription(alarmEmail));
    }
    const notify = new cwActions.SnsAction(this.alarmTopic);

    const metricNamespace = `MerchOS/Billing/${env}`;
    const itnLogGroup = logs.LogGroup.fromLogGroupName(
      this,
      'PayfastItnLogGroup',
      `/aws/lambda/${payfastItnFn.functionName}`
    );

    /** Counts log lines whose JSON `message` is one of `messages`. */
    const logCountMetric = (id: string, metricName: string, messages: string[]): cloudwatch.Metric => {
      new logs.MetricFilter(this, id, {
        logGroup: itnLogGroup,
        metricNamespace,
        metricName,
        filterPattern: logs.FilterPattern.any(
          ...messages.map((m) => logs.FilterPattern.stringValue('$.message', '=', m))
        ),
        metricValue: '1',
        defaultValue: 0,
      });
      return new cloudwatch.Metric({
        namespace: metricNamespace,
        metricName,
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.minutes(5),
      });
    };

    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string
    ): void => {
      const a = new cloudwatch.Alarm(this, id, {
        alarmName: `merch-os-billing-${id}-${env}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(notify);
      a.addOkAction(notify);
    };

    alarm(
      'ItnErrors',
      payfastItnFn.metricErrors({ period: cdk.Duration.minutes(5), statistic: cloudwatch.Stats.SUM }),
      1,
      'PayFast ITN Lambda threw. PayFast will retry, but a paid seller may not be activated. Check the merch-os-billing-payfastitn logs.'
    );
    alarm(
      'ItnRetrying',
      logCountMetric('ItnRetryingFilter', 'ItnVerificationUnavailable', [
        'ITN verification unavailable; requesting retry',
        'ITN verification threw',
      ]),
      1,
      'Could not verify a PayFast ITN (PayFast/DNS unreachable or verifier error); PayFast was asked to retry.'
    );
    alarm(
      'ItnRejected',
      logCountMetric('ItnRejectedFilter', 'ItnRejected', ['ITN rejected']),
      1,
      'A PayFast ITN failed signature / source-IP / postback checks. If it came from PayFast, a real payment was NOT applied. The log line lists the reason and field names.'
    );
    alarm(
      'ItnAnomaly',
      logCountMetric('ItnAnomalyFilter', 'ItnAnomaly', [
        'ITN amount mismatch',
        'ITN has no matching checkout intent',
        'ITN missing tenant or payment id',
      ]),
      1,
      'A verified ITN did not match our records (amount, checkout or tenant). Possible tampering or a bug; the payment was not applied.'
    );
    alarm(
      'CheckoutErrors',
      changePlanFn.metricErrors({ period: cdk.Duration.minutes(5), statistic: cloudwatch.Stats.SUM }),
      1,
      'The change-plan Lambda threw: sellers may be unable to start a PayFast checkout.'
    );

    // -----------------------------------------------------------------------
    // SSM exports + stack outputs
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'BillingApiUrlParam', {
      parameterName: `${ssmPrefix}/billing-api/url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new ssm.StringParameter(this, 'BillingTableNameParam', {
      parameterName: `${ssmPrefix}/billing-api/table-name`,
      stringValue: this.billingTable.tableName,
    });

    new cdk.CfnOutput(this, 'BillingApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-BillingApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'BillingAlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      exportName: `${id}-BillingAlarmTopicArn`,
    });

    new cdk.CfnOutput(this, 'PayFastSecretArn', {
      value: this.payfastSecret.secretArn,
      exportName: `${id}-PayFastSecretArn`,
    });
  }
}

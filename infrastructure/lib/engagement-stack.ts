/**
 * MerchOS Engagement Stack: lifecycle emails, seller reviews and referrals.
 *
 * - DynamoDB table (platform CMK, PITR, TTL on `expiresAt` for rate counters)
 * - Secrets Manager secret: signing key for the review/unsubscribe links in emails
 * - EventBridge rules on the platform bus:
 *     auth.user.registered            -> trial welcome + trial track
 *     billing.subscription.activated  -> subscription welcome + subscriber track + referral check
 * - EventBridge Scheduler group for the later steps (day 2/5, day 30/35, +14d)
 * - HTTP API
 *     /reviews, /unsubscribe     public (signed links; origin check + rate limit in handler)
 *     /referrals/*               Cognito JWT (seller client) + RBAC `referrals`
 *     /admin/reviews/*           Cognito JWT (admin client) + RBAC `reviews` (Admin, Support)
 *     /admin/referrals/*         Cognito JWT (admin client) + RBAC `referrals` update (Admin)
 * - Email from info@merchos.co.za via SES (the verified domain identity)
 *
 * Reads (never writes) Cognito, the tenants table and the products table.
 * Cost at launch volumes: a few rand a month (all pay-per-request).
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
import { adminDashboardOrigins, sellerDashboardOrigins } from './cors-origins';
import { envFlag, envSetting } from './env-config';

export interface EngagementStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.IUserPool;
  platformKey: kms.IKey;
  /** Seller dashboard app client id (audience of the seller authorizer). */
  sellerClientId: string;
  /** Admin dashboard app client id. Defaults to the Auth stack's SSM export. */
  adminClientId?: string;
  /** Tenants table ARN. Defaults to the SSM export /merch-os/<env>/dynamodb/tenants-table-arn. */
  tenantsTableArn?: string;
}

export class EngagementStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: EngagementStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const account = this.account;
    const ssmPrefix = `/merch-os/${env}`;

    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'Engagement');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    const fromEmail = envSetting(this, env, 'engagementFromEmail', 'MerchOS <info@merchos.co.za>');
    const supportEmail = envSetting(this, env, 'engagementSupportEmail', 'info@merchos.co.za');
    const sesIdentity = envSetting(this, env, 'engagementSesIdentity', 'merchos.co.za');
    const siteUrl = envSetting(this, env, 'siteUrl', env === 'dev' ? 'https://merchos.co.za' : `https://app.merchos.io`);
    const adminBaseUrl = envSetting(
      this,
      env,
      'adminBaseUrl',
      env === 'dev' ? 'https://admin.merchos.co.za' : `https://admin-${env}.merchos.io`,
    );

    const adminClientId =
      props.adminClientId ?? ssm.StringParameter.valueForStringParameter(this, `${ssmPrefix}/cognito/admin-client-id`);
    const tenantsTableArn =
      props.tenantsTableArn ??
      ssm.StringParameter.valueForStringParameter(this, `${ssmPrefix}/dynamodb/tenants-table-arn`);
    const tenantsTableName = cdk.Fn.select(1, cdk.Fn.split('/', tenantsTableArn));
    const productsTableName = `merch-os-products-${env}`;
    const productsTableArn = `arn:aws:dynamodb:${region}:${account}:table/${productsTableName}`;

    const sellerOrigins = sellerDashboardOrigins(env);
    const adminOrigins = adminDashboardOrigins(env);
    const engagementOrigins = [...sellerOrigins, ...adminOrigins];

    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    this.table = new dynamodb.Table(this, 'EngagementTable', {
      tableName: `merch-os-engagement-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Reviews by status; all referrals (admin lists).
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const secret = new secretsmanager.Secret(this, 'EngagementSecret', {
      secretName: `merch-os/${env}/engagement`,
      description: 'Signing key for review and unsubscribe links in MerchOS emails',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'tokenSecret',
        passwordLength: 64,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const scheduleGroupName = `merch-os-engagement-${env}`;
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'EngagementScheduleGroup', { name: scheduleGroupName });

    // -----------------------------------------------------------------------
    // API (created first so the Lambdas can carry its URL)
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'EngagementHttpApi', {
      apiName: `merch-os-engagement-api-${env}`,
      description: 'MerchOS reviews, referrals and email preferences',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        // Both shared allow-lists (seller site + admin dashboard), nothing hand-written.
        allowOrigins: engagementOrigins,
        maxAge: cdk.Duration.hours(1),
      },
    });
    const httpStage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage | undefined;
    if (httpStage) httpStage.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 25 };

    const issuer = `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`;
    const sellerAuthorizer = new HttpJwtAuthorizer('EngagementSellerJwtAuthorizer', issuer, {
      jwtAudience: [props.sellerClientId],
    });
    const adminAuthorizer = new HttpJwtAuthorizer('EngagementAdminJwtAuthorizer', issuer, {
      jwtAudience: [adminClientId],
    });

    // -----------------------------------------------------------------------
    // Permissions
    // -----------------------------------------------------------------------

    const tableAccess = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:ConditionCheckItem',
        'dynamodb:Query',
      ],
      resources: [this.table.tableArn, `${this.table.tableArn}/index/*`],
    });
    const kmsAccess = new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });
    // Read-only: owner name and business name.
    const tenantsRead = new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [tenantsTableArn] });
    // Read-only: product count and paid status (ENTITLEMENT#trial).
    const productsRead = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [productsTableArn],
    });
    const cognitoRead = new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      // Built from the id (already exported) so the Auth stack needs no new export.
      resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/${props.userPool.userPoolId}`],
    });
    const sesSend = new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:${region}:${account}:identity/${sesIdentity}`],
    });
    const secretRead = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [secret.secretArn],
    });

    // -----------------------------------------------------------------------
    // Lambdas
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/engagement/handlers');
    const commonEnv: Record<string, string> = {
      ENVIRONMENT: env,
      ENGAGEMENT_TABLE: this.table.tableName,
      ENGAGEMENT_SECRET_ARN: secret.secretArn,
      ENGAGEMENT_API_URL: this.httpApi.apiEndpoint,
      FROM_EMAIL: fromEmail,
      SUPPORT_EMAIL: supportEmail,
      SITE_URL: siteUrl,
      ADMIN_BASE_URL: adminBaseUrl,
      SELLER_ORIGINS: sellerOrigins.join(','),
      USER_POOL_ID: props.userPool.userPoolId,
      TENANTS_TABLE: tenantsTableName,
      PRODUCTS_TABLE: productsTableName,
      // rbacMiddleware rejects every token without this (INVALID_ISSUER).
      COGNITO_ISSUER: issuer,
      // Payment reminders, pause/close notices and win-back emails. Booked at every
      // payment regardless; each one checks this at send time, so switching it on
      // later covers sellers who paid before.
      BILLING_LIFECYCLE: envFlag(this, env, 'billingLifecycle'),
      POWERTOOLS_SERVICE_NAME: 'engagement',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'INFO',
    };

    const createFn = (
      logicalId: string,
      file: string,
      statements: iam.PolicyStatement[],
      options: { handler?: string; extraEnv?: Record<string, string>; timeoutSeconds?: number } = {},
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for Engagement ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });
      for (const s of statements) role.addToPolicy(s);
      const logGroup = new logs.LogGroup(this, `${logicalId}Logs`, {
        logGroupName: `/merch-os/${env}/engagement/${logicalId.toLowerCase()}`,
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        functionName: `merch-os-engagement-${logicalId.toLowerCase()}-${env}`,
        entry: path.join(handlersPath, file),
        handler: options.handler ?? 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(options.timeoutSeconds ?? 15),
        memorySize: 256,
        tracing: lambda.Tracing.ACTIVE,
        role: role as unknown as iam.IRole,
        logGroup,
        environment: { ...commonEnv, ...(options.extraEnv ?? {}) },
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node20',
          externalModules: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', '@aws-sdk/client-secrets-manager'],
          format: lambdaNodejs.OutputFormat.ESM,
          mainFields: ['module', 'main'],
          // CJS deps (Powertools) call require(); give the ESM bundle one.
          banner: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
        },
      });
    };

    const scheduledFn = createFn(
      'Scheduled',
      'scheduled.ts',
      [tableAccess, kmsAccess, tenantsRead, productsRead, cognitoRead, sesSend, secretRead],
      { timeoutSeconds: 30 },
    );

    const schedulerRole = new iam.Role(this, 'EngagementSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': account } },
      }) as unknown as iam.IPrincipal,
      description: 'EventBridge Scheduler: runs later lifecycle email steps',
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [scheduledFn.functionArn] }),
    );
    const createSchedules = new iam.PolicyStatement({
      actions: ['scheduler:CreateSchedule'],
      resources: [`arn:aws:scheduler:${region}:${account}:schedule/${scheduleGroupName}/*`],
    });
    const passSchedulerRole = new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
      conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
    });
    // The referral check re-schedules itself weekly while the referred seller
    // has under 10 products. Its own ARN is built from the name (a token would
    // make the function depend on itself).
    for (const s of [createSchedules, passSchedulerRole]) scheduledFn.addToRolePolicy(s);
    scheduledFn.addEnvironment(
      'SCHEDULED_FUNCTION_ARN',
      `arn:aws:lambda:${region}:${account}:function:merch-os-engagement-scheduled-${env}`,
    );
    scheduledFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    scheduledFn.addEnvironment('SCHEDULE_GROUP', scheduleGroupName);

    const onEventFn = createFn(
      'OnEvent',
      'on-event.ts',
      [tableAccess, kmsAccess, tenantsRead, productsRead, cognitoRead, sesSend, createSchedules, passSchedulerRole],
      {
        timeoutSeconds: 30,
        extraEnv: {
          SCHEDULED_FUNCTION_ARN: scheduledFn.functionArn,
          SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
          SCHEDULE_GROUP: scheduleGroupName,
        },
      },
    );
    const publicApiFn = createFn('PublicApi', 'public-api.ts', [
      tableAccess,
      kmsAccess,
      tenantsRead,
      cognitoRead,
      sesSend,
      secretRead,
    ]);
    const sellerApiFn = createFn('SellerApi', 'seller-api.ts', [tableAccess, kmsAccess, tenantsRead, cognitoRead]);
    const adminReviewsFn = createFn('AdminReviews', 'admin-api.ts', [tableAccess, kmsAccess], {
      handler: 'reviewsHandler',
    });
    const adminReferralsFn = createFn('AdminReferrals', 'admin-api.ts', [tableAccess, kmsAccess], {
      handler: 'referralsHandler',
    });

    // -----------------------------------------------------------------------
    // Events (platform bus, referenced by name: no new Foundation exports)
    // -----------------------------------------------------------------------

    const bus = events.EventBus.fromEventBusName(this, 'PlatformBus', `merch-os-events-${env}`);
    const target = new targets.LambdaFunction(onEventFn, {
      retryAttempts: 8,
      maxEventAge: cdk.Duration.hours(6),
    });
    new events.Rule(this, 'UserRegisteredRule', {
      ruleName: `merch-os-engagement-user-registered-${env}`,
      description: 'New seller sign-up: trial welcome email and trial track',
      eventBus: bus,
      eventPattern: { source: ['merch-os.auth'], detailType: ['auth.user.registered'] },
      targets: [target],
    });
    new events.Rule(this, 'SubscriptionActivatedRule', {
      ruleName: `merch-os-engagement-subscription-activated-${env}`,
      description: 'Payment applied: subscription welcome, subscriber track, referral check',
      eventBus: bus,
      eventPattern: { source: ['merch-os.billing'], detailType: ['billing.subscription.activated'] },
      targets: [target],
    });

    // -----------------------------------------------------------------------
    // Routes
    // -----------------------------------------------------------------------

    const publicIntegration = new HttpLambdaIntegration('EngagementPublicIntegration', publicApiFn);
    const publicRoutes: Array<[string, HttpMethod]> = [
      ['/reviews', HttpMethod.GET],
      ['/reviews', HttpMethod.POST],
      ['/reviews/invite', HttpMethod.GET],
      ['/unsubscribe', HttpMethod.POST],
      ['/feedback', HttpMethod.POST],
    ];
    for (const [routePath, method] of publicRoutes) {
      // No account needed: the signed link is the credential (checked in the handler).
      this.httpApi.addRoutes({ path: routePath, methods: [method], integration: publicIntegration });
    }

    const sellerIntegration = new HttpLambdaIntegration('EngagementSellerIntegration', sellerApiFn);
    for (const [routePath, method] of [
      ['/referrals/me', HttpMethod.GET],
      ['/referrals/claim', HttpMethod.POST],
    ] as Array<[string, HttpMethod]>) {
      this.httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: sellerIntegration,
        authorizer: sellerAuthorizer,
      });
    }

    const reviewsIntegration = new HttpLambdaIntegration('EngagementAdminReviewsIntegration', adminReviewsFn);
    for (const [routePath, methods] of [
      ['/admin/reviews', [HttpMethod.GET]],
      ['/admin/reviews/{reviewId}', [HttpMethod.DELETE]],
      ['/admin/reviews/{reviewId}/approve', [HttpMethod.POST]],
      ['/admin/reviews/{reviewId}/reject', [HttpMethod.POST]],
      ['/admin/feedback', [HttpMethod.GET]],
    ] as Array<[string, HttpMethod[]]>) {
      this.httpApi.addRoutes({ path: routePath, methods, integration: reviewsIntegration, authorizer: adminAuthorizer });
    }

    const referralsIntegration = new HttpLambdaIntegration('EngagementAdminReferralsIntegration', adminReferralsFn);
    for (const [routePath, method] of [
      ['/admin/referrals', HttpMethod.GET],
      ['/admin/referrals/{referrerTenantId}/{referredTenantId}/applied', HttpMethod.POST],
    ] as Array<[string, HttpMethod]>) {
      this.httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: referralsIntegration,
        authorizer: adminAuthorizer,
      });
    }

    // -----------------------------------------------------------------------
    // Exports for the frontends (Amplify env vars)
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'EngagementApiUrlParam', {
      parameterName: `${ssmPrefix}/engagement/api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'EngagementApiUrl', { value: this.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'EngagementScheduleGroupName', { value: scheduleGroup.ref });
  }
}

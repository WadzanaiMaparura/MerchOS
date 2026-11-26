/**
 * MerchOS Admin API Stack: the backend for the admin dashboard (MerchOS staff,
 * Admin and Support). Starts with Customers; the other /admin/* pages move here.
 *
 * - DynamoDB table merch-os-admin-<env> (platform CMK, PITR): audit log of staff
 *   actions (GSI1: AUDIT / <time>, for the Audit log page) and account state
 * - HTTP API, Cognito JWT authorizer for the ADMIN dashboard client only
 *     GET  /admin/customers, /admin/customers/{tenantId}       RBAC users.search:read (Admin, Support)
 *     POST /admin/customers/resend-verification                RBAC users.verification:create (Admin, Support)
 *     POST /admin/customers/{tenantId}/disable|enable|exempt   RBAC users:update (Admin)
 *
 * Reads Cognito and the tenants, products, billing and engagement tables.
 * Writes only: Cognito enable/disable/sign-out, the trial entitlement item
 * (free unlimited), and its own table.
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
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
import { adminDashboardOrigins } from './cors-origins';
import { envSetting } from './env-config';

export interface AdminApiStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.IUserPool;
  platformKey: kms.IKey;
  /** Seller client id: resending sign-up verification codes goes through it. */
  sellerClientId: string;
  /** Admin dashboard client id (authorizer audience). Defaults to the SSM export. */
  adminClientId?: string;
  /** Defaults to the SSM export /merch-os/<env>/dynamodb/tenants-table-arn. */
  tenantsTableArn?: string;
}

export class AdminApiStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const account = this.account;
    const ssmPrefix = `/merch-os/${env}`;

    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'AdminApi');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    const adminClientId =
      props.adminClientId ?? ssm.StringParameter.valueForStringParameter(this, `${ssmPrefix}/cognito/admin-client-id`);
    const tenantsTableArn =
      props.tenantsTableArn ?? ssm.StringParameter.valueForStringParameter(this, `${ssmPrefix}/dynamodb/tenants-table-arn`);
    const tenantsTableName = cdk.Fn.select(1, cdk.Fn.split('/', tenantsTableArn));
    const tableArn = (name: string) => `arn:aws:dynamodb:${region}:${account}:table/${name}`;
    const productsTable = `merch-os-products-${env}`;
    const billingTable = `merch-os-billing-${env}`;
    const engagementTable = `merch-os-engagement-${env}`;
    const userPoolArn = `arn:aws:cognito-idp:${region}:${account}:userpool/${props.userPool.userPoolId}`;

    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    this.table = new dynamodb.Table(this, 'AdminTable', {
      tableName: `merch-os-admin-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      pointInTimeRecovery: true,
      // Team chat messages expire after 12 months.
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // API
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'AdminHttpApi', {
      apiName: `merch-os-admin-api-${env}`,
      description: 'MerchOS admin dashboard API (staff only)',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowOrigins: adminDashboardOrigins(env),
        maxAge: cdk.Duration.hours(1),
      },
    });
    const stage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage | undefined;
    if (stage) stage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };

    const issuer = `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`;
    const authorizer = new HttpJwtAuthorizer('AdminDashboardJwtAuthorizer', issuer, { jwtAudience: [adminClientId] });

    // -----------------------------------------------------------------------
    // Permissions
    // -----------------------------------------------------------------------

    const kmsRead = new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [props.platformKey.keyArn] });
    const kmsWrite = new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });
    const readOthers = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'],
      resources: [
        tenantsTableArn,
        tableArn(productsTable),
        tableArn(billingTable),
        tableArn(engagementTable),
      ],
    });
    const adminTableRead = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [this.table.tableArn, `${this.table.tableArn}/index/*`],
    });
    const adminTableWrite = new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [this.table.tableArn],
    });
    const listSellers = new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers', 'cognito-idp:ListUsersInGroup'],
      resources: [userPoolArn],
    });

    // -----------------------------------------------------------------------
    // Lambdas
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/admin/handlers');
    const environment: Record<string, string> = {
      ENVIRONMENT: env,
      USER_POOL_ID: props.userPool.userPoolId,
      SELLER_CLIENT_ID: props.sellerClientId,
      ADMIN_TABLE: this.table.tableName,
      TENANTS_TABLE: tenantsTableName,
      PRODUCTS_TABLE: productsTable,
      BILLING_TABLE: billingTable,
      ENGAGEMENT_TABLE: engagementTable,
      // rbacMiddleware rejects every token without this (INVALID_ISSUER).
      COGNITO_ISSUER: issuer,
      POWERTOOLS_SERVICE_NAME: 'admin-api',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'INFO',
    };

    const createFn = (logicalId: string, file: string, statements: iam.PolicyStatement[], timeoutSeconds = 29) => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for Admin API ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });
      for (const s of statements) role.addToPolicy(s);
      const logGroup = new logs.LogGroup(this, `${logicalId}Logs`, {
        logGroupName: `/merch-os/${env}/admin-api/${logicalId.toLowerCase()}`,
        // Staff actions: keep a year (the audit table keeps them for good).
        retention: logs.RetentionDays.ONE_YEAR,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        functionName: `merch-os-admin-${logicalId.toLowerCase()}-${env}`,
        entry: path.join(handlersPath, file),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(timeoutSeconds),
        memorySize: 512,
        tracing: lambda.Tracing.ACTIVE,
        role: role as unknown as iam.IRole,
        logGroup,
        environment,
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node20',
          externalModules: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
          format: lambdaNodejs.OutputFormat.ESM,
          mainFields: ['module', 'main'],
          banner: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
        },
      });
    };

    const readFn = createFn('CustomersRead', 'customers-read.ts', [
      listSellers,
      readOthers,
      adminTableRead,
      kmsRead,
    ]);
    const verifyFn = createFn('CustomersVerify', 'customers-verify.ts', [
      new iam.PolicyStatement({ actions: ['cognito-idp:AdminGetUser'], resources: [userPoolArn] }),
      adminTableWrite,
      kmsWrite,
    ]);
    const manageFn = createFn('CustomersManage', 'customers-manage.ts', [
      listSellers,
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminDisableUser', 'cognito-idp:AdminEnableUser', 'cognito-idp:AdminUserGlobalSignOut'],
        resources: [userPoolArn],
      }),
      new iam.PolicyStatement({ actions: ['dynamodb:BatchGetItem'], resources: [tableArn(productsTable), tableArn(billingTable)] }),
      // Free unlimited: the tenant's ENTITLEMENT#trial item only.
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [tableArn(productsTable)],
        conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*'] } },
      }),
      adminTableWrite,
      // Data hold (TENANT#<id> / HOLD): read, set and remove.
      new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'], resources: [this.table.tableArn] }),
      kmsWrite,
    ]);

    // Billing (read only, Admin). Scans the billing table for subscriptions,
    // invoices and payments; signs short download links for issued invoice PDFs.
    const invoicesBucket = `merch-os-invoices-${env}-${account}`;
    const billingFn = createFn('BillingRead', 'billing-read.ts', [
      new iam.PolicyStatement({ actions: ['dynamodb:Scan', 'dynamodb:GetItem'], resources: [tableArn(billingTable)] }),
      readOthers,
      kmsRead,
      new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [`arn:aws:s3:::${invoicesBucket}/invoices/*`] }),
    ]);
    billingFn.addEnvironment('INVOICE_BUCKET', invoicesBucket);

    // Audit log (read only, Admin): staff actions from this table, plus review
    // decisions and applied referral free months from the engagement table.
    const auditFn = createFn('AuditRead', 'audit-read.ts', [
      adminTableRead,
      new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${tableArn(engagementTable)}/index/*`] }),
      readOthers,
      listSellers,
      kmsRead,
    ]);

    // -----------------------------------------------------------------------
    // Health and Alerts
    // -----------------------------------------------------------------------

    // CloudWatch and Lambda read APIs do not support resource-level permissions.
    const readMetrics = new iam.PolicyStatement({
      actions: ['cloudwatch:GetMetricData', 'lambda:ListFunctions'],
      resources: ['*'],
    });
    const alertsTableWrite = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'],
      resources: [this.table.tableArn],
    });

    const healthFn = createFn('HealthRead', 'health-read.ts', [readMetrics, listSellers, adminTableRead, kmsRead]);
    // Payments shows "Not live yet" until checkout is switched on (same switch as the Billing API).
    healthFn.addEnvironment('PAYMENTS_LIVE', this.node.tryGetContext('checkoutEnabled') === 'true' ? 'true' : 'false');

    const alertsReadFn = createFn('AlertsRead', 'alerts-read.ts', [
      adminTableRead,
      listSellers,
      kmsRead,
      new iam.PolicyStatement({ actions: ['cloudwatch:DescribeAlarms'], resources: ['*'] }),
    ]);
    const alertsManageFn = createFn('AlertsManage', 'alerts-manage.ts', [alertsTableWrite, kmsWrite]);

    // Every 15 minutes, plus every state change of the existing merch-os-* alarms.
    const alertEmail = envSetting(this, env, 'alertEmail', 'admin@merchos.co.za');
    const adminBaseUrl = envSetting(
      this,
      env,
      'adminBaseUrl',
      env === 'dev' ? 'https://admin.merchos.co.za' : `https://admin-${env}.merchos.io`,
    );
    const monitorFn = createFn('AlertsMonitor', 'alerts-monitor.ts', [
      readMetrics,
      adminTableRead,
      alertsTableWrite,
      kmsWrite,
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:aws:ses:${region}:${account}:identity/merchos.co.za`],
      }),
    ]);
    monitorFn.addEnvironment('ALERT_EMAIL', alertEmail);
    monitorFn.addEnvironment('ALERT_FROM_EMAIL', 'MerchOS Alerts <noreply@merchos.co.za>');
    monitorFn.addEnvironment('ADMIN_BASE_URL', adminBaseUrl);
    new events.Rule(this, 'HealthCheckSchedule', {
      ruleName: `merch-os-admin-health-check-${env}`,
      description: 'Checks every area for errors and opens or closes alerts',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(monitorFn, { retryAttempts: 2 })],
    });
    new events.Rule(this, 'AlarmStateChange', {
      ruleName: `merch-os-admin-alarm-changes-${env}`,
      description: 'Existing MerchOS alarms (payments, imports) open and close alerts',
      eventPattern: {
        source: ['aws.cloudwatch'],
        detailType: ['CloudWatch Alarm State Change'],
        detail: { alarmName: [{ prefix: 'merch-os-' }] },
      },
      targets: [new targets.LambdaFunction(monitorFn, { retryAttempts: 4 })],
    });

    // -----------------------------------------------------------------------
    // Data retention (daily): deletes closed / unused seller accounts by the
    // agreed rules. DATA_RETENTION off | dryrun | on (cdk.json dataRetention).
    // The only role here that may delete seller data, and only by partition:
    // there is no Scan anywhere in it.
    // -----------------------------------------------------------------------

    const dataRetention = ['off', 'dryrun', 'on'].includes(envSetting(this, env, 'dataRetention', 'off'))
      ? envSetting(this, env, 'dataRetention', 'off')
      : 'off';
    const sellerTables = {
      INVENTORY_TABLE: `merch-os-inventory-${env}`,
      INVENTORY_TRANSACTIONS_TABLE: `merch-os-inventory-transactions-${env}`,
      SUPPLIERS_TABLE: `merch-os-suppliers-${env}`,
      IMPORT_JOBS_TABLE: `merch-os-import-jobs-${env}`,
      IMAGE_JOBS_TABLE: `merch-os-image-jobs-${env}`,
      INTELLIGENCE_TABLE: `product-intelligence-${env}`,
      INVITATIONS_TABLE: `merch-os-invitations-${env}`,
    };
    const sellerBuckets = {
      RAW_UPLOADS_BUCKET: `merch-os-raw-uploads-${env}`,
      ASSETS_BUCKET: `merch-os-assets-${env}`,
      EXPORTS_BUCKET: `merch-os-exports-${env}`,
    };
    // Where each bucket keeps a seller's files (all start with the tenant id).
    const sellerPrefixes: Array<[string, string]> = [
      [sellerBuckets.RAW_UPLOADS_BUCKET, 'suppliers/*'],
      [sellerBuckets.RAW_UPLOADS_BUCKET, 'images/*'],
      [sellerBuckets.ASSETS_BUCKET, 'assets/*'],
      [sellerBuckets.ASSETS_BUCKET, 'images/*'],
      [sellerBuckets.EXPORTS_BUCKET, 'tenants/*'],
    ];
    const retentionFn = createFn(
      'DataRetention',
      'data-retention.ts',
      [
        listSellers,
        new iam.PolicyStatement({ actions: ['cognito-idp:AdminDeleteUser'], resources: [userPoolArn] }),
        // Own table: holds, warnings, deletions in progress, proof of deletion, audit.
        new iam.PolicyStatement({
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
          resources: [this.table.tableArn, `${this.table.tableArn}/index/*`],
        }),
        // Seller data: read and delete by partition (no Scan).
        new iam.PolicyStatement({
          actions: [
            'dynamodb:GetItem',
            'dynamodb:BatchGetItem',
            'dynamodb:Query',
            'dynamodb:BatchWriteItem',
            'dynamodb:DeleteItem',
            'dynamodb:UpdateItem',
          ],
          resources: [
            tenantsTableArn,
            tableArn(productsTable),
            tableArn(billingTable),
            tableArn(engagementTable),
            ...Object.values(sellerTables).map(tableArn),
          ],
        }),
        kmsWrite,
        // Files: every version under the seller's own prefixes only.
        ...[...new Set(sellerPrefixes.map(([b]) => b))].map(
          (bucket) =>
            new iam.PolicyStatement({
              actions: ['s3:ListBucketVersions', 's3:ListBucket'],
              resources: [`arn:aws:s3:::${bucket}`],
              conditions: {
                StringLike: { 's3:prefix': sellerPrefixes.filter(([b]) => b === bucket).map(([, p]) => p) },
              },
            }),
        ),
        new iam.PolicyStatement({
          actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
          resources: sellerPrefixes.map(([b, p]) => `arn:aws:s3:::${b}/${p}`),
        }),
        // The 30-day warning (engagement sends the seller email) and the report to admin@.
        new iam.PolicyStatement({
          actions: ['events:PutEvents'],
          resources: [`arn:aws:events:${region}:${account}:event-bus/merch-os-events-${env}`],
        }),
        new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [`arn:aws:ses:${region}:${account}:identity/merchos.co.za`],
        }),
      ],
      15 * 60,
    );
    for (const [k, v] of Object.entries({ ...sellerTables, ...sellerBuckets })) retentionFn.addEnvironment(k, v);
    retentionFn.addEnvironment('DATA_RETENTION', dataRetention);
    // When the rehearsal started: admin is reminded to switch on after 30 days.
    const dryRunSince = envSetting(this, env, 'dataRetentionDryRunSince');
    if (dryRunSince) retentionFn.addEnvironment('DATA_RETENTION_DRYRUN_SINCE', dryRunSince);
    retentionFn.addEnvironment('EVENT_BUS_NAME', `merch-os-events-${env}`);
    retentionFn.addEnvironment('ALERT_EMAIL', alertEmail);
    retentionFn.addEnvironment('ALERT_FROM_EMAIL', 'MerchOS Alerts <noreply@merchos.co.za>');
    retentionFn.addEnvironment('ADMIN_BASE_URL', adminBaseUrl);
    // Once a day at 03:00 South African time. Never retried by EventBridge: the
    // next day's run finishes anything left (deletions in progress are resumed).
    new events.Rule(this, 'DataRetentionSchedule', {
      ruleName: `merch-os-admin-data-retention-${env}`,
      description: 'Daily: warn and delete closed or unused seller accounts (DATA_RETENTION)',
      schedule: events.Schedule.cron({ minute: '0', hour: '1' }),
      targets: [new targets.LambdaFunction(retentionFn, { retryAttempts: 0 })],
    });

    // -----------------------------------------------------------------------
    // Library and Team (announcements, goals, team chat)
    // -----------------------------------------------------------------------

    const libraryReadFn = createFn('LibraryRead', 'library-read.ts', [adminTableRead, listSellers, kmsRead]);
    const libraryManageFn = createFn('LibraryManage', 'library-manage.ts', [adminTableRead, alertsTableWrite, kmsWrite]);
    // Goals that count themselves read reviews (engagement) and resolved chats (live chat), read only.
    const chatTable = `merch-os-support-chat-${env}`;
    const teamFn = createFn('TeamApi', 'team-api.ts', [
      adminTableRead,
      alertsTableWrite,
      listSellers,
      kmsWrite,
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${tableArn(engagementTable)}/index/*`, `${tableArn(chatTable)}/index/*`],
      }),
    ]);
    teamFn.addEnvironment('CHAT_TABLE', chatTable);
    const teamManageFn = createFn('TeamManage', 'team-manage.ts', [adminTableRead, alertsTableWrite, listSellers, kmsWrite]);

    // -----------------------------------------------------------------------
    // Routes (all staff-only)
    // -----------------------------------------------------------------------

    const routes: Array<[string, HttpMethod, lambdaNodejs.NodejsFunction]> = [
      ['/admin/library', HttpMethod.GET, libraryReadFn],
      ['/admin/library/{articleId}', HttpMethod.GET, libraryReadFn],
      ['/admin/library', HttpMethod.POST, libraryManageFn],
      ['/admin/library/{articleId}', HttpMethod.PUT, libraryManageFn],
      ['/admin/library/{articleId}', HttpMethod.DELETE, libraryManageFn],
      ['/admin/team/unread', HttpMethod.GET, teamFn],
      ['/admin/team/announcements', HttpMethod.GET, teamFn],
      ['/admin/team/announcements/{id}/read', HttpMethod.POST, teamFn],
      ['/admin/team/goals', HttpMethod.GET, teamFn],
      ['/admin/team/goals/{id}/progress', HttpMethod.PUT, teamFn],
      ['/admin/team/chat', HttpMethod.GET, teamFn],
      ['/admin/team/chat/{channel}/messages', HttpMethod.GET, teamFn],
      ['/admin/team/chat/{channel}/messages', HttpMethod.POST, teamFn],
      ['/admin/team/chat/{channel}/read', HttpMethod.POST, teamFn],
      ['/admin/team/announcements', HttpMethod.POST, teamManageFn],
      ['/admin/team/announcements/{id}', HttpMethod.DELETE, teamManageFn],
      ['/admin/team/goals', HttpMethod.POST, teamManageFn],
      ['/admin/team/goals/{id}', HttpMethod.PUT, teamManageFn],
      ['/admin/team/goals/{id}', HttpMethod.DELETE, teamManageFn],
      ['/admin/health', HttpMethod.GET, healthFn],
      ['/admin/alerts', HttpMethod.GET, alertsReadFn],
      ['/admin/alerts/unresolved-count', HttpMethod.GET, alertsReadFn],
      ['/admin/alerts/{alertId}/resolve', HttpMethod.POST, alertsManageFn],
      ['/admin/alerts/{alertId}/notes', HttpMethod.POST, alertsManageFn],
      ['/admin/audit', HttpMethod.GET, auditFn],
      ['/admin/billing', HttpMethod.GET, billingFn],
      ['/admin/billing/{tenantId}', HttpMethod.GET, billingFn],
      ['/admin/billing/{tenantId}/invoices/{invoiceId}/pdf', HttpMethod.GET, billingFn],
      ['/admin/customers', HttpMethod.GET, readFn],
      ['/admin/customers/{tenantId}', HttpMethod.GET, readFn],
      ['/admin/customers/resend-verification', HttpMethod.POST, verifyFn],
      ['/admin/customers/{tenantId}/disable', HttpMethod.POST, manageFn],
      ['/admin/customers/{tenantId}/enable', HttpMethod.POST, manageFn],
      ['/admin/customers/{tenantId}/exempt', HttpMethod.POST, manageFn],
      ['/admin/customers/{tenantId}/hold', HttpMethod.POST, manageFn],
    ];
    const integrations = new Map<lambdaNodejs.NodejsFunction, HttpLambdaIntegration>();
    for (const [routePath, method, fn] of routes) {
      if (!integrations.has(fn)) integrations.set(fn, new HttpLambdaIntegration(`${fn.node.id}Integration`, fn));
      this.httpApi.addRoutes({ path: routePath, methods: [method], integration: integrations.get(fn)!, authorizer });
    }

    new ssm.StringParameter(this, 'AdminApiUrlParam', {
      parameterName: `${ssmPrefix}/admin-api/url`,
      stringValue: this.httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'AdminApiUrl', { value: this.httpApi.apiEndpoint });
  }
}

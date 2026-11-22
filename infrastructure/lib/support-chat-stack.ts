/**
 * MerchOS Support Chat Stack — our own live chat (no third party).
 *
 * Visitors on the website and seller dashboard chat with the support team,
 * who answer from the admin dashboard "Support inbox".
 *
 * - DynamoDB table (platform CMK, PITR, 12-month TTL on `expiresAt`)
 * - Secrets Manager secret: visitor-token signing key (+ VAPID keys, added by
 *   services/support-chat/scripts/init-vapid.mjs)
 * - HTTP API
 *     /chat/*     public (visitors; origin allow-list + rate limits in handler)
 *     /support/*  Cognito JWT (admin client) + RBAC `support-inbox`
 * - WebSocket API (live delivery, typing, inbox heartbeat)
 * - EventBridge Scheduler group for the 60s / 2min waiting-chat timers
 * - Alerts: Web Push + SES email to the support mailbox (no SMS/WhatsApp)
 *
 * Cost at launch volumes is a few rand a month (all pay-per-request).
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {
  HttpLambdaIntegration,
  WebSocketLambdaIntegration,
} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
import { adminDashboardOrigins, sellerDashboardOrigins } from './cors-origins';
import { envSetting } from './env-config';

export interface SupportChatStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.IUserPool;
  platformKey: kms.IKey;
  /**
   * Admin dashboard app client id. Defaults to the Auth stack's SSM export
   * (/merch-os/<env>/cognito/admin-client-id), which avoids adding a new
   * CloudFormation export to (and redeploying) the Auth stack.
   */
  adminClientId?: string;
}

export class SupportChatStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly httpApi: HttpApi;
  public readonly webSocketApi: WebSocketApi;
  public readonly webSocketStage: WebSocketStage;
  public readonly chatSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SupportChatStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const account = this.account;
    const ssmPrefix = `/merch-os/${env}`;

    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'SupportChat');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // Where alert emails go, the sender, and the inbox link in them.
    const supportEmail = envSetting(this, env, 'chatSupportEmail', 'info@merchos.co.za');
    const fromEmail = envSetting(this, env, 'chatFromEmail', 'MerchOS Chat <chat@merchos.co.za>');
    // SES identity that authorises the sender (the verified domain).
    const sesIdentity = envSetting(this, env, 'chatSesIdentity', 'merchos.co.za');
    const agentDisplayName = envSetting(this, env, 'chatAgentName', 'Imani');
    const adminBaseUrl = envSetting(
      this,
      env,
      'adminBaseUrl',
      env === 'dev' ? 'https://admin.merchos.co.za' : `https://admin-${env}.merchos.io`,
    );

    const adminClientId =
      props.adminClientId ??
      ssm.StringParameter.valueForStringParameter(this, `${ssmPrefix}/cognito/admin-client-id`);

    const visitorOrigins = sellerDashboardOrigins(env);
    const agentOrigins = adminDashboardOrigins(env);
    const chatOrigins = [...visitorOrigins, ...agentOrigins];

    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    this.table = new dynamodb.Table(this, 'ChatTable', {
      tableName: `merch-os-support-chat-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      // Conversations: 12 months after last activity. Sockets/counters: short.
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Inbox tabs: conversations by status, newest activity first.
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.chatSecret = new secretsmanager.Secret(this, 'ChatSecret', {
      secretName: `merch-os/${env}/support-chat`,
      description: 'Live chat: visitor token signing key and Web Push (VAPID) keys',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'visitorTokenSecret',
        passwordLength: 64,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const scheduleGroupName = `merch-os-support-chat-${env}`;
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'ChatTimerGroup', { name: scheduleGroupName });

    // -----------------------------------------------------------------------
    // APIs
    // -----------------------------------------------------------------------

    this.webSocketApi = new WebSocketApi(this, 'ChatWebSocketApi', {
      apiName: `merch-os-support-chat-ws-${env}`,
      description: 'MerchOS live chat — real-time delivery to visitors and the Support inbox',
    });
    this.webSocketStage = new WebSocketStage(this, 'ChatWebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'live',
      autoDeploy: true,
    });
    const wsCfnStage = this.webSocketStage.node.defaultChild as cdk.aws_apigatewayv2.CfnStage;
    wsCfnStage.defaultRouteSettings = { throttlingBurstLimit: 100, throttlingRateLimit: 50 };

    this.httpApi = new HttpApi(this, 'ChatHttpApi', {
      apiName: `merch-os-support-chat-api-${env}`,
      description: 'MerchOS live chat — visitor chat (public) and Support inbox (Cognito)',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        // Both shared allow-lists (visitors + Support inbox), nothing hand-written.
        allowOrigins: chatOrigins,
        maxAge: cdk.Duration.hours(1),
      },
    });
    const httpStage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage | undefined;
    if (httpStage) {
      httpStage.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 25 };
    }

    const issuer = `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`;
    const agentAuthorizer = new HttpJwtAuthorizer('SupportInboxJwtAuthorizer', issuer, {
      jwtAudience: [adminClientId],
    });

    // -----------------------------------------------------------------------
    // Lambdas
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/support-chat/handlers');

    const commonEnv: Record<string, string> = {
      ENVIRONMENT: env,
      CHAT_TABLE: this.table.tableName,
      CHAT_SECRET_ARN: this.chatSecret.secretArn,
      WS_CALLBACK_URL: this.webSocketStage.callbackUrl,
      AGENT_DISPLAY_NAME: agentDisplayName,
      SUPPORT_EMAIL: supportEmail,
      CHAT_FROM_EMAIL: fromEmail,
      ADMIN_BASE_URL: adminBaseUrl,
      VISITOR_ORIGINS: visitorOrigins.join(','),
      AGENT_ORIGINS: agentOrigins.join(','),
      USER_POOL_ID: props.userPool.userPoolId,
      ADMIN_CLIENT_ID: adminClientId,
      // rbacMiddleware rejects every token without this (INVALID_ISSUER).
      COGNITO_ISSUER: issuer,
      POWERTOOLS_SERVICE_NAME: 'support-chat',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'INFO',
    };

    const tableAccess = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
      resources: [this.table.tableArn, `${this.table.tableArn}/index/*`],
    });
    const tableBatchDelete = new iam.PolicyStatement({
      actions: ['dynamodb:BatchWriteItem'],
      resources: [this.table.tableArn],
    });
    const kmsAccess = new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });
    const secretRead = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [this.chatSecret.secretArn],
    });
    const sesSend = new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:${region}:${account}:identity/${sesIdentity}`],
    });

    const createFn = (
      logicalId: string,
      file: string,
      statements: iam.PolicyStatement[],
      extraEnv: Record<string, string> = {},
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for Support Chat ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });
      for (const s of statements) role.addToPolicy(s);
      const functionName = `merch-os-support-chat-${logicalId.toLowerCase()}-${env}`;
      // Chat logs contain no message text, but keep them bounded anyway.
      const logGroup = new logs.LogGroup(this, `${logicalId}Logs`, {
        logGroupName: `/merch-os/${env}/support-chat/${logicalId.toLowerCase()}`,
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        functionName,
        entry: path.join(handlersPath, file),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        tracing: lambda.Tracing.ACTIVE,
        role: role as unknown as iam.IRole,
        logGroup,
        environment: { ...commonEnv, ...extraEnv },
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node20',
          externalModules: [
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/lib-dynamodb',
            '@aws-sdk/client-secrets-manager',
          ],
          format: lambdaNodejs.OutputFormat.ESM,
          mainFields: ['module', 'main'],
          // CJS deps (web-push, Powertools) call require(); give the ESM bundle one.
          banner: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
        },
      });
    };

    const timerFn = createFn('Timer', 'timer.ts', [tableAccess, kmsAccess, secretRead]);

    // Scheduler assumes this role to invoke the timer Lambda.
    const schedulerRole = new iam.Role(this, 'ChatSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': account } },
      }) as unknown as iam.IPrincipal,
      description: 'EventBridge Scheduler: fires live-chat waiting timers',
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [timerFn.functionArn] }),
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

    const publicApiFn = createFn(
      'PublicApi',
      'public-api.ts',
      [tableAccess, kmsAccess, secretRead, sesSend, createSchedules, passSchedulerRole],
      {
        TIMER_FUNCTION_ARN: timerFn.functionArn,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        SCHEDULE_GROUP: scheduleGroupName,
      },
    );
    const agentApiFn = createFn('AgentApi', 'agent-api.ts', [tableAccess, tableBatchDelete, kmsAccess, secretRead]);
    const wsConnectFn = createFn('WsConnect', 'ws-connect.ts', [tableAccess, kmsAccess, secretRead]);
    const wsDisconnectFn = createFn('WsDisconnect', 'ws-disconnect.ts', [tableAccess, kmsAccess]);
    const wsMessageFn = createFn('WsMessage', 'ws-message.ts', [tableAccess, kmsAccess]);

    // Every function that posts to sockets.
    for (const fn of [publicApiFn, agentApiFn, wsConnectFn, wsDisconnectFn, wsMessageFn, timerFn]) {
      this.webSocketStage.grantManagementApiAccess(fn);
    }

    // -----------------------------------------------------------------------
    // Routes
    // -----------------------------------------------------------------------

    this.webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('ChatWsConnectIntegration', wsConnectFn),
    });
    this.webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('ChatWsDisconnectIntegration', wsDisconnectFn),
    });
    this.webSocketApi.addRoute('$default', {
      integration: new WebSocketLambdaIntegration('ChatWsMessageIntegration', wsMessageFn),
    });

    const publicIntegration = new HttpLambdaIntegration('ChatPublicIntegration', publicApiFn);
    const publicRoutes: Array<[string, HttpMethod]> = [
      ['/chat/status', HttpMethod.GET],
      ['/chat/conversations', HttpMethod.POST],
      ['/chat/conversations/{conversationId}', HttpMethod.GET],
      ['/chat/conversations/{conversationId}/messages', HttpMethod.POST],
      ['/chat/details', HttpMethod.POST],
    ];
    for (const [routePath, method] of publicRoutes) {
      // Visitors have no account; the handler checks origin, token and limits.
      this.httpApi.addRoutes({ path: routePath, methods: [method], integration: publicIntegration });
    }

    const agentIntegration = new HttpLambdaIntegration('ChatAgentIntegration', agentApiFn);
    const agentRoutes: Array<[string, HttpMethod[]]> = [
      ['/support/conversations', [HttpMethod.GET]],
      ['/support/conversations/{conversationId}', [HttpMethod.GET, HttpMethod.DELETE]],
      ['/support/conversations/{conversationId}/accept', [HttpMethod.POST]],
      ['/support/conversations/{conversationId}/messages', [HttpMethod.POST]],
      ['/support/conversations/{conversationId}/resolve', [HttpMethod.POST]],
      ['/support/presence', [HttpMethod.GET, HttpMethod.PUT]],
      ['/support/settings', [HttpMethod.GET, HttpMethod.PUT]],
      ['/support/push-subscriptions', [HttpMethod.POST, HttpMethod.DELETE]],
    ];
    for (const [routePath, methods] of agentRoutes) {
      this.httpApi.addRoutes({
        path: routePath,
        methods,
        integration: agentIntegration,
        authorizer: agentAuthorizer,
      });
    }

    // -----------------------------------------------------------------------
    // Exports for the frontends (Amplify env vars)
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'ChatApiUrlParam', {
      parameterName: `${ssmPrefix}/support-chat/api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });
    new ssm.StringParameter(this, 'ChatWsUrlParam', {
      parameterName: `${ssmPrefix}/support-chat/ws-url`,
      stringValue: this.webSocketStage.url,
    });
    new cdk.CfnOutput(this, 'ChatApiUrl', { value: this.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'ChatWsUrl', { value: this.webSocketStage.url });
    new cdk.CfnOutput(this, 'ChatScheduleGroup', { value: scheduleGroup.ref });
  }
}

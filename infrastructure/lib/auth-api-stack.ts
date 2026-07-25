/**
 * MerchOS Auth API Stack
 *
 * Provisions the Auth API infrastructure:
 * - HTTP API Gateway with Cognito JWT Authorizer
 * - 14 Lambda handler functions with dedicated IAM roles
 * - 4 Cognito Lambda triggers
 * - 3 DynamoDB tables (invitations, sessions, rate-limits)
 * - Route integrations for all auth endpoints
 * - SSM Parameter Store exports
 *
 * Requirements: 2.1, 2.3, 2.9
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AuthApiStackProps extends cdk.StackProps {
  environment: string;
  tenantPool: cognito.UserPool;
  adminPool: cognito.UserPool;
  sellerDashboardClient: cognito.UserPoolClient;
  platformKey: kms.Key;
  eventBus: events.EventBus;
}

export class AuthApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;
  public readonly invitationsTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  public readonly rateLimitsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AuthApiStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const ssmPrefix = `/merch-os/${env}`;

    // Tags
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'AuthApi');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');


    // -----------------------------------------------------------------------
    // DynamoDB Tables
    // -----------------------------------------------------------------------

    this.invitationsTable = new dynamodb.Table(this, 'InvitationsTable', {
      tableName: `merch-os-invitations-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.invitationsTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'invitationId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: `merch-os-sessions-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.rateLimitsTable = new dynamodb.Table(this, 'RateLimitsTable', {
      tableName: `merch-os-rate-limits-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // HTTP API Gateway
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'AuthHttpApi', {
      apiName: `merch-os-auth-api-${env}`,
      description: 'MerchOS Auth API — authentication and user management endpoints',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowOrigins: [`https://${env === 'production' ? 'app' : env}.merchos.io`],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // JWT Authorizer for Cognito Tenant Pool
    const jwtAuthorizer = new HttpJwtAuthorizer('CognitoJwtAuthorizer', 
      `https://cognito-idp.${region}.amazonaws.com/${props.tenantPool.userPoolId}`,
      {
        jwtAudience: [props.sellerDashboardClient.userPoolClientId],
      }
    );


    // -----------------------------------------------------------------------
    // Shared Lambda Configuration
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/auth/handlers');
    const triggersPath = path.join(__dirname, '../../services/auth/triggers');

    const commonLambdaEnv: Record<string, string> = {
      COGNITO_TENANT_POOL_ID: props.tenantPool.userPoolId,
      COGNITO_ADMIN_POOL_ID: props.adminPool.userPoolId,
      COGNITO_SELLER_CLIENT_ID: props.sellerDashboardClient.userPoolClientId,
      COGNITO_ISSUER: `https://cognito-idp.${region}.amazonaws.com/${props.tenantPool.userPoolId}`,
      INVITATIONS_TABLE: this.invitationsTable.tableName,
      SESSIONS_TABLE: this.sessionsTable.tableName,
      RATE_LIMITS_TABLE: this.rateLimitsTable.tableName,
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      ENVIRONMENT: env,
    };

    const defaultLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonLambdaEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
      },
    };

    // -----------------------------------------------------------------------
    // Helper: Create Lambda with dedicated IAM role
    // -----------------------------------------------------------------------

    const createLambda = (
      logicalId: string,
      entry: string,
      policyStatements: iam.PolicyStatement[],
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });

      for (const statement of policyStatements) {
        role.addToPolicy(statement);
      }

      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        ...defaultLambdaProps,
        functionName: `merch-os-auth-${logicalId.toLowerCase()}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // Lambda Functions — Auth Handlers
    // -----------------------------------------------------------------------

    // 1. Login
    const loginFn = createLambda('Login', path.join(handlersPath, 'login.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminInitiateAuth'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 2. Refresh
    const refreshFn = createLambda('Refresh', path.join(handlersPath, 'refresh.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminInitiateAuth'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 3. Logout
    const logoutFn = createLambda('Logout', path.join(handlersPath, 'logout.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GlobalSignOut'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 4. Forgot Password
    const forgotPasswordFn = createLambda('ForgotPassword', path.join(handlersPath, 'forgot-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ForgotPassword'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 5. Reset Password
    const resetPasswordFn = createLambda('ResetPassword', path.join(handlersPath, 'reset-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ConfirmForgotPassword'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 6. Verify Email
    const verifyEmailFn = createLambda('VerifyEmail', path.join(handlersPath, 'verify-email.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ConfirmSignUp'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);


    // 7. Change Password
    const changePasswordFn = createLambda('ChangePassword', path.join(handlersPath, 'change-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ChangePassword'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 8. MFA Setup
    const mfaSetupFn = createLambda('MfaSetup', path.join(handlersPath, 'mfa-setup.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AssociateSoftwareToken',
          'cognito-idp:VerifySoftwareToken',
          'cognito-idp:AdminSetUserMFAPreference',
        ],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 9. Session (no Cognito permissions — reads JWT claims only)
    const sessionFn = createLambda('Session', path.join(handlersPath, 'session.ts'), []);

    // 10. Invite User
    const inviteUserFn = createLambda('InviteUser', path.join(handlersPath, 'invite-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminUpdateUserAttributes',
        ],
        resources: [props.tenantPool.userPoolArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [this.invitationsTable.tableArn],
      }),
    ]);

    // 11. List Users
    const listUsersFn = createLambda('ListUsers', path.join(handlersPath, 'list-users.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ListUsersInGroup'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 12. Update Role
    const updateRoleFn = createLambda('UpdateRole', path.join(handlersPath, 'update-role.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminUpdateUserAttributes',
        ],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 13. Disable User
    const disableUserFn = createLambda('DisableUser', path.join(handlersPath, 'disable-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminDisableUser'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // 14. Delete User
    const deleteUserFn = createLambda('DeleteUser', path.join(handlersPath, 'delete-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminDeleteUser'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    // Grant EventBridge PutEvents to all handlers that emit events
    const eventBusPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [props.eventBus.eventBusArn],
    });

    [logoutFn, inviteUserFn, disableUserFn, deleteUserFn, updateRoleFn].forEach((fn) => {
      fn.role!.addToPrincipalPolicy(eventBusPolicy);
    });


    // -----------------------------------------------------------------------
    // Cognito Lambda Triggers
    // -----------------------------------------------------------------------

    const preSignUpFn = createLambda('PreSignUp', path.join(triggersPath, 'pre-sign-up.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          this.invitationsTable.tableArn,
          `${this.invitationsTable.tableArn}/index/email-index`,
        ],
      }),
    ]);

    const postConfirmationFn = createLambda('PostConfirmation', path.join(triggersPath, 'post-confirmation.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [this.sessionsTable.tableArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [props.eventBus.eventBusArn],
      }),
    ]);

    const preTokenGenerationFn = createLambda('PreTokenGeneration', path.join(triggersPath, 'pre-token-generation.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminListGroupsForUser'],
        resources: [props.tenantPool.userPoolArn],
      }),
    ]);

    const customMessageFn = createLambda('CustomMessage', path.join(triggersPath, 'custom-message.ts'), []);

    // Wire triggers to Cognito tenant pool
    props.tenantPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);
    props.tenantPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);
    props.tenantPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, preTokenGenerationFn);
    props.tenantPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // -----------------------------------------------------------------------
    // Route Integrations
    // -----------------------------------------------------------------------

    // Unauthenticated routes (no authorizer)
    this.httpApi.addRoutes({
      path: '/auth/login',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('LoginIntegration', loginFn),
    });

    this.httpApi.addRoutes({
      path: '/auth/refresh',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('RefreshIntegration', refreshFn),
    });

    this.httpApi.addRoutes({
      path: '/auth/forgot-password',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ForgotPasswordIntegration', forgotPasswordFn),
    });

    this.httpApi.addRoutes({
      path: '/auth/reset-password',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ResetPasswordIntegration', resetPasswordFn),
    });

    this.httpApi.addRoutes({
      path: '/auth/verify-email',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('VerifyEmailIntegration', verifyEmailFn),
    });

    // Authenticated routes (JWT authorizer)
    this.httpApi.addRoutes({
      path: '/auth/logout',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('LogoutIntegration', logoutFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/change-password',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ChangePasswordIntegration', changePasswordFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/mfa/setup',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('MfaSetupIntegration', mfaSetupFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/session',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SessionIntegration', sessionFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/invite',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('InviteUserIntegration', inviteUserFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/users',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListUsersIntegration', listUsersFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/users/{id}/role',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('UpdateRoleIntegration', updateRoleFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/users/{id}/disable',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('DisableUserIntegration', disableUserFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/users/{id}',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('DeleteUserIntegration', deleteUserFn),
      authorizer: jwtAuthorizer,
    });


    // -----------------------------------------------------------------------
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'AuthApiUrlParam', {
      parameterName: `${ssmPrefix}/api/auth-api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new ssm.StringParameter(this, 'InvitationsTableParam', {
      parameterName: `${ssmPrefix}/dynamodb/invitations-table`,
      stringValue: this.invitationsTable.tableName,
    });

    new ssm.StringParameter(this, 'SessionsTableParam', {
      parameterName: `${ssmPrefix}/dynamodb/sessions-table`,
      stringValue: this.sessionsTable.tableName,
    });

    new ssm.StringParameter(this, 'RateLimitsTableParam', {
      parameterName: `${ssmPrefix}/dynamodb/rate-limits-table`,
      stringValue: this.rateLimitsTable.tableName,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'AuthApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-AuthApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'InvitationsTableName', {
      value: this.invitationsTable.tableName,
      exportName: `${id}-InvitationsTableName`,
    });

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: this.sessionsTable.tableName,
      exportName: `${id}-SessionsTableName`,
    });

    new cdk.CfnOutput(this, 'RateLimitsTableName', {
      value: this.rateLimitsTable.tableName,
      exportName: `${id}-RateLimitsTableName`,
    });
  }
}

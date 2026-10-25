/**
 * MerchOS Auth API Stack
 *
 * Provisions the Auth API infrastructure:
 * - HTTP API Gateway with Cognito JWT Authorizer
 * - 14 Lambda handler functions with dedicated IAM roles
 * - 1 DynamoDB table (rate-limits)
 * - Route integrations for all auth endpoints
 * - SSM Parameter Store exports
 *
 * Cognito Lambda triggers and the invitations/sessions tables are defined in
 * AuthStack (co-located with the UserPool to avoid circular dependencies).
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
  userPool: cognito.UserPool;
  sellerDashboardClient: cognito.UserPoolClient;
  platformKey: kms.Key;
  eventBus: events.EventBus;
  invitationsTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
}

export class AuthApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;
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

    // Invitations and sessions tables are defined in AuthStack (co-located with
    // Cognito triggers). References passed in via props.
    const invitationsTable = props.invitationsTable;
    const sessionsTable = props.sessionsTable;

    // Tenants table — owned by the independent TenantStack. Referenced by NAME
    // and ARN via SSM parameters (deploy-time string lookup) to avoid a
    // cross-stack construct dependency / CloudFormation cycle. The table is
    // already deployed; these parameters are published by TenantStack.
    const tenantsTableName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/dynamodb/tenants-table`,
    );
    const tenantsTableArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/dynamodb/tenants-table-arn`,
    );

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

    // JWT Authorizer for Cognito User Pool
    const jwtAuthorizer = new HttpJwtAuthorizer('CognitoJwtAuthorizer', 
      `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.sellerDashboardClient.userPoolClientId],
      }
    );


    // -----------------------------------------------------------------------
    // Shared Lambda Configuration
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/auth/handlers');

    const commonLambdaEnv: Record<string, string> = {
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_SELLER_CLIENT_ID: props.sellerDashboardClient.userPoolClientId,
      COGNITO_ISSUER: `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      INVITATIONS_TABLE: invitationsTable.tableName,
      SESSIONS_TABLE: sessionsTable.tableName,
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
        // ESM output: esbuild replaces CommonJS `require` with a stub that
        // throws "Dynamic require of \"x\" is not supported" at runtime. Some
        // transitive CJS dependencies (e.g. lodash's Node `util` type probe via
        // the AWS SDK / powertools graph) perform a dynamic `require('util')`
        // during module initialisation, which crashed every handler on cold
        // start. Provide a real `require` via Node's createRequire so those
        // dynamic requires resolve against the Lambda runtime's built-ins.
        // (CDK's `banner` is a string applied as esbuild's JS banner.)
        banner:
          "import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);",
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

    // NOTE: The server-side POST /auth/login and POST /auth/refresh endpoints
    // were removed. The seller frontend authenticates directly with Cognito via
    // Amplify SRP (USER_SRP_AUTH + PKCE) and refreshes sessions via Amplify
    // (fetchAuthSession forceRefresh), so these Lambdas were unused surface.
    // The rate-limits table and its KMS grants remain for the ForgotPassword
    // handler, which still applies rateLimitMiddleware.

    // Logout
    const logoutFn = createLambda('Logout', path.join(handlersPath, 'logout.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GlobalSignOut'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 4. Forgot Password
    // The forgot-password handler calls Cognito ForgotPassword AND applies
    // rateLimitMiddleware, which writes an atomic counter (UpdateItem) to the
    // customer-managed-KMS-encrypted rate-limits table. The role needs
    // ForgotPassword plus least-privilege write access to that table and the
    // KMS actions a write to a CMK-encrypted table requires (Decrypt +
    // GenerateDataKey), scoped to the specific table and platform key.
    const forgotPasswordFn = createLambda('ForgotPassword', path.join(handlersPath, 'forgot-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ForgotPassword'],
        resources: [props.userPool.userPoolArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:UpdateItem'],
        resources: [this.rateLimitsTable.tableArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [props.platformKey.keyArn],
      }),
    ]);

    // 5. Reset Password
    const resetPasswordFn = createLambda('ResetPassword', path.join(handlersPath, 'reset-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ConfirmForgotPassword'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 6. Verify Email
    const verifyEmailFn = createLambda('VerifyEmail', path.join(handlersPath, 'verify-email.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ConfirmSignUp'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);


    // 7. Change Password
    const changePasswordFn = createLambda('ChangePassword', path.join(handlersPath, 'change-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ChangePassword'],
        resources: [props.userPool.userPoolArn],
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
        resources: [props.userPool.userPoolArn],
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
        resources: [props.userPool.userPoolArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [invitationsTable.tableArn],
      }),
    ]);

    // 11. List Users
    const listUsersFn = createLambda('ListUsers', path.join(handlersPath, 'list-users.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ListUsersInGroup'],
        resources: [props.userPool.userPoolArn],
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
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 13. Disable User
    const disableUserFn = createLambda('DisableUser', path.join(handlersPath, 'disable-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminDisableUser'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 14. Delete User
    const deleteUserFn = createLambda('DeleteUser', path.join(handlersPath, 'delete-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminDeleteUser'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 15. Profile Status (authenticated recovery read)
    // Reads tenant metadata + owner profile from the tenants table and an
    // invitation record from the invitations table (to classify invited users).
    const profileStatusFn = createLambda('ProfileStatus', path.join(handlersPath, 'profile-status.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [tenantsTableArn, invitationsTable.tableArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [props.platformKey.keyArn],
      }),
    ]);
    // TENANTS_TABLE is only needed by the two registration-recovery handlers,
    // so it is set per-function here (not in commonLambdaEnv) to avoid adding
    // it to the 14 unrelated auth functions.
    profileStatusFn.addEnvironment('TENANTS_TABLE', tenantsTableName);

    // 16. Complete Profile (authenticated recovery write)
    // Atomic TransactWriteItems to create tenant metadata + owner profile +
    // consent; GetItem for idempotency/verification reads and invited-user
    // safeguard. Writes are scoped to the tenants table; invitations table is
    // read-only here.
    const completeProfileFn = createLambda('CompleteProfile', path.join(handlersPath, 'complete-profile.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
        resources: [tenantsTableArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [invitationsTable.tableArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [props.platformKey.keyArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [props.eventBus.eventBusArn],
      }),
    ]);
    completeProfileFn.addEnvironment('TENANTS_TABLE', tenantsTableName);

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
    // Route Integrations
    // -----------------------------------------------------------------------

    // Unauthenticated routes (no authorizer)
    // NOTE: POST /auth/login and POST /auth/refresh were removed — the seller
    // frontend authenticates and refreshes directly with Cognito via Amplify
    // SRP, so these server-side endpoints were unused.
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

    // Registration recovery (authenticated — JWT authorizer)
    this.httpApi.addRoutes({
      path: '/auth/profile-status',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ProfileStatusIntegration', profileStatusFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/auth/complete-profile',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CompleteProfileIntegration', completeProfileFn),
      authorizer: jwtAuthorizer,
    });


    // -----------------------------------------------------------------------
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'AuthApiUrlParam', {
      parameterName: `${ssmPrefix}/api/auth-api-url`,
      stringValue: this.httpApi.apiEndpoint,
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

    new cdk.CfnOutput(this, 'RateLimitsTableName', {
      value: this.rateLimitsTable.tableName,
      exportName: `${id}-RateLimitsTableName`,
    });
  }
}

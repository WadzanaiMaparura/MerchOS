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
  /**
   * Durable tenants table (merch-os-tenants-<env>). A REFERENCE to the table
   * owned by the separate MerchOS-Tenant-<env> stack, imported by AuthStack
   * from its SSM export and passed through here. Typed as ITable (imported
   * reference, not a managed construct). The register-pending handler writes
   * PENDINGREG#<id> records to it.
   */
  tenantsTable: dynamodb.ITable;
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
    // CORS allow-list (explicit origins only — never '*')
    // -----------------------------------------------------------------------
    //
    // Each environment keeps its intended custom-domain origin, plus the exact
    // frontend origins required to actually test that environment. The dev
    // environment is currently served by the live seller frontend at
    // https://merchos.co.za (CloudFront in front of the Amplify `main` branch),
    // so that live origin, the raw Amplify branch origin and localhost (local
    // development) are all allowed. We never use '*' — allowCredentials:true
    // forbids it and it would be insecure.
    const customDomainOrigin = `https://${env === 'production' ? 'app' : env}.merchos.io`;
    const corsAllowOrigins: string[] = [customDomainOrigin];
    if (env === 'dev') {
      corsAllowOrigins.push(
        // Live seller frontend (custom domain served via CloudFront). This is
        // the exact Origin the browser sends from the deployed dev frontend.
        'https://merchos.co.za',
        // Raw Amplify branch origin hosting the dev frontend (direct access
        // and pre-custom-domain fallback).
        'https://main.d1jwaah0zt7pg5.amplifyapp.com',
        // Local development.
        'http://localhost:3000',
      );
    }

    // -----------------------------------------------------------------------
    // HTTP API Gateway
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'AuthHttpApi', {
      apiName: `merch-os-auth-api-${env}`,
      description: 'MerchOS Auth API — authentication and user management endpoints',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowOrigins: corsAllowOrigins,
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
      // Pending registrations are stored in the existing tenants table under
      // PENDINGREG#<id>. Referenced by conventional name (table not in-stack).
      TENANTS_TABLE: `merch-os-tenants-${env}`,
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
      // Optional per-handler bundling override, deep-merged onto the shared
      // defaultLambdaProps.bundling. Used to narrowly switch a single handler's
      // output format without affecting the shared ESM defaults.
      bundlingOverride?: Partial<lambdaNodejs.BundlingOptions>,
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
        bundling: {
          ...defaultLambdaProps.bundling,
          ...bundlingOverride,
        },
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
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 2. Refresh
    const refreshFn = createLambda('Refresh', path.join(handlersPath, 'refresh.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminInitiateAuth'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 3. Logout
    const logoutFn = createLambda('Logout', path.join(handlersPath, 'logout.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GlobalSignOut'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 4. Forgot Password
    const forgotPasswordFn = createLambda('ForgotPassword', path.join(handlersPath, 'forgot-password.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ForgotPassword'],
        resources: [props.userPool.userPoolArn],
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

    // 9b. Register Pending (unauthenticated — pre-signup profile capture)
    // Writes a PENDINGREG#<id> record to the durable tenants table. This is the
    // table owned by MerchOS-Tenant-<env>, imported by AuthStack from SSM and
    // passed in via props. The PutItem grant is scoped to its specific ARN.
    const tenantsTable = props.tenantsTable;
    const registerPendingFn = createLambda('RegisterPending', path.join(handlersPath, 'register-pending.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [tenantsTable.tableArn],
      }),
      // The tenants table is CMK-encrypted; writing a pending record needs
      // GenerateDataKey (and Decrypt for the SDK's envelope handling).
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [props.platformKey.keyArn],
      }),
    ],
    // ESM BUNDLING FIX (RegisterPending only): the shared default bundles as
    // ESM (OutputFormat.ESM). A transitive dependency — lodash.merge, pulled in
    // via @aws-lambda-powertools/logger — performs a top-level
    // `require("util").types`. Under esbuild's ESM output that compiles to the
    // `__require` shim, which throws at module init:
    //   "Dynamic require of \"util\" is not supported"
    // crashing the function during INIT (Runtime.Unknown) before the handler
    // runs, so POST /auth/register-pending returns 502. Emitting this one
    // handler as CommonJS preserves a real `require("util")` that Node 20
    // satisfies natively. `mainFields` is flipped to prefer the CJS `main`
    // entrypoint of dependencies to match the CJS output. The shared ESM
    // defaults for every other handler are intentionally left unchanged.
    {
      format: lambdaNodejs.OutputFormat.CJS,
      mainFields: ['main', 'module'],
    });

    // 9c. Profile Status (authenticated recovery read)
    // Reads canonical tenant metadata + owner profile from the tenants table
    // and an invitation record from the invitations table (to classify invited
    // users). Read-only; scoped to the existing tables; CMK Decrypt only.
    const profileStatusFn = createLambda('ProfileStatus', path.join(handlersPath, 'profile-status.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [tenantsTable.tableArn, invitationsTable.tableArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [props.platformKey.keyArn],
      }),
    ]);

    // 9d. Complete Profile (authenticated recovery write)
    // Atomic TransactWriteItems to create the CANONICAL tenant metadata + owner
    // profile + consent; GetItem for idempotency/verification reads and the
    // invited-user safeguard. Writes are scoped to the tenants table; the
    // invitations table is read-only here.
    const completeProfileFn = createLambda('CompleteProfile', path.join(handlersPath, 'complete-profile.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
        resources: [tenantsTable.tableArn],
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

    // 10. Invite User
    const inviteUserFn = createLambda('InviteUser', path.join(handlersPath, 'invite-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          // Compensation / rollback for a partially provisioned invited user
          // (AddToGroup or invitation-record write failed). Enables retry-safe,
          // all-or-nothing invitation creation.
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminDeleteUser',
        ],
        resources: [props.userPool.userPoolArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        // PutItem writes the invitation record. DeleteItem is required for
        // conditional compensation when a write outcome is ambiguous (the
        // record may have committed before the client errored).
        actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem'],
        resources: [invitationsTable.tableArn],
      }),
      // The invitations table is CMK-encrypted. Writing needs GenerateDataKey;
      // the conditional delete reads/evaluates the item and needs Decrypt.
      // Matches the register-pending CMK access pattern.
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [props.platformKey.keyArn],
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

    this.httpApi.addRoutes({
      path: '/auth/register-pending',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('RegisterPendingIntegration', registerPendingFn),
    });

    // Authenticated routes (JWT authorizer)

    // Registration recovery (authenticated — JWT authorizer). Preserves the
    // live GET /auth/profile-status and POST /auth/complete-profile endpoints
    // the seller dashboard depends on.
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

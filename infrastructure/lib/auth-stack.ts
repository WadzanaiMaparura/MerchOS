/**
 * MerchOS Auth Stack
 *
 * Provisions a single AWS Cognito User Pool for all user types (Seller, Support, Admin)
 * with role-based access via Cognito Groups, and all Cognito Lambda triggers.
 *
 * Pool: merch-os-users-{env}
 * Groups: Seller, Support, Admin
 * Triggers: PreSignUp, PostConfirmation, PreTokenGeneration, CustomMessage
 *
 * The triggers live in this stack (not AuthApiStack) to avoid a circular dependency:
 * addTrigger() modifies the UserPool CloudFormation resource, so the trigger Lambdas
 * must reside in the same stack as the UserPool.
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
import { Construct } from 'constructs';
import * as path from 'path';

export interface AuthStackProps extends cdk.StackProps {
  environment: string;
  platformKey: kms.Key;
  eventBus: events.EventBus;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly sellerDashboardClient: cognito.UserPoolClient;
  public readonly apiGatewayClient: cognito.UserPoolClient;
  public readonly adminDashboardClient: cognito.UserPoolClient;
  public readonly invitationsTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;

  /**
   * @deprecated Use userPool instead. Kept for backward compatibility.
   */
  public readonly tenantPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // Tags
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'Auth');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // Unified User Pool
    // -----------------------------------------------------------------------

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `merch-os-users-${env}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        // Immutable tenant id. Can only be populated AT user creation, which is
        // how invited users receive their authoritative tenant (set by the
        // PreSignUp trigger during the invited sign-up). AWS forbids updating
        // an immutable custom attribute after creation.
        tenantId: new cognito.StringAttribute({ mutable: false }),
        // Server-managed MUTABLE tenant id used for the self-signup path, where
        // the tenant id is only known after email verification (PostConfirmation
        // via AdminUpdateUserAttributes). Public app clients are explicitly
        // denied write access to this attribute (see writeAttributes below), so
        // only server-side admin calls can set it. PreTokenGeneration treats
        // custom:tenantId (immutable, invited) OR custom:tenantIdAssigned
        // (mutable, self-signup) as the effective tenant id.
        tenantIdAssigned: new cognito.StringAttribute({ mutable: true }),
        role: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        otp: true,
        sms: false,
      },
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Backward-compat alias
    this.tenantPool = this.userPool;

    // -----------------------------------------------------------------------
    // Cognito Groups
    // -----------------------------------------------------------------------

    new cognito.CfnUserPoolGroup(this, 'SellerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Seller',
      description: 'Seller role — tenant-scoped product management',
    });

    new cognito.CfnUserPoolGroup(this, 'SupportGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Support',
      description: 'Support role — cross-tenant read access for troubleshooting',
    });

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Admin',
      description: 'Admin role — unrestricted platform access',
    });

    // -----------------------------------------------------------------------
    // App Clients
    // -----------------------------------------------------------------------

    // Attribute permissions for app clients.
    //
    // READ: clients may read standard profile attributes plus the server-set
    // tenant/role attributes (needed for the SPA to display context). Reading
    // is safe; it does not permit modification.
    //
    // WRITE: clients may ONLY write the standard profile attributes a user may
    // legitimately self-edit. The tenant/role custom attributes
    // (custom:tenantId, custom:tenantIdAssigned, custom:role) are deliberately
    // OMITTED from the write set, so no public app client can set or alter a
    // user's tenant or role. Only server-side admin operations
    // (AdminUpdateUserAttributes / AdminCreateUser) can write them.
    const clientReadAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({ email: true, emailVerified: true, givenName: true, familyName: true })
      .withCustomAttributes('tenantId', 'tenantIdAssigned', 'role');

    const clientWriteAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({ email: true, givenName: true, familyName: true });
    // NOTE: no .withCustomAttributes(...) on the write set — tenant/role are
    // server-managed and must not be client-writable.

    // Seller Dashboard app client (SPA, PKCE, no secret)
    this.sellerDashboardClient = this.userPool.addClient('SellerDashboardClient', {
      userPoolClientName: `seller-dashboard-${env}`,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`https://${env === 'production' ? 'app' : env}.merchos.io/callback`],
        logoutUrls: [`https://${env === 'production' ? 'app' : env}.merchos.io/logout`],
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      readAttributes: clientReadAttributes,
      writeAttributes: clientWriteAttributes,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      idTokenValidity: cdk.Duration.minutes(60),
    });

    // API Gateway app client (for backend token validation)
    this.apiGatewayClient = this.userPool.addClient('ApiGatewayClient', {
      userPoolClientName: `api-gateway-${env}`,
      authFlows: {
        userSrp: true,
      },
      generateSecret: true,
      preventUserExistenceErrors: true,
      readAttributes: clientReadAttributes,
      writeAttributes: clientWriteAttributes,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Admin Dashboard app client (SPA, PKCE, no secret — same pool)
    this.adminDashboardClient = this.userPool.addClient('AdminDashboardClient', {
      userPoolClientName: `admin-dashboard-${env}`,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`https://admin-${env}.merchos.io/callback`],
        logoutUrls: [`https://admin-${env}.merchos.io/logout`],
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      readAttributes: clientReadAttributes,
      writeAttributes: clientWriteAttributes,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // -----------------------------------------------------------------------
    // DynamoDB Tables (used by Cognito triggers in this stack)
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

    // -----------------------------------------------------------------------
    // Cognito Lambda Triggers
    // These MUST live in the same stack as the UserPool because addTrigger()
    // modifies the UserPool CloudFormation resource to reference Lambda ARNs.
    // -----------------------------------------------------------------------

    const triggersPath = path.join(__dirname, '../../services/auth/triggers');

    const triggerLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      // Note: COGNITO_USER_POOL_ID is intentionally NOT set here. The trigger
      // handlers receive the pool id via the Cognito event payload
      // (event.userPoolId) and do not read it from the environment. Referencing
      // this.userPool.userPoolId here would create an intra-stack circular
      // dependency (UserPool -> LambdaConfig -> Lambda -> env(Ref UserPool)).
      environment: {
        INVITATIONS_TABLE: this.invitationsTable.tableName,
        SESSIONS_TABLE: this.sessionsTable.tableName,
        // Pending-registration records live in the existing tenants table under
        // PENDINGREG#<id>. The table is not defined in this stack; reference it
        // by its conventional name so PostConfirmation can resolve records by id.
        TENANTS_TABLE: `merch-os-tenants-${env}`,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        ENVIRONMENT: env,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
      },
    };

    // PreSignUp trigger — validates invitation exists
    const preSignUpRole = new iam.Role(this, 'PreSignUpRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
      description: 'Execution role for PreSignUp trigger Lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    preSignUpRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        this.invitationsTable.tableArn,
        `${this.invitationsTable.tableArn}/index/email-index`,
      ],
    }));
    // The invitations table is encrypted with the platform CMK, so reading it
    // requires kms:Decrypt on that key. This is a read-only lookup: we grant
    // Decrypt only, NOT GenerateDataKey (which is for writes), keeping the
    // trigger least-privilege.
    preSignUpRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt'],
      resources: [props.platformKey.keyArn],
    }));

    const preSignUpFn = new lambdaNodejs.NodejsFunction(this, 'PreSignUp', {
      ...triggerLambdaProps,
      functionName: `merch-os-auth-presignup-${env}`,
      entry: path.join(triggersPath, 'pre-sign-up.ts'),
      role: preSignUpRole as unknown as iam.IRole,
    });

    // PostConfirmation trigger — records session, emits event
    const postConfirmationRole = new iam.Role(this, 'PostConfirmationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
      description: 'Execution role for PostConfirmation trigger Lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    // Trusted identity assignment: persist custom:tenantId / custom:role via a
    // server-side Cognito operation. The Lambda reads the pool id from the
    // trigger event payload (event.userPoolId) at runtime.
    //
    // IMPORTANT: we must NOT reference this.userPool.userPoolArn here. Because
    // this Lambda is attached to the pool via addTrigger(), referencing the
    // pool's ARN attribute in the role policy creates a CloudFormation cycle:
    //   UserPool -> PostConfirmation (trigger) -> Role policy -> UserPool.
    // Instead we scope to a region/account-bound userpool ARN pattern built
    // from stable stack tokens (region/account), which carries no dependency
    // edge back to the UserPool resource. This stays least-privilege (this
    // account's Cognito user pools in this region) without the wildcard '*'.
    const userPoolArnPattern = cdk.Arn.format(
      {
        service: 'cognito-idp',
        resource: 'userpool',
        resourceName: '*',
      },
      cdk.Stack.of(this),
    );
    postConfirmationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:AdminUpdateUserAttributes'],
      resources: [userPoolArnPattern],
    }));
    // Read the EXACT pending-registration record by id (GetItem on PK) from the
    // existing tenants table under PENDINGREG#<id>. This change only READS the
    // pending record; it must NOT delete it (durable profile/consent writes are
    // gated to the downstream completion path), so no DeleteItem is granted.
    const tenantsTableArn = cdk.Arn.format(
      {
        service: 'dynamodb',
        resource: 'table',
        resourceName: `merch-os-tenants-${env}`,
      },
      cdk.Stack.of(this),
    );
    postConfirmationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [tenantsTableArn],
    }));
    // The tenants table is CMK-encrypted; reading an item requires kms:Decrypt.
    // This is a read-only path, so GenerateDataKey (write) is NOT granted.
    postConfirmationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt'],
      resources: [props.platformKey.keyArn],
    }));
    // NOTE: no events:PutEvents is granted. This stage no longer emits
    // auth.user.registered — that event belongs to the downstream completion
    // path once durable tenant/owner/consent records are committed.

    const postConfirmationFn = new lambdaNodejs.NodejsFunction(this, 'PostConfirmation', {
      ...triggerLambdaProps,
      functionName: `merch-os-auth-postconfirmation-${env}`,
      entry: path.join(triggersPath, 'post-confirmation.ts'),
      role: postConfirmationRole as unknown as iam.IRole,
    });

    // PreTokenGeneration trigger — enriches tokens with group/role claims.
    // The handler reads custom:tenantId and custom:role directly from the event
    // payload (event.request.userAttributes) and does not call any Cognito API,
    // so no cognito-idp permissions are granted. Referencing the pool ARN here
    // would also reintroduce the intra-stack circular dependency.
    const preTokenGenerationRole = new iam.Role(this, 'PreTokenGenerationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
      description: 'Execution role for PreTokenGeneration trigger Lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const preTokenGenerationFn = new lambdaNodejs.NodejsFunction(this, 'PreTokenGeneration', {
      ...triggerLambdaProps,
      functionName: `merch-os-auth-pretokengeneration-${env}`,
      entry: path.join(triggersPath, 'pre-token-generation.ts'),
      role: preTokenGenerationRole as unknown as iam.IRole,
    });

    // CustomMessage trigger — customises email templates
    const customMessageRole = new iam.Role(this, 'CustomMessageRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
      description: 'Execution role for CustomMessage trigger Lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const customMessageFn = new lambdaNodejs.NodejsFunction(this, 'CustomMessage', {
      ...triggerLambdaProps,
      functionName: `merch-os-auth-custommessage-${env}`,
      entry: path.join(triggersPath, 'custom-message.ts'),
      role: customMessageRole as unknown as iam.IRole,
    });

    // Wire triggers to the UserPool (same stack — no circular dependency)
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, preTokenGenerationFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // -----------------------------------------------------------------------
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    const ssmPrefix = `/merch-os/${env}`;

    // Primary pool parameters (new canonical paths)
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `${ssmPrefix}/cognito/user-pool-id`,
      stringValue: this.userPool.userPoolId,
    });

    new ssm.StringParameter(this, 'UserPoolArnParam', {
      parameterName: `${ssmPrefix}/cognito/user-pool-arn`,
      stringValue: this.userPool.userPoolArn,
    });

    // Backward-compat alias (consumed by product-intelligence-stack)
    new ssm.StringParameter(this, 'TenantPoolIdParam', {
      parameterName: `${ssmPrefix}/cognito/tenant-pool-id`,
      stringValue: this.userPool.userPoolId,
    });

    new ssm.StringParameter(this, 'TenantPoolArnParam', {
      parameterName: `${ssmPrefix}/cognito/tenant-pool-arn`,
      stringValue: this.userPool.userPoolArn,
    });

    new ssm.StringParameter(this, 'SellerClientIdParam', {
      parameterName: `${ssmPrefix}/cognito/seller-client-id`,
      stringValue: this.sellerDashboardClient.userPoolClientId,
    });

    new ssm.StringParameter(this, 'AdminClientIdParam', {
      parameterName: `${ssmPrefix}/cognito/admin-client-id`,
      stringValue: this.adminDashboardClient.userPoolClientId,
    });

    new ssm.StringParameter(this, 'InvitationsTableParam', {
      parameterName: `${ssmPrefix}/dynamodb/invitations-table`,
      stringValue: this.invitationsTable.tableName,
    });

    new ssm.StringParameter(this, 'SessionsTableParam', {
      parameterName: `${ssmPrefix}/dynamodb/sessions-table`,
      stringValue: this.sessionsTable.tableName,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${id}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: `${id}-UserPoolArn`,
    });
  }
}

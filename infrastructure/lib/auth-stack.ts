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
        tenantId: new cognito.StringAttribute({ mutable: false }),
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
    postConfirmationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [this.sessionsTable.tableArn],
    }));
    postConfirmationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [props.eventBus.eventBusArn],
    }));

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

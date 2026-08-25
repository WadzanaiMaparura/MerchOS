/**
 * MerchOS Auth Stack
 *
 * Provisions a single AWS Cognito User Pool for all user types (Seller, Support, Admin)
 * with role-based access via Cognito Groups.
 *
 * Pool: merch-os-users-{env}
 * Groups: Seller, Support, Admin
 *
 * Requirements: 2.1, 2.3, 2.9
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  environment: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly sellerDashboardClient: cognito.UserPoolClient;
  public readonly apiGatewayClient: cognito.UserPoolClient;
  public readonly adminDashboardClient: cognito.UserPoolClient;

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
    // SUPERSEDED: Admin Pool (commented out — retained for deployed stack reference)
    // The separate admin pool is no longer used. All user types now exist in the
    // unified pool above, distinguished by Cognito Groups (Seller, Support, Admin).
    // -----------------------------------------------------------------------
    // this.adminPool = new cognito.UserPool(this, 'AdminPool', { ... });

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

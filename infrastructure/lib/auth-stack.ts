/**
 * MerchOS Auth Stack
 *
 * Provisions AWS Cognito user pools for tenant and admin authentication:
 * - merch-os-tenant-pool: Seller users with custom attributes (tenantId, role)
 * - merch-os-admin-pool: MerchOS operator users with mandatory MFA
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
  public readonly tenantPool: cognito.UserPool;
  public readonly adminPool: cognito.UserPool;
  public readonly sellerDashboardClient: cognito.UserPoolClient;
  public readonly apiGatewayClient: cognito.UserPoolClient;
  public readonly adminDashboardClient: cognito.UserPoolClient;

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
    // Tenant User Pool
    // -----------------------------------------------------------------------

    this.tenantPool = new cognito.UserPool(this, 'TenantPool', {
      userPoolName: `merch-os-tenant-pool-${env}`,
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
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Seller Dashboard app client (SPA, PKCE, no secret)
    this.sellerDashboardClient = this.tenantPool.addClient('SellerDashboardClient', {
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
    this.apiGatewayClient = this.tenantPool.addClient('ApiGatewayClient', {
      userPoolClientName: `api-gateway-${env}`,
      authFlows: {
        userSrp: true,
      },
      generateSecret: true,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // -----------------------------------------------------------------------
    // Admin User Pool
    // -----------------------------------------------------------------------

    this.adminPool = new cognito.UserPool(this, 'AdminPool', {
      userPoolName: `merch-os-admin-pool-${env}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: false }),
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        otp: true,
        sms: false,
      },
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Admin Dashboard app client (SPA, PKCE, no secret, MFA required)
    this.adminDashboardClient = this.adminPool.addClient('AdminDashboardClient', {
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
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    const ssmPrefix = `/merch-os/${env}`;

    new ssm.StringParameter(this, 'TenantPoolIdParam', {
      parameterName: `${ssmPrefix}/cognito/tenant-pool-id`,
      stringValue: this.tenantPool.userPoolId,
    });

    new ssm.StringParameter(this, 'TenantPoolArnParam', {
      parameterName: `${ssmPrefix}/cognito/tenant-pool-arn`,
      stringValue: this.tenantPool.userPoolArn,
    });

    new ssm.StringParameter(this, 'AdminPoolIdParam', {
      parameterName: `${ssmPrefix}/cognito/admin-pool-id`,
      stringValue: this.adminPool.userPoolId,
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

    new cdk.CfnOutput(this, 'TenantPoolId', {
      value: this.tenantPool.userPoolId,
      exportName: `${id}-TenantPoolId`,
    });

    new cdk.CfnOutput(this, 'AdminPoolId', {
      value: this.adminPool.userPoolId,
      exportName: `${id}-AdminPoolId`,
    });
  }
}

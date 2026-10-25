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

    // AWS Powertools Lambda layer — provides logger/tracer/metrics at runtime so
    // they can be externalized from the esbuild bundle. The tracer pulls in
    // aws-xray-sdk-core, whose dynamic './aws-xray' require cannot be bundled by
    // esbuild; externalizing (as the product-intelligence stack does) avoids it.
    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${this.region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:latest`,
    );

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
      layers: [powertoolsLayer],
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        externalModules: [
          '@aws-lambda-powertools/logger',
          '@aws-lambda-powertools/tracer',
          '@aws-lambda-powertools/metrics',
        ],
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

    // NOTE: Identity operations (login, refresh, logout, forgot/reset password,
    // verify email, change password, MFA setup, session) are intentionally NOT
    // served by this API. Per ADR-005 they run client-side via the aws-amplify
    // library directly against Cognito. Only privileged/admin operations that
    // require the ADR-001 authorization pipeline or Cognito Admin APIs live here.

    // 1. Invite User
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

    // 2. List Users
    const listUsersFn = createLambda('ListUsers', path.join(handlersPath, 'list-users.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:ListUsersInGroup'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 3. Update Role
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

    // 4. Disable User
    const disableUserFn = createLambda('DisableUser', path.join(handlersPath, 'disable-user.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminDisableUser'],
        resources: [props.userPool.userPoolArn],
      }),
    ]);

    // 5. Delete User
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

    [inviteUserFn, disableUserFn, deleteUserFn, updateRoleFn].forEach((fn) => {
      fn.role!.addToPrincipalPolicy(eventBusPolicy);
    });


    // -----------------------------------------------------------------------
    // Route Integrations
    // -----------------------------------------------------------------------

    // All routes below are privileged/admin operations (ADR-005) and require the
    // JWT authorizer. Identity operations are handled client-side via aws-amplify
    // and have no routes here.
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

/**
 * MerchOS Product API Stack
 *
 * Provisions:
 * - DynamoDB Products table (merch-os-products-{env})
 * - 5 Lambda handlers for Product CRUD
 * - HTTP API with JWT authorizer and Product routes
 * - Least-privilege IAM roles
 * - SSM Parameter exports
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

export interface ProductApiStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.UserPool;
  sellerDashboardClient: cognito.UserPoolClient;
  platformKey: kms.Key;
  eventBus: events.EventBus;
}

export class ProductApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;
  public readonly productsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ProductApiStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const ssmPrefix = `/merch-os/${env}`;

    // Tags
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'ProductApi');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // DynamoDB Products Table
    // -----------------------------------------------------------------------

    this.productsTable = new dynamodb.Table(this, 'ProductsTable', {
      tableName: `merch-os-products-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.productsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // HTTP API Gateway
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'ProductHttpApi', {
      apiName: `merch-os-product-api-${env}`,
      description: 'MerchOS Product API — product CRUD endpoints',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowOrigins: [`https://${env === 'production' ? 'app' : env}.merchos.io`],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // JWT Authorizer for Cognito User Pool
    const jwtAuthorizer = new HttpJwtAuthorizer('ProductCognitoJwtAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.sellerDashboardClient.userPoolClientId],
      }
    );

    // -----------------------------------------------------------------------
    // Shared Lambda Configuration
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/product/api/handlers');

    const commonLambdaEnv: Record<string, string> = {
      PRODUCTS_TABLE: this.productsTable.tableName,
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
        functionName: `merch-os-product-${logicalId.toLowerCase()}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // IAM Policy Statements — Least Privilege
    // -----------------------------------------------------------------------

    const dynamoDbReadWritePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        this.productsTable.tableArn,
        `${this.productsTable.tableArn}/index/GSI1`,
      ],
    });

    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });

    // -----------------------------------------------------------------------
    // Lambda Functions — Product Handlers
    // -----------------------------------------------------------------------

    const createProductFn = createLambda('CreateProduct', path.join(handlersPath, 'create-product.ts'), [
      dynamoDbReadWritePolicy,
      kmsPolicy,
    ]);

    const getProductFn = createLambda('GetProduct', path.join(handlersPath, 'get-product.ts'), [
      dynamoDbReadWritePolicy,
      kmsPolicy,
    ]);

    const listProductsFn = createLambda('ListProducts', path.join(handlersPath, 'list-products.ts'), [
      dynamoDbReadWritePolicy,
      kmsPolicy,
    ]);

    const updateProductFn = createLambda('UpdateProduct', path.join(handlersPath, 'update-product.ts'), [
      dynamoDbReadWritePolicy,
      kmsPolicy,
    ]);

    const archiveProductFn = createLambda('ArchiveProduct', path.join(handlersPath, 'archive-product.ts'), [
      dynamoDbReadWritePolicy,
      kmsPolicy,
    ]);

    // -----------------------------------------------------------------------
    // Route Integrations (all require JWT authorization)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/products',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateProductIntegration', createProductFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/products',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListProductsIntegration', listProductsFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/products/{productId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetProductIntegration', getProductFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/products/{productId}',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('UpdateProductIntegration', updateProductFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/products/{productId}',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('ArchiveProductIntegration', archiveProductFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'ProductApiUrlParam', {
      parameterName: `${ssmPrefix}/product-api/url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new ssm.StringParameter(this, 'ProductsTableNameParam', {
      parameterName: `${ssmPrefix}/product-api/table-name`,
      stringValue: this.productsTable.tableName,
    });

    new ssm.StringParameter(this, 'ProductsTableArnParam', {
      parameterName: `${ssmPrefix}/product-api/table-arn`,
      stringValue: this.productsTable.tableArn,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'ProductApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-ProductApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'ProductsTableName', {
      value: this.productsTable.tableName,
      exportName: `${id}-ProductsTableName`,
    });
  }
}

/**
 * MerchOS Product Intelligence Stack
 *
 * Provisions infrastructure for the Product Intelligence Engine:
 * - DynamoDB single table (product-intelligence-{env}) with GSI1, GSI2
 * - Lambda handler functions (Node.js 20, Powertools, X-Ray)
 * - API Gateway HTTP API with JWT authorization
 * - Least-privilege IAM roles per Lambda with Bedrock InvokeModel for specified model ARNs
 * - SSM parameter exports for cross-stack references
 *
 * Foundation Stack resources are imported via SSM parameters:
 * - Platform KMS key (encryption at rest)
 * - EventBridge bus ARN
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

export interface ProductIntelligenceStackProps extends cdk.StackProps {
  environment: string;
}

export class ProductIntelligenceStack extends cdk.Stack {
  /** DynamoDB single table for all product intelligence data */
  public readonly table: dynamodb.Table;
  /** HTTP API Gateway for the Product Intelligence API */
  public readonly httpApi: HttpApi;
  /** Lambda handler functions */
  public readonly lambdaFunctions: Record<string, lambdaNodejs.NodejsFunction>;

  constructor(scope: Construct, id: string, props: ProductIntelligenceStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const ssmPrefix = `/merch-os/${env}`;

    // -----------------------------------------------------------------------
    // Tags
    // -----------------------------------------------------------------------
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'ProductIntelligence');
    cdk.Tags.of(this).add('TenantScope', 'tenant');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // Import Foundation Stack resources via SSM Parameter Store
    // -----------------------------------------------------------------------

    const platformKeyArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/kms/platform-key-arn`,
    );

    const eventBusArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/eventbridge/bus-arn`,
    );

    // Reconstitute the KMS key from imported ARN
    const platformKey = kms.Key.fromKeyArn(this, 'ImportedPlatformKey', platformKeyArn);

    // -----------------------------------------------------------------------
    // DynamoDB — Product Intelligence Table (Single-Table Design)
    //
    // Access patterns:
    //   Get Result          : PK=TENANT#{tenantId}, SK=RESULT#{resultId}
    //   List Results by Type: PK=TENANT#{tenantId}, SK begins_with RESULT#TYPE#
    //   Get Prompt Template : PK=PROMPT#{generationType}, SK=VERSION#{version}
    //   Cache Lookup        : PK=CACHE#{cacheKey}, SK=ENTRY
    //   Get Token Usage     : PK=TENANT#{tenantId}#USAGE, SK=DAY#/MONTH#
    //   GSI1 - By Date      : GSI1PK=TENANT#{tenantId}, GSI1SK=RESULT#CREATED#{ts}
    //   GSI2 - By Confidence: GSI2PK=TENANT#{tenantId}#CONFIDENCE, GSI2SK=SCORE#...
    //
    // Requirements: 17.1, 17.2
    // -----------------------------------------------------------------------

    this.table = new dynamodb.Table(this, 'ProductIntelligenceTable', {
      tableName: `product-intelligence-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: platformKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1 — list results sorted by creation date (tenant-scoped)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 — list results by confidence score (tenant-scoped)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // AWS Powertools Lambda Layer
    // -----------------------------------------------------------------------

    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${this.region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:latest`,
    );

    // -----------------------------------------------------------------------
    // Shared Lambda configuration
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/product-intelligence/handlers');

    const commonEnv: Record<string, string> = {
      ENVIRONMENT: env,
      TABLE_NAME: this.table.tableName,
      EVENT_BUS_ARN: eventBusArn,
      POWERTOOLS_SERVICE_NAME: 'product-intelligence',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'DEBUG',
    };

    const defaultLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE, // X-Ray enabled (Req 17.5)
      layers: [powertoolsLayer],
      environment: commonEnv,
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
    // IAM Policy Statements — Least-Privilege (Req 17.3)
    //
    // Each Lambda receives only the permissions it needs:
    // 1. DynamoDB: Read/Write to the table and its GSI1, GSI2 indexes
    // 2. Bedrock: InvokeModel ONLY for specified model ARNs
    // 3. EventBridge: PutEvents on the imported event bus
    // 4. KMS: Encrypt/Decrypt on the imported platform key
    // -----------------------------------------------------------------------

    // DynamoDB full read/write access (for generate, batch handlers)
    const dynamoReadWritePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
        'dynamodb:BatchGetItem',
      ],
      resources: [
        this.table.tableArn,
        `${this.table.tableArn}/index/GSI1`,
        `${this.table.tableArn}/index/GSI2`,
      ],
    });

    // DynamoDB read-only access (for get-result, history, usage handlers)
    const dynamoReadOnlyPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:BatchGetItem',
      ],
      resources: [
        this.table.tableArn,
        `${this.table.tableArn}/index/GSI1`,
        `${this.table.tableArn}/index/GSI2`,
      ],
    });

    // Bedrock InvokeModel — restricted to specific model ARNs only (Req 17.3)
    const bedrockInvokePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0',
      ],
    });

    // EventBridge PutEvents — restricted to the platform event bus
    const eventBusPutEventsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [eventBusArn],
    });

    // KMS Encrypt/Decrypt — for DynamoDB encryption operations
    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:GenerateDataKey',
        'kms:DescribeKey',
      ],
      resources: [platformKeyArn],
    });

    // -----------------------------------------------------------------------
    // Helper: create a Lambda with a dedicated least-privilege IAM role
    // -----------------------------------------------------------------------

    const createFn = (
      logicalId: string,
      entry: string,
      policyStatements: iam.PolicyStatement[],
      overrides?: Partial<lambdaNodejs.NodejsFunctionProps>,
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for Product Intelligence ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaBasicExecutionRole',
          ),
          // X-Ray write permissions (Req 17.5)
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });

      for (const stmt of policyStatements) {
        role.addToPolicy(stmt);
      }

      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        ...defaultLambdaProps,
        ...overrides,
        functionName: `merch-os-pi-${logicalId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // Lambda Functions — Each with dedicated least-privilege role (Req 17.3)
    // -----------------------------------------------------------------------

    // POST /intelligence/generate — needs DynamoDB R/W, Bedrock, EventBridge, KMS
    const generateFn = createFn(
      'Generate',
      path.join(handlersPath, 'generate.ts'),
      [dynamoReadWritePolicy, bedrockInvokePolicy, eventBusPutEventsPolicy, kmsPolicy],
      { timeout: cdk.Duration.seconds(60), memorySize: 512 },
    );

    // POST /intelligence/batch — needs DynamoDB R/W, Bedrock, EventBridge, KMS
    const batchFn = createFn(
      'Batch',
      path.join(handlersPath, 'batch.ts'),
      [dynamoReadWritePolicy, bedrockInvokePolicy, eventBusPutEventsPolicy, kmsPolicy],
      { timeout: cdk.Duration.seconds(300), memorySize: 512 },
    );

    // GET /intelligence/results/{resultId} — needs DynamoDB read, KMS
    const getResultFn = createFn(
      'GetResult',
      path.join(handlersPath, 'get-result.ts'),
      [dynamoReadOnlyPolicy, kmsPolicy],
    );

    // GET /intelligence/history — needs DynamoDB read, KMS
    const historyFn = createFn(
      'History',
      path.join(handlersPath, 'history.ts'),
      [dynamoReadOnlyPolicy, kmsPolicy],
    );

    // GET /intelligence/usage — needs DynamoDB read, KMS
    const usageFn = createFn(
      'Usage',
      path.join(handlersPath, 'usage.ts'),
      [dynamoReadOnlyPolicy, kmsPolicy],
    );

    // Expose Lambda functions map
    this.lambdaFunctions = {
      generate: generateFn,
      batch: batchFn,
      getResult: getResultFn,
      history: historyFn,
      usage: usageFn,
    };

    // -----------------------------------------------------------------------
    // API Gateway — HTTP API with JWT Authorizer (Req 17.4)
    // -----------------------------------------------------------------------

    // Read Cognito user pool ID from SSM (set by the Auth platform stack)
    const cognitoUserPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/cognito/tenant-pool-id`,
    );

    const cognitoUserPoolClientId = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/cognito/seller-client-id`,
    );

    // JWT Authorizer backed by the Cognito tenant user pool
    const jwtAuthorizer = new HttpJwtAuthorizer(
      'ProductIntelligenceJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${cognitoUserPoolId}`,
      {
        jwtAudience: [cognitoUserPoolClientId],
      },
    );

    // HTTP API Gateway
    this.httpApi = new HttpApi(this, 'ProductIntelligenceHttpApi', {
      apiName: `merch-os-product-intelligence-api-${env}`,
      description: 'MerchOS Product Intelligence API — AI content generation and optimization',
      corsPreflight: {
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
        ],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [
          `https://${env === 'production' ? 'app' : env}.merchos.io`,
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Apply default throttle at the $default stage (60 rps burst, 30 rps steady)
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 60,
        throttlingRateLimit: 30,
      };
    }

    // Helper: build Lambda integrations
    const integration = (integrationId: string, fn: lambdaNodejs.NodejsFunction) =>
      new HttpLambdaIntegration(integrationId, fn);

    // -----------------------------------------------------------------------
    // API Routes — all require JWT authorization (Req 17.4)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/intelligence/generate',
      methods: [HttpMethod.POST],
      integration: integration('GenerateIntegration', generateFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/intelligence/batch',
      methods: [HttpMethod.POST],
      integration: integration('BatchIntegration', batchFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/intelligence/results/{resultId}',
      methods: [HttpMethod.GET],
      integration: integration('GetResultIntegration', getResultFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/intelligence/history',
      methods: [HttpMethod.GET],
      integration: integration('HistoryIntegration', historyFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/intelligence/usage',
      methods: [HttpMethod.GET],
      integration: integration('UsageIntegration', usageFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // Grant API Gateway permission to invoke each Lambda
    // -----------------------------------------------------------------------

    const apiGwPrincipal = new iam.ServicePrincipal('apigateway.amazonaws.com') as unknown as iam.IPrincipal;
    const apiArn = this.httpApi.arnForExecuteApi('*', '/*', '*');

    const allHandlers: lambdaNodejs.NodejsFunction[] = [
      generateFn,
      batchFn,
      getResultFn,
      historyFn,
      usageFn,
    ];

    for (const fn of allHandlers) {
      fn.addPermission(`${fn.node.id}ApiGwInvoke`, {
        principal: apiGwPrincipal,
        action: 'lambda:InvokeFunction',
        sourceArn: apiArn,
      });
    }

    // -----------------------------------------------------------------------
    // SSM Parameter Store — exports for cross-stack references (Req 17.6)
    //
    // Following /merch-os/{env}/ naming convention
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'TableArnParam', {
      parameterName: `${ssmPrefix}/product-intelligence/table-arn`,
      stringValue: this.table.tableArn,
    });

    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `${ssmPrefix}/product-intelligence/api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new ssm.StringParameter(this, 'ApiIdParam', {
      parameterName: `${ssmPrefix}/product-intelligence/api-id`,
      stringValue: this.httpApi.apiId,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      exportName: `${id}-TableName`,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      exportName: `${id}-TableArn`,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-ApiEndpoint`,
      description: 'HTTP API Gateway endpoint for the Product Intelligence API',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.httpApi.apiId,
      exportName: `${id}-ApiId`,
    });
  }
}

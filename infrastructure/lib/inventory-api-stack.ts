/**
 * MerchOS Inventory API Stack — Phase 8A (Inventory Core)
 *
 * Provisions the full Inventory Core capability:
 *   - Inventory table            (merch-os-inventory-<env>)
 *   - Inventory transactions      (merch-os-inventory-transactions-<env>, append-only ledger)
 *   - HTTP API v2 + Cognito JWT authorizer (existing user pool + seller client)
 *   - 5 Node.js 20 ESM Lambda handlers with dedicated least-privilege IAM roles
 *   - Routes, environment variables, KMS + DynamoDB permissions, SSM exports
 *
 * Conventions follow ProductApiStack: PAY_PER_REQUEST billing, customer-managed
 * KMS encryption with the Foundation platformKey, PITR, RemovalPolicy.RETAIN,
 * NODEJS_20_X ESM bundling with @aws-sdk/* externalized.
 *
 * No DynamoDB Streams, EventBridge, feeds, WhatsApp, marketplace sync,
 * reservations, or notifications in Phase 8A.
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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

export interface InventoryApiStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.UserPool;
  sellerDashboardClient: cognito.UserPoolClient;
  platformKey: kms.Key;
}

export class InventoryApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;
  public readonly inventoryTable: dynamodb.Table;
  public readonly inventoryTransactionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: InventoryApiStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const account = this.account;
    const ssmPrefix = `/merch-os/${env}`;

    // Tags
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'InventoryApi');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // DynamoDB Inventory Table
    //
    // PK: TENANT#<tenantId>
    // SK: SKU#<sku>#WH#<warehouseId>   (matches shared inventorySK() helper)
    // GSI1: GSI1PK = SKU#<sku>, GSI1SK = TENANT#<tenantId>
    //       (all warehouses/tenants for a SKU; tenant-scoped at the app layer)
    //
    // No DynamoDB Streams in Phase 8A.
    // -----------------------------------------------------------------------

    this.inventoryTable = new dynamodb.Table(this, 'InventoryTable', {
      tableName: `merch-os-inventory-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.inventoryTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // DynamoDB Inventory Transactions Table (immutable append-only ledger)
    //
    // PK: TENANT#<tenantId>
    // SK: TXN#<timestamp>#<txnId>      (time-sortable; matches transactionSK())
    // GSI1: GSI1PK = TENANT#<tenantId>#SKU#<sku>, GSI1SK = <timestamp>#<txnId>
    //       (per-SKU, time-ordered ledger history)
    //
    // No Streams, no Glacier lifecycle in Phase 8A. PITR + RETAIN only.
    // -----------------------------------------------------------------------

    this.inventoryTransactionsTable = new dynamodb.Table(this, 'InventoryTransactionsTable', {
      tableName: `merch-os-inventory-transactions-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.inventoryTransactionsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // Cross-stack reference: Products table (for SKU validation reads)
    //
    // The ProductApiStack owns merch-os-products-<env> and exports its name via
    // SSM. Inventory reads it at deploy time for the PRODUCTS_TABLE env var; the
    // ARNs for IAM are reconstructed deterministically from the known table name.
    // -----------------------------------------------------------------------

    const productsTableName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/product-api/table-name`,
    );

    const productsTableArn = `arn:aws:dynamodb:${region}:${account}:table/merch-os-products-${env}`;
    const productsGsi1Arn = `${productsTableArn}/index/GSI1`;

    // -----------------------------------------------------------------------
    // HTTP API Gateway (v2)
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'InventoryHttpApi', {
      apiName: `merch-os-inventory-api-${env}`,
      description: 'MerchOS Inventory API — inventory core CRUD + ledger endpoints',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [`https://${env === 'production' ? 'app' : env}.merchos.io`],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // JWT Authorizer for the existing Cognito User Pool + seller dashboard client
    const jwtAuthorizer = new HttpJwtAuthorizer(
      'InventoryCognitoJwtAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.sellerDashboardClient.userPoolClientId],
      },
    );

    // -----------------------------------------------------------------------
    // Shared Lambda configuration
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/inventory/api/handlers');

    const commonLambdaEnv: Record<string, string> = {
      INVENTORY_TABLE: this.inventoryTable.tableName,
      INVENTORY_TRANSACTIONS_TABLE: this.inventoryTransactionsTable.tableName,
      PRODUCTS_TABLE: productsTableName,
      ENVIRONMENT: env,
      COGNITO_ISSUER: `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
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
    // IAM policy statements — least privilege
    // -----------------------------------------------------------------------

    // Inventory tables: Get + Query + Put. TransactWriteItems permissions are
    // governed by the underlying PutItem on each target table (there is no
    // separate TransactWriteItems IAM action). No UpdateItem/DeleteItem are
    // used (records written via Put-in-transaction; ledger is append-only).
    const inventoryReadWritePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
      ],
      resources: [
        this.inventoryTable.tableArn,
        `${this.inventoryTable.tableArn}/index/GSI1`,
        this.inventoryTransactionsTable.tableArn,
        `${this.inventoryTransactionsTable.tableArn}/index/GSI1`,
      ],
    });

    // Read-only Inventory access for list/get/history Lambdas (no writes).
    const inventoryReadOnlyPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        this.inventoryTable.tableArn,
        `${this.inventoryTable.tableArn}/index/GSI1`,
        this.inventoryTransactionsTable.tableArn,
        `${this.inventoryTransactionsTable.tableArn}/index/GSI1`,
      ],
    });

    // Products table: read-only, GSI1 Query (ProductRepository.findBySku uses a
    // GSI1 QueryCommand) + GetItem. Granted ONLY to update + import Lambdas.
    const productsReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [productsTableArn, productsGsi1Arn],
    });

    // KMS: the Foundation platformKey encrypts all three tables. Decrypt is
    // needed for reads; Encrypt + GenerateDataKey for writes.
    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });

    // -----------------------------------------------------------------------
    // Helper: create a Lambda with a dedicated least-privilege role
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
        functionName: `merch-os-inventory-${logicalId.toLowerCase()}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // Lambda functions — Inventory handlers
    //
    // Read/list/history Lambdas get read-only inventory + KMS (no Products access).
    // Mutating Lambdas (update, import) get read/write inventory + Products read + KMS.
    // -----------------------------------------------------------------------

    const listInventoryFn = createLambda('ListInventory', path.join(handlersPath, 'list-inventory.ts'), [
      inventoryReadOnlyPolicy,
      kmsPolicy,
    ]);

    const getInventoryFn = createLambda('GetInventory', path.join(handlersPath, 'get-inventory.ts'), [
      inventoryReadOnlyPolicy,
      kmsPolicy,
    ]);

    const listTransactionsFn = createLambda('ListTransactions', path.join(handlersPath, 'list-transactions.ts'), [
      inventoryReadOnlyPolicy,
      kmsPolicy,
    ]);

    const updateInventoryFn = createLambda('UpdateInventory', path.join(handlersPath, 'update-inventory.ts'), [
      inventoryReadWritePolicy,
      productsReadPolicy,
      kmsPolicy,
    ]);

    const importInventoryFn = createLambda('ImportInventory', path.join(handlersPath, 'import-inventory.ts'), [
      inventoryReadWritePolicy,
      productsReadPolicy,
      kmsPolicy,
    ]);

    // -----------------------------------------------------------------------
    // Routes (all require JWT authorization)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/inventory',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListInventoryIntegration', listInventoryFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/inventory/{sku}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetInventoryIntegration', getInventoryFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/inventory/{sku}',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('UpdateInventoryIntegration', updateInventoryFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/inventory/import',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ImportInventoryIntegration', importInventoryFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/inventory/{sku}/transactions',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListTransactionsIntegration', listTransactionsFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'InventoryApiUrlParam', {
      parameterName: `${ssmPrefix}/inventory-api/url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new ssm.StringParameter(this, 'InventoryTableNameParam', {
      parameterName: `${ssmPrefix}/inventory-api/table-name`,
      stringValue: this.inventoryTable.tableName,
    });

    new ssm.StringParameter(this, 'InventoryTableArnParam', {
      parameterName: `${ssmPrefix}/inventory-api/table-arn`,
      stringValue: this.inventoryTable.tableArn,
    });

    new ssm.StringParameter(this, 'InventoryTransactionsTableNameParam', {
      parameterName: `${ssmPrefix}/inventory-api/transactions-table-name`,
      stringValue: this.inventoryTransactionsTable.tableName,
    });

    new ssm.StringParameter(this, 'InventoryTransactionsTableArnParam', {
      parameterName: `${ssmPrefix}/inventory-api/transactions-table-arn`,
      stringValue: this.inventoryTransactionsTable.tableArn,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'InventoryApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-InventoryApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'InventoryTableName', {
      value: this.inventoryTable.tableName,
      exportName: `${id}-InventoryTableName`,
    });

    new cdk.CfnOutput(this, 'InventoryTransactionsTableName', {
      value: this.inventoryTransactionsTable.tableName,
      exportName: `${id}-InventoryTransactionsTableName`,
    });
  }
}

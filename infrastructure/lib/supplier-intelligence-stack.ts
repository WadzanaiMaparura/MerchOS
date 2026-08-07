/**
 * MerchOS Supplier Intelligence Stack
 *
 * Provisions infrastructure for the Supplier Intelligence Platform:
 * - DynamoDB tables: Suppliers (with version history) and Import Jobs
 * - SQS FIFO queue (Import Queue) with Dead Letter Queue
 * - Lambda handler and processor functions (Node.js 20, Powertools, X-Ray)
 * - Step Functions Express state machine for the import workflow
 * - SSM parameter exports for cross-stack references
 *
 * Foundation Stack resources are imported via SSM parameters:
 * - Platform KMS key (encryption at rest)
 * - EventBridge bus ARN
 * - S3 raw-uploads bucket name
 * - S3 assets bucket name
 *
 * Requirements: 11.1, 11.2, 11.4, 11.5, 5.2, 5.3
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export interface SupplierIntelligenceStackProps extends cdk.StackProps {
  environment: string;
}

export class SupplierIntelligenceStack extends cdk.Stack {
  /** DynamoDB table for Supplier_Profile records and version history */
  public readonly suppliersTable: dynamodb.Table;
  /** DynamoDB table for Import_Job records */
  public readonly importJobsTable: dynamodb.Table;
  /** SQS FIFO queue for background import processing */
  public readonly importQueue: sqs.Queue;
  /** Dead-letter queue for failed import messages */
  public readonly importDlq: sqs.Queue;
  /** Step Functions Express state machine for the import workflow */
  public readonly importStateMachine: sfn.StateMachine;
  /** HTTP API Gateway for the Supplier API (task 12.3) */
  public readonly httpApi: HttpApi;
  /** Lambda handler functions exposed for API Gateway wiring (task 12.3) */
  public readonly lambdaFunctions: Record<string, lambdaNodejs.NodejsFunction>;

  constructor(scope: Construct, id: string, props: SupplierIntelligenceStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const ssmPrefix = `/merch-os/${env}`;

    // -----------------------------------------------------------------------
    // Tags
    // -----------------------------------------------------------------------
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'SupplierIntelligence');
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

    const assetsBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/s3/assets-bucket`,
    );

    const rawUploadsBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/s3/raw-uploads-bucket`,
    );

    // Reconstitute the KMS key object from the imported ARN so DynamoDB tables
    // can reference it as an IKey.
    const platformKey = kms.Key.fromKeyArn(this, 'ImportedPlatformKey', platformKeyArn);

    // -----------------------------------------------------------------------
    // DynamoDB — Suppliers Table
    //
    // Access patterns:
    //   GetSupplier      : PK=TENANT#{tenantId}, SK=SUPPLIER#{supplierId}
    //   GetVersion       : PK=TENANT#{tenantId}, SK=SUPPLIER#{supplierId}#VERSION#{n}
    //   ListSuppliers    : GSI1 PK=TENANT#{tenantId}, SK begins_with SUPPLIER#CREATED#
    //                      (GSI1PK = TENANT#{tenantId}, GSI1SK = SUPPLIER#CREATED#{createdAt})
    // -----------------------------------------------------------------------

    this.suppliersTable = new dynamodb.Table(this, 'SuppliersTable', {
      tableName: `merch-os-suppliers-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: platformKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1 — list suppliers sorted by creation date (tenant-scoped)
    this.suppliersTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 — reserved for future query patterns (e.g. by status or type)
    this.suppliersTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // DynamoDB — Import Jobs Table
    //
    // Access patterns:
    //   GetImportJob            : PK=TENANT#{tenantId}, SK=IMPORT#{importJobId}
    //   GetSupplierImports(GSI1): GSI1PK=TENANT#{tenantId}#SUPPLIER#{supplierId},
    //                             GSI1SK=IMPORT#CREATED#{createdAt}
    //   ListByStatus (GSI2)     : GSI2PK=TENANT#{tenantId}#STATUS#{status},
    //                             GSI2SK=IMPORT#CREATED#{createdAt}
    // -----------------------------------------------------------------------

    this.importJobsTable = new dynamodb.Table(this, 'ImportJobsTable', {
      tableName: `merch-os-import-jobs-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: platformKey,
      // Import history must be retained for at least 365 days (Req 10.4)
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1 — list import jobs for a specific supplier sorted by creation date
    this.importJobsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 — list import jobs by status sorted by creation date
    this.importJobsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // SQS — Dead-Letter Queue for failed import messages
    //
    // Messages are retained for 14 days to allow manual investigation.
    // A CloudWatch alarm (defined in task 12.4) will alert when DLQ depth > 0.
    // -----------------------------------------------------------------------

    this.importDlq = new sqs.Queue(this, 'ImportDlq', {
      queueName: `supplier-intelligence-import-dlq-${env}.fifo`,
      fifo: true,
      // KMS encryption for FIFO queues uses SQS-managed keys by default; use
      // the platform key for consistency with other resources.
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: platformKey,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // SQS — Import Queue (FIFO)
    //
    // MessageGroupId = tenantId  →  per-tenant FIFO ordering
    // MessageDeduplicationId     →  content-based deduplication on the job ID
    // maxReceiveCount = 3        →  after 3 failures the message moves to DLQ
    // -----------------------------------------------------------------------

    this.importQueue = new sqs.Queue(this, 'ImportQueue', {
      queueName: `supplier-intelligence-import-queue-${env}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: platformKey,
      visibilityTimeout: cdk.Duration.seconds(300), // Allow up to 5 min per message
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.importDlq,
        maxReceiveCount: 3,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // AWS Powertools Lambda Layer
    //
    // Using the official AWS Lambda Powertools for TypeScript layer (ARM64
    // build is used here; swap to X86_64 if your Lambda architecture differs).
    // The layer ARN is region-dependent; resolved at synthesis time via
    // Fn::Sub so it stays portable across regions.
    // -----------------------------------------------------------------------

    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${this.region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:latest`,
    );

    // -----------------------------------------------------------------------
    // Shared Lambda configuration
    // -----------------------------------------------------------------------

    const handlersPath = path.join(__dirname, '../../services/supplier-intelligence/handlers');
    const processorsPath = path.join(__dirname, '../../services/supplier-intelligence/processors');

    const commonEnv: Record<string, string> = {
      ENVIRONMENT: env,
      SUPPLIERS_TABLE: this.suppliersTable.tableName,
      IMPORT_JOBS_TABLE: this.importJobsTable.tableName,
      IMPORT_QUEUE_URL: this.importQueue.queueUrl,
      // These are resolved at runtime via the SSM-sourced token values above
      RAW_UPLOADS_BUCKET: rawUploadsBucketName,
      ASSETS_BUCKET: assetsBucketName,
      EVENT_BUS_ARN: eventBusArn,
      POWERTOOLS_SERVICE_NAME: 'supplier-intelligence',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'DEBUG',
    };

    const defaultLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE, // X-Ray enabled (Req 11.4, 13.3)
      layers: [powertoolsLayer],
      environment: commonEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        externalModules: [
          // Provided by the Powertools layer at runtime
          '@aws-lambda-powertools/logger',
          '@aws-lambda-powertools/tracer',
          '@aws-lambda-powertools/metrics',
        ],
      },
    };

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
        description: `Execution role for ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaBasicExecutionRole',
          ),
          // X-Ray write permissions
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });

      for (const stmt of policyStatements) {
        role.addToPolicy(stmt);
      }

      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        ...defaultLambdaProps,
        ...overrides,
        functionName: `merch-os-si-${logicalId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // Reusable policy statements
    const suppliersTableReadWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
      ],
      resources: [
        this.suppliersTable.tableArn,
        `${this.suppliersTable.tableArn}/index/*`,
      ],
    });

    const importJobsTableReadWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
      ],
      resources: [
        this.importJobsTable.tableArn,
        `${this.importJobsTable.tableArn}/index/*`,
      ],
    });

    const importJobsTableReadOnly = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        this.importJobsTable.tableArn,
        `${this.importJobsTable.tableArn}/index/*`,
      ],
    });

    const eventBusPutEvents = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [eventBusArn],
    });

    const rawUploadsReadWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject', 's3:HeadObject'],
      resources: [`arn:aws:s3:::${rawUploadsBucketName}/*`],
    });

    const assetsWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`arn:aws:s3:::${assetsBucketName}/*`],
    });

    const sqsSendMessage = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sqs:SendMessage'],
      resources: [this.importQueue.queueArn],
    });

    const textractDetect = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['textract:DetectDocumentText'],
      resources: ['*'],
    });

    // -----------------------------------------------------------------------
    // Lambda Functions — Supplier Profile Handlers (Req 1.x, 12.x)
    // -----------------------------------------------------------------------

    const createSupplierFn = createFn('CreateSupplier', path.join(handlersPath, 'create-supplier.ts'), [
      suppliersTableReadWrite,
      eventBusPutEvents,
    ]);

    const listSuppliersFn = createFn('ListSuppliers', path.join(handlersPath, 'list-suppliers.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query'],
        resources: [
          this.suppliersTable.tableArn,
          `${this.suppliersTable.tableArn}/index/GSI1`,
        ],
      }),
    ]);

    const getSupplierFn = createFn('GetSupplier', path.join(handlersPath, 'get-supplier.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [this.suppliersTable.tableArn],
      }),
    ]);

    const updateSupplierFn = createFn('UpdateSupplier', path.join(handlersPath, 'update-supplier.ts'), [
      suppliersTableReadWrite,
      eventBusPutEvents,
    ]);

    const getSupplierVersionsFn = createFn('GetSupplierVersions', path.join(handlersPath, 'get-supplier-versions.ts'), [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query'],
        resources: [this.suppliersTable.tableArn],
      }),
    ]);

    // -----------------------------------------------------------------------
    // Lambda Functions — Import Trigger Handlers (Req 2.x, 3.x, 4.x, 5.x)
    // -----------------------------------------------------------------------

    const triggerFileImportFn = createFn('TriggerFileImport', path.join(handlersPath, 'trigger-file-import.ts'), [
      rawUploadsReadWrite,
      importJobsTableReadWrite,
      sqsSendMessage,
    ], { timeout: cdk.Duration.seconds(60), memorySize: 512 });

    const triggerImageImportFn = createFn('TriggerImageImport', path.join(handlersPath, 'trigger-image-import.ts'), [
      rawUploadsReadWrite,
      importJobsTableReadWrite,
      sqsSendMessage,
    ], { timeout: cdk.Duration.seconds(60), memorySize: 512 });

    const triggerUrlImportFn = createFn('TriggerUrlImport', path.join(handlersPath, 'trigger-url-import.ts'), [
      importJobsTableReadWrite,
      sqsSendMessage,
    ]);

    // -----------------------------------------------------------------------
    // Lambda Functions — Import Job Query Handlers (Req 9.x, 10.x)
    // -----------------------------------------------------------------------

    const listImportJobsFn = createFn('ListImportJobs', path.join(handlersPath, 'list-import-jobs.ts'), [
      importJobsTableReadOnly,
    ]);

    const getImportJobFn = createFn('GetImportJob', path.join(handlersPath, 'get-import-job.ts'), [
      importJobsTableReadOnly,
    ]);

    const getSupplierImportsFn = createFn('GetSupplierImports', path.join(handlersPath, 'get-supplier-imports.ts'), [
      importJobsTableReadOnly,
    ]);

    // -----------------------------------------------------------------------
    // Lambda Function — Import Queue Consumer (Req 5.1, 14.4)
    //
    // Reads from SQS and starts a Step Functions Express execution.
    // The stateMachineArn env var is injected after the state machine is created.
    // -----------------------------------------------------------------------

    const importQueueConsumerFn = createFn('ImportQueueConsumer', path.join(handlersPath, 'import-queue-consumer.ts') as string, [
      importJobsTableReadWrite,
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
        resources: [this.importQueue.queueArn],
      }),
      // StartExecution permission is added after state machine creation below
    ]);

    // -----------------------------------------------------------------------
    // Lambda Functions — WhatsApp Webhook (Req 3.2)
    // -----------------------------------------------------------------------

    const whatsappWebhookFn = createFn('WhatsappWebhook', path.join(handlersPath, 'whatsapp-webhook.ts'), [
      rawUploadsReadWrite,
      importJobsTableReadWrite,
      sqsSendMessage,
    ]);

    // -----------------------------------------------------------------------
    // Lambda Functions — Step Functions Task Processors (Req 2.x, 3.x, 4.x, 6.x, 7.x, 14.x)
    // -----------------------------------------------------------------------

    const fileParserFn = createFn('FileParser', path.join(processorsPath, 'file-parser.ts'), [
      rawUploadsReadWrite,
      importJobsTableReadWrite,
    ], { timeout: cdk.Duration.seconds(300), memorySize: 1024 });

    const pdfParserFn = createFn('PdfParser', path.join(processorsPath, 'pdf-parser.ts'), [
      rawUploadsReadWrite,
      importJobsTableReadWrite,
    ], { timeout: cdk.Duration.seconds(300), memorySize: 1024 });

    const zipHandlerFn = createFn('ZipHandler', path.join(processorsPath, 'zip-handler.ts'), [
      rawUploadsReadWrite,
      importJobsTableReadWrite,
    ], { timeout: cdk.Duration.seconds(300), memorySize: 1024 });

    const imageProcessorFn = createFn('ImageProcessor', path.join(processorsPath, 'image-processor.ts'), [
      rawUploadsReadWrite,
      assetsWrite,
      importJobsTableReadWrite,
      textractDetect,
    ], { timeout: cdk.Duration.seconds(300), memorySize: 512 });

    const urlCrawlerFn = createFn('UrlCrawler', path.join(processorsPath, 'url-crawler.ts'), [
      assetsWrite,
      importJobsTableReadWrite,
    ], { timeout: cdk.Duration.seconds(900), memorySize: 512 });

    const validationEngineFn = createFn('ValidationEngine', path.join(processorsPath, 'validation-engine.ts'), [
      importJobsTableReadWrite,
    ], { timeout: cdk.Duration.seconds(300), memorySize: 512 });

    const duplicateDetectorFn = createFn('DuplicateDetector', path.join(processorsPath, 'duplicate-detector.ts'), [
      importJobsTableReadWrite,
      // Also needs read access to the Products table (resolved at runtime via env var)
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: ['*'], // Products table ARN unknown at synth time — tighten in 12.3
      }),
    ], { timeout: cdk.Duration.seconds(300), memorySize: 512 });

    const productPersisterFn = createFn('ProductPersister', path.join(processorsPath, 'product-persister.ts'), [
      importJobsTableReadWrite,
      eventBusPutEvents,
      // Products table write — tightened in 12.3 when table ARN is available
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:BatchWriteItem'],
        resources: ['*'],
      }),
    ], { timeout: cdk.Duration.seconds(300), memorySize: 512 });

    // -----------------------------------------------------------------------
    // Expose all Lambda functions as a map for task 12.3 (API Gateway wiring)
    // -----------------------------------------------------------------------

    this.lambdaFunctions = {
      createSupplier: createSupplierFn,
      listSuppliers: listSuppliersFn,
      getSupplier: getSupplierFn,
      updateSupplier: updateSupplierFn,
      getSupplierVersions: getSupplierVersionsFn,
      triggerFileImport: triggerFileImportFn,
      triggerImageImport: triggerImageImportFn,
      triggerUrlImport: triggerUrlImportFn,
      listImportJobs: listImportJobsFn,
      getImportJob: getImportJobFn,
      getSupplierImports: getSupplierImportsFn,
      importQueueConsumer: importQueueConsumerFn,
      whatsappWebhook: whatsappWebhookFn,
      // Processors (also exposed so 12.3 can grant SFN invoke policy)
      fileParser: fileParserFn,
      pdfParser: pdfParserFn,
      zipHandler: zipHandlerFn,
      imageProcessor: imageProcessorFn,
      urlCrawler: urlCrawlerFn,
      validationEngine: validationEngineFn,
      duplicateDetector: duplicateDetectorFn,
      productPersister: productPersisterFn,
    };

    // -----------------------------------------------------------------------
    // Step Functions — Retry configurations (Req 5.3, 14.1, 14.2)
    // -----------------------------------------------------------------------

    /** Retry policy for transient Lambda/network errors (Req 5.3) */
    const transientRetry: sfn.RetryProps = {
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException', 'States.TaskFailed'],
      maxAttempts: 3,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2,
    };

    /** Retry policy for DynamoDB throttling (Req 14.2) */
    const dynamoThrottleRetry: sfn.RetryProps = {
      errors: ['DynamoDB.ProvisionedThroughputExceededException', 'DynamoDB.RequestLimitExceeded'],
      maxAttempts: 5,
      interval: cdk.Duration.seconds(1),
      backoffRate: 2,
      jitterStrategy: sfn.JitterType.FULL,
    };

    /** Retry policy for S3 failures (Req 14.1) */
    const s3Retry: sfn.RetryProps = {
      errors: ['S3.S3Exception', 'S3.NoSuchBucketException', 'S3.NoSuchKeyException'],
      maxAttempts: 3,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2,
    };

    // Helper: apply the full set of retry policies to a Lambda invoke task
    const withRetries = (task: tasks.LambdaInvoke): tasks.LambdaInvoke =>
      task.addRetry(transientRetry).addRetry(dynamoThrottleRetry).addRetry(s3Retry) as tasks.LambdaInvoke;

    // -----------------------------------------------------------------------
    // Step Functions — State machine states
    //
    // Workflow: DetermineSourceType → Parse → Validate → Deduplicate → Persist
    // -----------------------------------------------------------------------

    // Terminal states
    const importSucceeded = new sfn.Succeed(this, 'ImportSucceeded');

    const importFailed = new tasks.LambdaInvoke(this, 'HandleFailure', {
      lambdaFunction: productPersisterFn, // re-uses persister to record failure + emit event
      payload: sfn.TaskInput.fromObject({
        action: 'RECORD_FAILURE',
        'jobId.$': '$.importJobId',
        'tenantId.$': '$.tenantId',
        'error.$': '$.error',
      }),
      resultPath: '$.failureResult',
      comment: 'Records the failure in DynamoDB and emits ImportJobFailed event',
    });
    importFailed.next(new sfn.Fail(this, 'ImportFailed', {
      errorPath: '$.error.code',
      causePath: '$.error.message',
    }));

    // Step 5 — Persist products (maps to product-persister.ts)
    const persistProducts = withRetries(
      new tasks.LambdaInvoke(this, 'PersistProducts', {
        lambdaFunction: productPersisterFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.persistResult',
        comment: 'Batch-writes Product records in DRAFT state, updates ImportJob to COMPLETED',
      }),
    );
    persistProducts.next(importSucceeded);
    persistProducts.addCatch(importFailed, { resultPath: '$.error' });

    // Step 4 — Deduplicate (maps to duplicate-detector.ts)
    const detectDuplicates = withRetries(
      new tasks.LambdaInvoke(this, 'DetectDuplicates', {
        lambdaFunction: duplicateDetectorFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.deduplicationResult',
        comment: 'Checks SKU exact match and title similarity (threshold 0.85), applies duplicate strategy',
      }),
    );
    detectDuplicates.next(persistProducts);
    detectDuplicates.addCatch(importFailed, { resultPath: '$.error' });

    // Step 3 — Validate (maps to validation-engine.ts)
    const validateRecords = withRetries(
      new tasks.LambdaInvoke(this, 'ValidateRecords', {
        lambdaFunction: validationEngineFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.validationResult',
        comment: 'Validates required fields, normalises prices, coerces types; produces ValidationResult summary',
      }),
    );
    validateRecords.next(detectDuplicates);
    validateRecords.addCatch(importFailed, { resultPath: '$.error' });

    // Step 2 — Parse (choice branches for each source type)

    const parseFile = withRetries(
      new tasks.LambdaInvoke(this, 'ParseFile', {
        lambdaFunction: fileParserFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.parseResult',
        comment: 'Parses CSV or Excel files; maps columns to Product fields',
      }),
    );
    parseFile.next(validateRecords);
    parseFile.addCatch(importFailed, { resultPath: '$.error' });

    const parsePdf = withRetries(
      new tasks.LambdaInvoke(this, 'ParsePdf', {
        lambdaFunction: pdfParserFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.parseResult',
        comment: 'Extracts text and tabular data from PDF catalogues',
      }),
    );
    parsePdf.next(validateRecords);
    parsePdf.addCatch(importFailed, { resultPath: '$.error' });

    const handleZip = withRetries(
      new tasks.LambdaInvoke(this, 'HandleZip', {
        lambdaFunction: zipHandlerFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.parseResult',
        comment: 'Extracts ZIP archive entries and routes each to the correct parser',
      }),
    );
    handleZip.next(validateRecords);
    handleZip.addCatch(importFailed, { resultPath: '$.error' });

    const processImages = withRetries(
      new tasks.LambdaInvoke(this, 'ProcessImages', {
        lambdaFunction: imageProcessorFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.parseResult',
        comment: 'Runs Textract OCR on product images; flags fields with confidence < 0.70',
      }),
    );
    processImages.next(validateRecords);
    processImages.addCatch(importFailed, { resultPath: '$.error' });

    const crawlUrl = withRetries(
      new tasks.LambdaInvoke(this, 'CrawlUrl', {
        lambdaFunction: urlCrawlerFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: { 'result.$': '$.Payload' },
        resultPath: '$.parseResult',
        comment: 'BFS web crawler with robots.txt compliance, rate limiting, and circuit breaker',
      }),
    );
    crawlUrl.next(validateRecords);
    crawlUrl.addCatch(importFailed, { resultPath: '$.error' });

    // Step 1 — DetermineSourceType: routes to the correct parser
    const determineSourceType = new sfn.Choice(this, 'DetermineSourceType', {
      comment: 'Routes import job to the correct parser based on sourceType',
    })
      .when(
        sfn.Condition.or(
          sfn.Condition.stringEquals('$.sourceType', 'FILE_CSV'),
          sfn.Condition.stringEquals('$.sourceType', 'FILE_EXCEL'),
        ),
        parseFile,
      )
      .when(sfn.Condition.stringEquals('$.sourceType', 'FILE_PDF'), parsePdf)
      .when(sfn.Condition.stringEquals('$.sourceType', 'FILE_ZIP'), handleZip)
      .when(sfn.Condition.stringEquals('$.sourceType', 'IMAGE'), processImages)
      .when(sfn.Condition.stringEquals('$.sourceType', 'URL'), crawlUrl)
      .otherwise(importFailed);

    // -----------------------------------------------------------------------
    // Step Functions — Express State Machine
    //
    // Express execution model is used because:
    //  - It supports high-throughput, short-duration workflows
    //  - Execution history is available via CloudWatch Logs
    //  - Cost is based on number of state transitions, not duration
    // -----------------------------------------------------------------------

    this.importStateMachine = new sfn.StateMachine(this, 'ImportStateMachine', {
      stateMachineName: `merch-os-si-import-workflow-${env}`,
      definitionBody: sfn.DefinitionBody.fromChainable(determineSourceType),
      stateMachineType: sfn.StateMachineType.EXPRESS,
      // Express state machines require a CloudWatch log group for execution history
      logs: {
        destination: new cdk.aws_logs.LogGroup(this, 'ImportStateMachineLogGroup', {
          logGroupName: `/aws/states/merch-os-si-import-workflow-${env}`,
          retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      },
      tracingEnabled: true, // X-Ray (Req 13.3)
      timeout: cdk.Duration.minutes(30),
    });

    // Grant the queue consumer the ability to start executions on the state machine
    this.importStateMachine.grantStartExecution(importQueueConsumerFn);

    // Inject the state machine ARN into the consumer's env after creation
    importQueueConsumerFn.addEnvironment(
      'IMPORT_STATE_MACHINE_ARN',
      this.importStateMachine.stateMachineArn,
    );

    // -----------------------------------------------------------------------
    // SSM — export state machine ARN for downstream stacks
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'ImportStateMachineArnParam', {
      parameterName: `${ssmPrefix}/stepfunctions/import-state-machine-arn`,
      stringValue: this.importStateMachine.stateMachineArn,
    });

    // -----------------------------------------------------------------------
    // SSM Parameter Store — exports for downstream stacks (12.2, 12.3)
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'SuppliersTableNameParam', {
      parameterName: `${ssmPrefix}/dynamodb/suppliers-table`,
      stringValue: this.suppliersTable.tableName,
    });

    new ssm.StringParameter(this, 'SuppliersTableArnParam', {
      parameterName: `${ssmPrefix}/dynamodb/suppliers-table-arn`,
      stringValue: this.suppliersTable.tableArn,
    });

    new ssm.StringParameter(this, 'ImportJobsTableNameParam', {
      parameterName: `${ssmPrefix}/dynamodb/import-jobs-table`,
      stringValue: this.importJobsTable.tableName,
    });

    new ssm.StringParameter(this, 'ImportJobsTableArnParam', {
      parameterName: `${ssmPrefix}/dynamodb/import-jobs-table-arn`,
      stringValue: this.importJobsTable.tableArn,
    });

    new ssm.StringParameter(this, 'ImportQueueUrlParam', {
      parameterName: `${ssmPrefix}/sqs/import-queue-url`,
      stringValue: this.importQueue.queueUrl,
    });

    new ssm.StringParameter(this, 'ImportQueueArnParam', {
      parameterName: `${ssmPrefix}/sqs/import-queue-arn`,
      stringValue: this.importQueue.queueArn,
    });

    new ssm.StringParameter(this, 'ImportDlqUrlParam', {
      parameterName: `${ssmPrefix}/sqs/import-dlq-url`,
      stringValue: this.importDlq.queueUrl,
    });

    new ssm.StringParameter(this, 'ImportDlqArnParam', {
      parameterName: `${ssmPrefix}/sqs/import-dlq-arn`,
      stringValue: this.importDlq.queueArn,
    });

    // -----------------------------------------------------------------------
    // API Gateway — HTTP API with JWT Authorizer (Task 12.3)
    //
    // Requirements: 11.3, 12.1, 12.5
    //
    // All supplier management endpoints require a valid Cognito JWT.
    // The WhatsApp webhook endpoint is public (HMAC-signed by the application
    // layer itself).  A default throttle is applied at the stage level to
    // enforce platform-wide rate limits before requests even reach Lambda.
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
      'SupplierApiJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${cognitoUserPoolId}`,
      {
        jwtAudience: [cognitoUserPoolClientId],
      },
    );

    // HTTP API Gateway — no default authorizer so the webhook route stays open
    this.httpApi = new HttpApi(this, 'SupplierHttpApi', {
      apiName: `merch-os-supplier-api-${env}`,
      description: 'MerchOS Supplier Intelligence API — supplier management and import endpoints',
      corsPreflight: {
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Hub-Signature-256',
        ],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [
          `https://${env === 'production' ? 'app' : env}.merchos.io`,
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
      // Disable the built-in execute-api endpoint if you later add a custom
      // domain; leave enabled for now so the stack is immediately usable.
      // createDefaultStage is true by default — we override stage settings below.
    });

    // Apply a default throttle at the $default stage so every route is covered.
    // Individual routes can add tighter limits via rateLimitMiddleware in the handler.
    //
    // API Gateway level throttle: 100 rps burst, 50 rps steady rate (Req 12.5).
    // Application-layer throttling (100 req/min per tenant for standard endpoints,
    // 10 req/min for import triggers) is enforced by rateLimitMiddleware inside
    // each Lambda.
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      };
    }

    // Helper: build a Lambda integration once and reuse
    const integration = (id: string, fn: lambdaNodejs.NodejsFunction) =>
      new HttpLambdaIntegration(id, fn);

    // -----------------------------------------------------------------------
    // Supplier Profile routes (all require JWT)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/suppliers',
      methods: [HttpMethod.POST],
      integration: integration('CreateSupplierIntegration', createSupplierFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers',
      methods: [HttpMethod.GET],
      integration: integration('ListSuppliersIntegration', listSuppliersFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}',
      methods: [HttpMethod.GET],
      integration: integration('GetSupplierIntegration', getSupplierFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}',
      methods: [HttpMethod.PUT],
      integration: integration('UpdateSupplierIntegration', updateSupplierFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}/versions',
      methods: [HttpMethod.GET],
      integration: integration('GetSupplierVersionsIntegration', getSupplierVersionsFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // Import trigger routes (JWT required; tighter rate limit enforced in Lambda)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}/imports/file',
      methods: [HttpMethod.POST],
      integration: integration('TriggerFileImportIntegration', triggerFileImportFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}/imports/images',
      methods: [HttpMethod.POST],
      integration: integration('TriggerImageImportIntegration', triggerImageImportFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}/imports/url',
      methods: [HttpMethod.POST],
      integration: integration('TriggerUrlImportIntegration', triggerUrlImportFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // Import Job query routes (JWT required)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/imports',
      methods: [HttpMethod.GET],
      integration: integration('ListImportJobsIntegration', listImportJobsFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/imports/{importJobId}',
      methods: [HttpMethod.GET],
      integration: integration('GetImportJobIntegration', getImportJobFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/suppliers/{supplierId}/imports',
      methods: [HttpMethod.GET],
      integration: integration('GetSupplierImportsIntegration', getSupplierImportsFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // WhatsApp webhook — NO JWT authorizer (HMAC validated inside the handler)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/webhooks/whatsapp',
      methods: [HttpMethod.POST],
      integration: integration('WhatsappWebhookIntegration', whatsappWebhookFn),
      // Intentionally no authorizer — HMAC signature verified in handler (Req 3.2)
    });

    // -----------------------------------------------------------------------
    // Grant API Gateway permission to invoke each Lambda
    //
    // HttpLambdaIntegration calls addPermission automatically for managed
    // integrations, but we add explicit resource-based policies here so that
    // the permissions are visible in the stack and auditable.
    // -----------------------------------------------------------------------

    const apiGwPrincipal = new iam.ServicePrincipal('apigateway.amazonaws.com') as unknown as iam.IPrincipal;
    const apiArn = this.httpApi.arnForExecuteApi('*', '/*', '*');

    const authorisedHandlers: lambdaNodejs.NodejsFunction[] = [
      createSupplierFn,
      listSuppliersFn,
      getSupplierFn,
      updateSupplierFn,
      getSupplierVersionsFn,
      triggerFileImportFn,
      triggerImageImportFn,
      triggerUrlImportFn,
      listImportJobsFn,
      getImportJobFn,
      getSupplierImportsFn,
      whatsappWebhookFn,
    ];

    for (const fn of authorisedHandlers) {
      fn.addPermission(`${fn.node.id}ApiGwInvoke`, {
        principal: apiGwPrincipal,
        action: 'lambda:InvokeFunction',
        sourceArn: apiArn,
      });
    }

    // -----------------------------------------------------------------------
    // SSM — export API Gateway endpoint for frontend and other stacks
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'SupplierApiUrlParam', {
      parameterName: `${ssmPrefix}/api/supplier-api-url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    // -----------------------------------------------------------------------
    // CloudWatch Alarms — Monitoring & Alerting (Task 12.4)
    //
    // Requirements: 11.6, 13.1, 13.2, 13.3
    //
    // Alarms:
    //  1. Import_Job failure rate > 10% over 5 minutes
    //  2. Import_Queue depth > 100 messages
    //  3. Lambda error rate > 5% (using import-queue-consumer as representative)
    //  4. DLQ depth > 0 messages
    // -----------------------------------------------------------------------

    // --- Alarm 1: Import Job failure rate > 10% over 5 minutes ---
    // Uses Step Functions ExecutionsFailed / ExecutionsStarted metrics with a
    // math expression to compute the percentage.

    const sfnExecutionsFailed = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsFailed',
      dimensionsMap: {
        StateMachineArn: this.importStateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const sfnExecutionsStarted = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsStarted',
      dimensionsMap: {
        StateMachineArn: this.importStateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const importJobFailureRateExpression = new cloudwatch.MathExpression({
      expression: '(failures / total) * 100',
      label: 'Import Job Failure Rate (%)',
      usingMetrics: {
        failures: sfnExecutionsFailed,
        total: sfnExecutionsStarted,
      },
      period: cdk.Duration.minutes(5),
    });

    new cloudwatch.Alarm(this, 'ImportJobFailureRateAlarm', {
      alarmName: `merch-os-si-import-job-failure-rate-${env}`,
      alarmDescription:
        'Triggers when Import_Job failure rate exceeds 10% over a 5-minute window (Req 11.6)',
      metric: importJobFailureRateExpression,
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- Alarm 2: Import Queue depth > 100 messages ---

    const importQueueDepthMetric = this.importQueue.metricApproximateNumberOfMessagesVisible({
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    });

    new cloudwatch.Alarm(this, 'ImportQueueDepthAlarm', {
      alarmName: `merch-os-si-import-queue-depth-${env}`,
      alarmDescription:
        'Triggers when Import_Queue depth exceeds 100 messages (Req 11.6)',
      metric: importQueueDepthMetric,
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- Alarm 3: Lambda error rate > 5% (import-queue-consumer representative) ---
    // Uses the import-queue-consumer Lambda as the representative function since
    // it is the critical entry point that triggers the entire import workflow.

    const lambdaErrors = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: importQueueConsumerFn.functionName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaInvocations = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Invocations',
      dimensionsMap: {
        FunctionName: importQueueConsumerFn.functionName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const lambdaErrorRateExpression = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      label: 'Lambda Error Rate (%)',
      usingMetrics: {
        errors: lambdaErrors,
        invocations: lambdaInvocations,
      },
      period: cdk.Duration.minutes(5),
    });

    new cloudwatch.Alarm(this, 'LambdaErrorRateAlarm', {
      alarmName: `merch-os-si-lambda-error-rate-${env}`,
      alarmDescription:
        'Triggers when Lambda error rate exceeds 5% over a 5-minute window (Req 11.6, 13.2)',
      metric: lambdaErrorRateExpression,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- Alarm 4: DLQ depth > 0 messages ---
    // Any message in the DLQ indicates a processing failure that requires
    // manual investigation. Alert immediately.

    const dlqDepthMetric = this.importDlq.metricApproximateNumberOfMessagesVisible({
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    });

    new cloudwatch.Alarm(this, 'ImportDlqDepthAlarm', {
      alarmName: `merch-os-si-import-dlq-depth-${env}`,
      alarmDescription:
        'Triggers when any message lands in the Import DLQ — requires manual investigation (Req 11.6, 14.4)',
      metric: dlqDepthMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'SuppliersTableName', {
      value: this.suppliersTable.tableName,
      exportName: `${id}-SuppliersTableName`,
    });

    new cdk.CfnOutput(this, 'ImportJobsTableName', {
      value: this.importJobsTable.tableName,
      exportName: `${id}-ImportJobsTableName`,
    });

    new cdk.CfnOutput(this, 'ImportQueueUrl', {
      value: this.importQueue.queueUrl,
      exportName: `${id}-ImportQueueUrl`,
    });

    new cdk.CfnOutput(this, 'ImportDlqUrl', {
      value: this.importDlq.queueUrl,
      exportName: `${id}-ImportDlqUrl`,
    });

    // Expose imported Foundation Stack values as outputs for visibility
    new cdk.CfnOutput(this, 'EventBusArn', {
      value: eventBusArn,
      exportName: `${id}-EventBusArn`,
    });

    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: assetsBucketName,
      exportName: `${id}-AssetsBucketName`,
    });

    new cdk.CfnOutput(this, 'RawUploadsBucketName', {
      value: rawUploadsBucketName,
      exportName: `${id}-RawUploadsBucketName`,
    });

    new cdk.CfnOutput(this, 'SupplierApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-SupplierApiEndpoint`,
      description: 'HTTP API Gateway endpoint for the Supplier Intelligence API',
    });
  }
}

/**
 * MerchOS Image Intelligence Stack (Phase 1 — Foundations)
 *
 * Provisions the backbone for the Image Intelligence Engine:
 * - DynamoDB Image_Jobs table (single-table, tenant-scoped) with GSI1 + TTL
 * - S3 quarantine lifecycle rule on the shared assets bucket (30-day expiry)
 * - API Lambdas: upload-url (presign), start-process (create job), get-image
 * - HTTP API with Cognito JWT authorizer + routes
 * - Least-privilege IAM per Lambda
 * - SSM exports for cross-stack references
 *
 * Foundation resources are imported via SSM (KMS, EventBridge bus, raw-uploads
 * + assets buckets). Processing Lambdas, Step Functions, CloudFront, and the
 * Bedrock enhancement step are added in later phases.
 *
 * Requirements: 1.*, 2.3, 7.1, 8.*
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ImageIntelligenceStackProps extends cdk.StackProps {
  environment: string;
}

export class ImageIntelligenceStack extends cdk.Stack {
  /** DynamoDB table for Image_Job records. */
  public readonly imageJobsTable: dynamodb.Table;
  /** HTTP API Gateway for the Image Intelligence API. */
  public readonly httpApi: HttpApi;
  /** Lambda handler functions exposed for later phases (workflow wiring). */
  public readonly lambdaFunctions: Record<string, lambdaNodejs.NodejsFunction>;

  constructor(scope: Construct, id: string, props: ImageIntelligenceStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const ssmPrefix = `/merch-os/${env}`;

    // -----------------------------------------------------------------------
    // Tags
    // -----------------------------------------------------------------------
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'ImageIntelligence');
    cdk.Tags.of(this).add('TenantScope', 'tenant');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // Import Foundation + Auth resources via SSM
    // -----------------------------------------------------------------------
    const platformKeyArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/kms/platform-key-arn`,
    );
    const secretsKeyArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/kms/secrets-key-arn`,
    );
    const eventBusArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/eventbridge/bus-arn`,
    );
    const eventBusName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/eventbridge/bus-name`,
    );
    const rawUploadsBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/s3/raw-uploads-bucket`,
    );
    const assetsBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/s3/assets-bucket`,
    );
    const cognitoUserPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/cognito/tenant-pool-id`,
    );
    const cognitoSellerClientId = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/cognito/seller-client-id`,
    );

    const platformKey = kms.Key.fromKeyArn(this, 'ImportedPlatformKey', platformKeyArn);

    // Products table ARN — reconstructed deterministically from the fixed naming
    // convention (same approach as the Inventory/Supplier stacks, G09). The
    // persist step updates content.imageRefs on this table.
    const productsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/merch-os-products-${env}`;

    // Reconstitute bucket references and deterministic ARNs (same convention as
    // the Inventory/Supplier stacks — bucket names follow a fixed pattern).
    const rawUploadsBucketArn = `arn:aws:s3:::${rawUploadsBucketName}`;
    const assetsBucketArn = `arn:aws:s3:::${assetsBucketName}`;

    // -----------------------------------------------------------------------
    // DynamoDB — Image_Jobs table
    //
    // Access patterns:
    //   GetImageJob          : PK=TENANT#{tenantId}, SK=IMAGEJOB#{imageJobId}
    //   ListByProduct (GSI1) : GSI1PK=TENANT#{tenantId}#PRODUCT#{productId},
    //                          GSI1SK=IMAGEJOB#CREATED#{createdAt}
    // -----------------------------------------------------------------------
    this.imageJobsTable = new dynamodb.Table(this, 'ImageJobsTable', {
      tableName: `merch-os-image-jobs-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: platformKey,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.imageJobsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // S3 — quarantine lifecycle rule on the shared assets bucket
    //
    // Moderation-rejected images are moved under images/{tenantId}/quarantine/
    // and auto-expire after 30 days (requirement 2.3). The bucket itself is
    // owned by the Foundation stack; we attach a lifecycle rule by reference.
    // -----------------------------------------------------------------------
    const assetsBucket = s3.Bucket.fromBucketAttributes(this, 'ImportedAssetsBucket', {
      bucketName: assetsBucketName,
      bucketArn: assetsBucketArn,
    });
    // NOTE: lifecycle rules on an imported bucket cannot be added via the L2
    // reference. The quarantine expiry rule is declared on the Foundation
    // assets bucket in a follow-up Foundation change (tracked in tasks.md #3);
    // referenced here for documentation. We keep the import for IAM scoping.

    // -----------------------------------------------------------------------
    // Shared Lambda configuration (Node 20 ESM, Powertools externalized — G18)
    // -----------------------------------------------------------------------
    const handlersPath = path.join(__dirname, '../../services/image-intelligence/handlers');
    const region = this.region;

    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:latest`,
    );

    const commonEnv: Record<string, string> = {
      ENVIRONMENT: env,
      IMAGE_JOBS_TABLE: this.imageJobsTable.tableName,
      RAW_UPLOADS_BUCKET: rawUploadsBucketName,
      ASSETS_BUCKET: assetsBucketName,
      EVENT_BUS_NAME: eventBusName,
      EVENT_BUS_ARN: eventBusArn,
      COGNITO_ISSUER: `https://cognito-idp.${region}.amazonaws.com/${cognitoUserPoolId}`,
      POWERTOOLS_SERVICE_NAME: 'image-intelligence',
      LOG_LEVEL: env === 'production' ? 'WARN' : 'DEBUG',
    };

    const defaultLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
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
    // IAM policy statements
    // -----------------------------------------------------------------------
    const imageJobsReadWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [
        this.imageJobsTable.tableArn,
        `${this.imageJobsTable.tableArn}/index/GSI1`,
      ],
    });

    const imageJobsReadOnly = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        this.imageJobsTable.tableArn,
        `${this.imageJobsTable.tableArn}/index/GSI1`,
      ],
    });

    const rawUploadsPut = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${rawUploadsBucketArn}/images/*`],
    });

    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'],
      resources: [platformKeyArn],
    });

    // -----------------------------------------------------------------------
    // createFn helper — one dedicated least-privilege role per Lambda
    // -----------------------------------------------------------------------
    const createFn = (
      logicalId: string,
      entry: string,
      policyStatements: iam.PolicyStatement[],
      overrides?: Partial<lambdaNodejs.NodejsFunctionProps>,
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for Image Intelligence ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        ],
      });
      for (const stmt of policyStatements) {
        role.addToPolicy(stmt);
      }
      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        ...defaultLambdaProps,
        ...overrides,
        functionName: `merch-os-img-${logicalId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // API Lambdas (Phase 1)
    // -----------------------------------------------------------------------
    const uploadUrlFn = createFn(
      'UploadUrl',
      path.join(handlersPath, 'upload-url.ts'),
      [rawUploadsPut, kmsPolicy],
    );

    const startProcessFn = createFn(
      'StartProcess',
      path.join(handlersPath, 'start-process.ts'),
      [imageJobsReadWrite, kmsPolicy],
    );

    const getImageFn = createFn(
      'GetImage',
      path.join(handlersPath, 'get-image.ts'),
      [imageJobsReadOnly, kmsPolicy],
    );

    // -----------------------------------------------------------------------
    // Processing Lambdas + Step Functions workflow (Phase 2)
    // -----------------------------------------------------------------------
    const processorsPath = path.join(__dirname, '../../services/image-intelligence/processors');

    // Sharp Lambda layer — provides the linux-x64 native binary at runtime so
    // the background-removal and packager Lambdas can externalize `sharp`.
    const sharpLayer = new lambda.LayerVersion(this, 'SharpLayer', {
      layerVersionName: `merch-os-img-sharp-${env}`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../services/image-intelligence/layers/sharp'),
      ),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      description: 'Sharp image-processing library (linux-x64) for Image Intelligence',
    });

    // IAM statements for processors
    const rekognitionDetect = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      // Rekognition detect actions have no resource-level permissions.
      actions: ['rekognition:DetectModerationLabels', 'rekognition:DetectLabels'],
      resources: ['*'],
    });
    const rawUploadsRead = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [`${rawUploadsBucketArn}/images/*`],
    });
    const assetsReadWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`${assetsBucketArn}/images/*`],
    });
    const productsImageRefsUpdate = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:UpdateItem'],
      resources: [productsTableArn],
    });
    const eventBusPutEvents = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [eventBusArn],
    });

    // Bedrock InvokeModel — scoped to ONLY the configured enhancement model
    // (Stable Image Inpaint by default). Least-privilege per blueprint §14.
    const enhancementModelId =
      (this.node.tryGetContext('imageEnhancementModelId') as string | undefined) ??
      'stability.stable-image-inpaint-v1:0';
    const enhancementEnabled =
      (this.node.tryGetContext('imageEnhancementEnabled') as string | undefined) ?? 'false';
    const bedrockInvokeEnhancement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:*::foundation-model/${enhancementModelId}`],
    });

    // Processor Lambdas — Sharp-using ones externalize `sharp` and attach the layer.
    const sharpBundling: Partial<lambdaNodejs.BundlingOptions> = {
      externalModules: [
        '@aws-lambda-powertools/logger',
        '@aws-lambda-powertools/tracer',
        '@aws-lambda-powertools/metrics',
        'sharp',
      ],
    };

    const moderationFn = createFn(
      'Moderation',
      path.join(processorsPath, 'moderation.ts'),
      [rekognitionDetect, rawUploadsRead, imageJobsReadWrite, kmsPolicy],
      { timeout: cdk.Duration.seconds(60) },
    );

    const quarantineFn = createFn(
      'Quarantine',
      path.join(processorsPath, 'quarantine.ts'),
      [rawUploadsRead, assetsReadWrite, imageJobsReadWrite, eventBusPutEvents, kmsPolicy],
      { timeout: cdk.Duration.seconds(60) },
    );

    const backgroundRemovalFn = createFn(
      'BackgroundRemoval',
      path.join(processorsPath, 'background-removal.ts'),
      [rekognitionDetect, rawUploadsRead, assetsReadWrite, kmsPolicy],
      {
        timeout: cdk.Duration.seconds(120),
        memorySize: 1024,
        layers: [powertoolsLayer, sharpLayer],
        bundling: { ...defaultLambdaProps.bundling, ...sharpBundling },
      },
    );

    const packagerFn = createFn(
      'Packager',
      path.join(processorsPath, 'packager.ts'),
      [assetsReadWrite, kmsPolicy],
      {
        timeout: cdk.Duration.seconds(180),
        memorySize: 1536,
        layers: [powertoolsLayer, sharpLayer],
        bundling: { ...defaultLambdaProps.bundling, ...sharpBundling },
      },
    );

    const persistFn = createFn(
      'Persist',
      path.join(processorsPath, 'persist.ts'),
      [imageJobsReadWrite, productsImageRefsUpdate, eventBusPutEvents, kmsPolicy],
      { timeout: cdk.Duration.seconds(60) },
    );
    // Persist needs the Products table name at runtime (reconstructed ARN only
    // scopes IAM; the handler reads PRODUCTS_TABLE_NAME).
    persistFn.addEnvironment('PRODUCTS_TABLE_NAME', `merch-os-products-${env}`);

    // Enhance (Phase 4) — Bedrock Stable Image Inpaint booster for weak photos.
    const enhanceFn = createFn(
      'Enhance',
      path.join(processorsPath, 'enhance.ts'),
      [assetsReadWrite, bedrockInvokeEnhancement, kmsPolicy],
      { timeout: cdk.Duration.seconds(120), memorySize: 1024 },
    );
    enhanceFn.addEnvironment('IMAGE_ENHANCEMENT_MODEL_ID', enhancementModelId);
    enhanceFn.addEnvironment('IMAGE_ENHANCEMENT_ENABLED', enhancementEnabled);

    // Source-URL (Phase 5, G03) — fetch a supplier's OWN product page, pull
    // same-origin product images into raw-uploads, then start the workflow.
    const rawUploadsReadWrite = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${rawUploadsBucketArn}/images/*`],
    });
    const sourceUrlFn = createFn(
      'SourceUrl',
      path.join(processorsPath, 'source-url.ts'),
      [rawUploadsReadWrite, imageJobsReadWrite, kmsPolicy],
      { timeout: cdk.Duration.seconds(120), memorySize: 512 },
    );

    // --- Step Functions Express workflow ---
    const transientRetry: sfn.RetryProps = {
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException', 'Lambda.TooManyRequestsException'],
      maxAttempts: 3,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2,
    };
    const s3Retry: sfn.RetryProps = {
      errors: ['S3.S3Exception', 'S3.NoSuchKeyException'],
      maxAttempts: 3,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2,
    };
    const withRetries = (task: tasks.LambdaInvoke): tasks.LambdaInvoke =>
      task.addRetry(transientRetry).addRetry(s3Retry) as tasks.LambdaInvoke;

    const succeed = new sfn.Succeed(this, 'ImageProcessingSucceeded');
    const rejected = new sfn.Succeed(this, 'ImageModerationRejectedEnd');

    // Failure recorder reuses the persist Lambda with action RECORD_FAILURE.
    const handleFailure = new tasks.LambdaInvoke(this, 'HandleImageFailure', {
      lambdaFunction: persistFn,
      payload: sfn.TaskInput.fromObject({
        action: 'RECORD_FAILURE',
        'tenantId.$': '$.tenantId',
        'productId.$': '$.productId',
        'imageJobId.$': '$.imageJobId',
        'error.$': '$.error',
      }),
      resultPath: '$.failureResult',
    });
    handleFailure.next(new sfn.Fail(this, 'ImageProcessingFailed', {
      errorPath: '$.error.Error',
      causePath: '$.error.Cause',
    }));

    const persistStep = withRetries(
      new tasks.LambdaInvoke(this, 'PersistImageRefs', {
        lambdaFunction: persistFn,
        // Pass the accumulated state fields the persist success path needs.
        payload: sfn.TaskInput.fromObject({
          'tenantId.$': '$.tenantId',
          'productId.$': '$.productId',
          'imageJobId.$': '$.imageJobId',
          'heroKey.$': '$.background.heroKey',
          'heroEdge.$': '$.background.heroEdge',
          'variants.$': '$.packaged.variants',
        }),
        resultPath: '$.persistResult',
      }),
    );
    persistStep.next(succeed);
    persistStep.addCatch(handleFailure, { resultPath: '$.error' });

    const packageStep = withRetries(
      new tasks.LambdaInvoke(this, 'PackageVariants', {
        lambdaFunction: packagerFn,
        payload: sfn.TaskInput.fromObject({
          'tenantId.$': '$.tenantId',
          'productId.$': '$.productId',
          'imageJobId.$': '$.imageJobId',
          'sourceKeys.$': '$.sourceKeys',
          'rawUploadsBucket.$': '$.rawUploadsBucket',
          'assetsBucket.$': '$.assetsBucket',
          'heroKey.$': '$.background.heroKey',
          'heroEdge.$': '$.background.heroEdge',
        }),
        resultSelector: { 'variants.$': '$.Payload.variants' },
        resultPath: '$.packaged',
      }),
    );
    packageStep.next(persistStep);
    packageStep.addCatch(handleFailure, { resultPath: '$.error' });

    // Enhance step (Phase 4) — runs between background removal and packaging.
    // It internally decides whether to enhance (weak photo + feature enabled)
    // and falls back to the deterministic hero on any failure, so it NEVER
    // fails the job — hence no addCatch to HandleFailure here.
    const enhanceStep = new tasks.LambdaInvoke(this, 'EnhanceHero', {
      lambdaFunction: enhanceFn,
      payload: sfn.TaskInput.fromObject({
        'tenantId.$': '$.tenantId',
        'productId.$': '$.productId',
        'imageJobId.$': '$.imageJobId',
        'sourceKeys.$': '$.sourceKeys',
        'rawUploadsBucket.$': '$.rawUploadsBucket',
        'assetsBucket.$': '$.assetsBucket',
        'heroKey.$': '$.background.heroKey',
        'heroEdge.$': '$.background.heroEdge',
        'reviewRecommended.$': '$.background.reviewRecommended',
      }),
      resultSelector: {
        'heroKey.$': '$.Payload.heroKey',
        'heroEdge.$': '$.Payload.heroEdge',
        'enhancement.$': '$.Payload.enhancement',
      },
      resultPath: '$.background',
    });
    enhanceStep.next(packageStep);

    const backgroundStep = withRetries(
      new tasks.LambdaInvoke(this, 'RemoveBackground', {
        lambdaFunction: backgroundRemovalFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: {
          'heroKey.$': '$.Payload.heroKey',
          'heroEdge.$': '$.Payload.heroEdge',
          'reviewRecommended.$': '$.Payload.reviewRecommended',
        },
        resultPath: '$.background',
      }),
    );
    backgroundStep.next(enhanceStep);
    backgroundStep.addCatch(handleFailure, { resultPath: '$.error' });

    const quarantineStep = new tasks.LambdaInvoke(this, 'QuarantineImage', {
      lambdaFunction: quarantineFn,
      payload: sfn.TaskInput.fromJsonPathAt('$'),
      resultPath: '$.quarantineResult',
    });
    quarantineStep.next(rejected);
    quarantineStep.addCatch(handleFailure, { resultPath: '$.error' });

    // Choice: moderation passed → background removal; else → quarantine.
    const moderationChoice = new sfn.Choice(this, 'ModerationPassed?')
      .when(sfn.Condition.booleanEquals('$.moderation.passed', true), backgroundStep)
      .otherwise(quarantineStep);

    const moderateStep = withRetries(
      new tasks.LambdaInvoke(this, 'ModerateImage', {
        lambdaFunction: moderationFn,
        payload: sfn.TaskInput.fromJsonPathAt('$'),
        resultSelector: {
          'passed.$': '$.Payload.passed',
          'rejectedLabels.$': '$.Payload.rejectedLabels',
          'sourceKey.$': '$.Payload.sourceKey',
        },
        resultPath: '$.moderation',
      }),
    );
    moderateStep.next(moderationChoice);
    moderateStep.addCatch(handleFailure, { resultPath: '$.error' });

    const stateMachine = new sfn.StateMachine(this, 'ImageProcessingWorkflow', {
      stateMachineName: `merch-os-image-workflow-${env}`,
      definitionBody: sfn.DefinitionBody.fromChainable(moderateStep),
      stateMachineType: sfn.StateMachineType.EXPRESS,
      logs: {
        destination: new cdk.aws_logs.LogGroup(this, 'ImageWorkflowLogGroup', {
          logGroupName: `/aws/states/merch-os-image-workflow-${env}`,
          retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      },
      tracingEnabled: true,
      timeout: cdk.Duration.minutes(15),
    });

    // start-process starts the workflow and needs its ARN + the buckets.
    stateMachine.grantStartExecution(startProcessFn);
    startProcessFn.addEnvironment('IMAGE_STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    // source-url (Phase 5) also starts the workflow after sourcing images.
    stateMachine.grantStartExecution(sourceUrlFn);
    sourceUrlFn.addEnvironment('IMAGE_STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    // -----------------------------------------------------------------------
    // CloudFront signed-URL delivery (Phase 3)
    //
    // Processed images live in the PRIVATE assets bucket. CloudFront serves them
    // via Origin Access Control (OAC); signed URLs (via a key group) are the
    // only way clients obtain a viewable link. The signing private key lives in
    // Secrets Manager (rotatable without a code change).
    // -----------------------------------------------------------------------
    // NOTE: this CDK version (2.155) exposes `S3Origin` (Origin Access Identity)
    // rather than the newer `S3BucketOrigin.withOriginAccessControl` (OAC). OAI
    // achieves the same security property here — the assets bucket stays private
    // and is reachable only through the distribution. Migrate to OAC when the
    // CDK version is upgraded (tracked as a Phase 3 follow-up).
    const assetsOrigin = new origins.S3Origin(assetsBucket);

    // Public key + key group for signed-URL verification. The public key PEM is
    // supplied via context/SSM at deploy time; a placeholder default keeps synth
    // working in non-deployed environments.
    const signingPublicKeyPem =
      (this.node.tryGetContext('imageSigningPublicKey') as string | undefined) ??
      '-----BEGIN PUBLIC KEY-----\nPLACEHOLDER_REPLACE_AT_DEPLOY\n-----END PUBLIC KEY-----';

    const signingPublicKey = new cloudfront.PublicKey(this, 'ImageSigningPublicKey', {
      publicKeyName: `merch-os-img-signing-${env}`,
      encodedKey: signingPublicKeyPem,
    });
    const signingKeyGroup = new cloudfront.KeyGroup(this, 'ImageSigningKeyGroup', {
      keyGroupName: `merch-os-img-keygroup-${env}`,
      items: [signingPublicKey],
    });

    const distribution = new cloudfront.Distribution(this, 'ImageDistribution', {
      comment: `MerchOS image delivery (${env})`,
      defaultBehavior: {
        origin: assetsOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Signed URLs required — the key group restricts viewer access.
        trustedKeyGroups: [signingKeyGroup],
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
    });

    // Secrets Manager secret holding the signing PRIVATE key (PEM). Populated at
    // deploy/rotation time; the Lambda reads it by secret id from config.
    const secretsKey = kms.Key.fromKeyArn(this, 'ImportedSecretsKey', secretsKeyArn);
    const signingPrivateKeySecret = new secretsmanager.Secret(this, 'ImageSigningPrivateKey', {
      secretName: `merch-os/${env}/image-signing-private-key`,
      description: 'CloudFront signed-URL private key (PEM) for Image Intelligence',
      encryptionKey: secretsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Signed-URL Lambda — scoped Secrets Manager read only.
    const signedUrlFn = createFn(
      'SignedUrl',
      path.join(handlersPath, 'signed-url.ts'),
      [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [signingPrivateKeySecret.secretArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['kms:Decrypt'],
          resources: [secretsKeyArn],
        }),
      ],
    );
    signedUrlFn.addEnvironment('CLOUDFRONT_DOMAIN', distribution.distributionDomainName);
    signedUrlFn.addEnvironment('CLOUDFRONT_KEY_PAIR_ID', signingPublicKey.publicKeyId);
    signedUrlFn.addEnvironment(
      'CLOUDFRONT_PRIVATE_KEY_SECRET_ID',
      signingPrivateKeySecret.secretArn,
    );

    this.lambdaFunctions = {
      uploadUrl: uploadUrlFn,
      startProcess: startProcessFn,
      getImage: getImageFn,
      moderation: moderationFn,
      quarantine: quarantineFn,
      backgroundRemoval: backgroundRemovalFn,
      packager: packagerFn,
      persist: persistFn,
      enhance: enhanceFn,
      sourceUrl: sourceUrlFn,
      signedUrl: signedUrlFn,
    };

    // -----------------------------------------------------------------------
    // HTTP API + Cognito JWT authorizer
    // -----------------------------------------------------------------------
    const jwtAuthorizer = new HttpJwtAuthorizer(
      'ImageApiJwtAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${cognitoUserPoolId}`,
      { jwtAudience: [cognitoSellerClientId] },
    );

    this.httpApi = new HttpApi(this, 'ImageHttpApi', {
      apiName: `merch-os-image-api-${env}`,
      description: 'MerchOS Image Intelligence API — image upload, processing, and retrieval',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [`https://${env === 'production' ? 'app' : env}.merchos.io`],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as
      | cdk.aws_apigatewayv2.CfnStage
      | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      };
    }

    const integration = (routeId: string, fn: lambdaNodejs.NodejsFunction) =>
      new HttpLambdaIntegration(routeId, fn);

    this.httpApi.addRoutes({
      path: '/v1/images/upload',
      methods: [HttpMethod.POST],
      integration: integration('UploadUrlIntegration', uploadUrlFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/images/{productId}/process',
      methods: [HttpMethod.POST],
      integration: integration('StartProcessIntegration', startProcessFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/images/{imageJobId}',
      methods: [HttpMethod.GET],
      integration: integration('GetImageIntegration', getImageFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/images/{imageId}/url/{channel}',
      methods: [HttpMethod.GET],
      integration: integration('SignedUrlIntegration', signedUrlFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // SSM exports
    // -----------------------------------------------------------------------
    new ssm.StringParameter(this, 'ImageJobsTableParam', {
      parameterName: `${ssmPrefix}/image-intelligence/image-jobs-table`,
      stringValue: this.imageJobsTable.tableName,
    });

    new ssm.StringParameter(this, 'ImageApiEndpointParam', {
      parameterName: `${ssmPrefix}/image-intelligence/api-endpoint`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new ssm.StringParameter(this, 'ImageCloudFrontDomainParam', {
      parameterName: `${ssmPrefix}/image-intelligence/cloudfront-domain`,
      stringValue: distribution.distributionDomainName,
    });

    new ssm.StringParameter(this, 'ImageSigningKeySecretArnParam', {
      parameterName: `${ssmPrefix}/image-intelligence/signing-key-secret-arn`,
      stringValue: signingPrivateKeySecret.secretArn,
    });

    new cdk.CfnOutput(this, 'ImageApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-ImageApiEndpoint`,
    });

    // Suppress unused-reference lint for the imported assets bucket (used for
    // IAM scoping in later phases; referenced now to validate the import).
    void assetsBucket;
  }
}

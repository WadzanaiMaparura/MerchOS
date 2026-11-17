/**
 * MerchOS Export API Stack
 *
 * Provisions the Validation + Export pipeline API:
 * - HTTP API (v2) with Cognito JWT authorizer
 * - POST /validate  → Validation Engine (deterministic hard gate)
 * - POST /export    → Export Engine (generates + optionally delivers to S3)
 * - Least-privilege IAM: export Lambda may write the exports bucket and sign
 *   download URLs; validate Lambda needs no data-store access.
 * - SSM Parameter exports for cross-stack references
 *
 * Both Lambdas bundle the ESM services (@merch-os/validation, @merch-os/export)
 * which embed the generated marketplace schemas as data.
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ExportApiStackProps extends cdk.StackProps {
  environment: string;
  userPool: cognito.UserPool;
  sellerDashboardClient: cognito.UserPoolClient;
  platformKey: kms.Key;
}

export class ExportApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ExportApiStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const region = this.region;
    const ssmPrefix = `/merch-os/${env}`;

    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'ExportApi');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // Shared resources resolved from Foundation via SSM
    // -----------------------------------------------------------------------

    const exportsBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/s3/exports-bucket`
    );
    const exportsBucket = s3.Bucket.fromBucketName(this, 'ExportsBucket', exportsBucketName);

    // -----------------------------------------------------------------------
    // HTTP API Gateway + JWT authorizer
    // -----------------------------------------------------------------------

    this.httpApi = new HttpApi(this, 'ExportHttpApi', {
      apiName: `merch-os-export-api-${env}`,
      description: 'MerchOS Export API — validate + export pipeline endpoints',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date'],
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        // Exact origins (required with allowCredentials — wildcards are rejected
        // by browsers for credentialed requests). Non-production also permits
        // the local seller-dashboard dev server so the UI is testable locally.
        allowOrigins: [
          `https://${env === 'production' ? 'app' : env}.merchos.io`,
          ...(env === 'production' ? [] : ['http://localhost:3000']),
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    const jwtAuthorizer = new HttpJwtAuthorizer(
      'ExportCognitoJwtAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`,
      { jwtAudience: [props.sellerDashboardClient.userPoolClientId] }
    );

    // -----------------------------------------------------------------------
    // Shared Lambda configuration (ESM bundling)
    // -----------------------------------------------------------------------

    const servicesRoot = path.join(__dirname, '../../services');

    // The marketplace-schemas registry reads a single schemas-bundle.json at
    // runtime (the schema data is too large to inline into the JS bundle). We
    // copy that one file next to the handler during bundling and point the
    // registry at it via SCHEMAS_BUNDLE_PATH.
    const schemasBundleAbs = path
      .join(
        __dirname,
        '../../packages/marketplace-schemas/generated/takealot-za/schemas-bundle.json'
      )
      .replace(/\\/g, '/');
    const copyBundleCmd = (outputDir: string): string[] => [
      `node -e "require('fs').copyFileSync('${schemasBundleAbs}', require('path').join('${outputDir.replace(
        /\\/g,
        '/'
      )}', 'schemas-bundle.json'))"`,
    ];

    const defaultLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      // Export generation (esp. XLSX via exceljs) is heavier than CRUD.
      memorySize: 512,
      environment: {
        ENVIRONMENT: env,
        // Resolve the schemas bundle copied next to the handler (see below).
        SCHEMAS_BUNDLE_PATH: '/var/task/schemas-bundle.json',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        // exceljs (used by the XLSX writer) does CommonJS `require('crypto')`
        // internally. In an ESM bundle `require` is undefined, so esbuild emits
        // a "Dynamic require not supported" shim that throws. Inject a real
        // require via createRequire so those CJS deps resolve at runtime.
        banner: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir: string, outputDir: string) => copyBundleCmd(outputDir),
        },
      },
    };

    const createLambda = (
      logicalId: string,
      entry: string,
      policyStatements: iam.PolicyStatement[]
    ): lambdaNodejs.NodejsFunction => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
        description: `Execution role for ${logicalId} Lambda`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
      for (const statement of policyStatements) role.addToPolicy(statement);

      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        ...defaultLambdaProps,
        functionName: `merch-os-export-${logicalId.toLowerCase()}-${env}`,
        entry,
        role: role as unknown as iam.IRole,
      });
    };

    // -----------------------------------------------------------------------
    // IAM — least privilege
    // -----------------------------------------------------------------------

    // Export Lambda writes export artifacts and must use the KMS key the
    // exports bucket is encrypted with (SSE-KMS PutObject + presign GET).
    const exportsWritePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${exportsBucket.bucketArn}/tenants/*/exports/*`],
    });
    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [props.platformKey.keyArn],
    });

    // -----------------------------------------------------------------------
    // Lambdas
    // -----------------------------------------------------------------------

    // Validation needs no data-store access — pure, schema-driven.
    const validateFn = createLambda(
      'Validate',
      path.join(servicesRoot, 'validation/api/handlers/validate-product.ts'),
      []
    );

    const exportFn = createLambda(
      'Export',
      path.join(servicesRoot, 'export/api/handlers/generate-export.ts'),
      [exportsWritePolicy, kmsPolicy]
    );
    exportFn.addEnvironment('EXPORTS_BUCKET', exportsBucketName);
    exportFn.addEnvironment('PLATFORM_KMS_KEY_ARN', props.platformKey.keyArn);

    // -----------------------------------------------------------------------
    // Routes (JWT-authorized)
    // -----------------------------------------------------------------------

    this.httpApi.addRoutes({
      path: '/validate',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ValidateIntegration', validateFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/export',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ExportIntegration', exportFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // SSM exports + stack outputs
    // -----------------------------------------------------------------------

    new ssm.StringParameter(this, 'ExportApiUrlParam', {
      parameterName: `${ssmPrefix}/export-api/url`,
      stringValue: this.httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, 'ExportApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      exportName: `${id}-ExportApiEndpoint`,
    });
  }
}

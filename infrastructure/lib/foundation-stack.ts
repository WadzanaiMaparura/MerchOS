/**
 * MerchOS Foundation Stack
 *
 * Provisions shared infrastructure used by all other subsystem stacks:
 * - KMS keys for encryption at rest
 * - S3 buckets (raw uploads, assets, exports, invoices, config, ops)
 * - EventBridge custom event bus
 * - SSM Parameter Store exports for cross-stack references
 *
 * Requirements: 17.1, 17.7, 14.8, 14.9, 14.10
 */

import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface FoundationStackProps extends cdk.StackProps {
  environment: string;
}

export class FoundationStack extends cdk.Stack {
  /** Platform-wide KMS key for DynamoDB and S3 encryption */
  public readonly platformKey: kms.Key;
  /** KMS key for Secrets Manager */
  public readonly secretsKey: kms.Key;
  /** KMS key for CloudTrail log integrity */
  public readonly cloudtrailKey: kms.Key;
  /** EventBridge custom bus for all platform events */
  public readonly eventBus: events.EventBus;

  // S3 buckets
  public readonly rawUploadsBucket: s3.Bucket;
  public readonly assetsBucket: s3.Bucket;
  public readonly exportsBucket: s3.Bucket;
  public readonly invoicesBucket: s3.Bucket;
  public readonly configBucket: s3.Bucket;
  public readonly opsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // -----------------------------------------------------------------------
    // Tags — applied to all resources in this stack
    // -----------------------------------------------------------------------
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'Foundation');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // KMS Keys
    // -----------------------------------------------------------------------

    this.platformKey = new kms.Key(this, 'PlatformKey', {
      alias: `merch-os/${env}/platform`,
      description: 'Default encryption key for MerchOS DynamoDB tables and S3 buckets',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.secretsKey = new kms.Key(this, 'SecretsKey', {
      alias: `merch-os/${env}/secrets`,
      description: 'Encryption key for Secrets Manager secrets',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.cloudtrailKey = new kms.Key(this, 'CloudTrailKey', {
      alias: `merch-os/${env}/cloudtrail`,
      description: 'Encryption key for CloudTrail log integrity',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // S3 Buckets — all: block public access, versioned, KMS encrypted
    // -----------------------------------------------------------------------

    const bucketDefaults: Partial<s3.BucketProps> = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.platformKey,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    };

    this.rawUploadsBucket = new s3.Bucket(this, 'RawUploadsBucket', {
      ...bucketDefaults,
      bucketName: `merch-os-raw-uploads-${env}`,
      lifecycleRules: [
        {
          id: 'RetainFailedUploads7Days',
          prefix: 'quarantine/',
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    this.assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      ...bucketDefaults,
      bucketName: `merch-os-assets-${env}`,
    });

    this.exportsBucket = new s3.Bucket(this, 'ExportsBucket', {
      ...bucketDefaults,
      bucketName: `merch-os-exports-${env}`,
      lifecycleRules: [
        {
          id: 'GlacierAfter90Days',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    this.invoicesBucket = new s3.Bucket(this, 'InvoicesBucket', {
      ...bucketDefaults,
      bucketName: `merch-os-invoices-${env}`,
      lifecycleRules: [
        {
          id: 'Retain3Years',
          expiration: cdk.Duration.days(1095),
        },
      ],
    });

    this.configBucket = new s3.Bucket(this, 'ConfigBucket', {
      ...bucketDefaults,
      bucketName: `merch-os-config-${env}`,
    });

    this.opsBucket = new s3.Bucket(this, 'OpsBucket', {
      ...bucketDefaults,
      bucketName: `merch-os-ops-${env}`,
    });

    // -----------------------------------------------------------------------
    // EventBridge Custom Bus
    // -----------------------------------------------------------------------

    this.eventBus = new events.EventBus(this, 'MerchOsEventBus', {
      eventBusName: `merch-os-events-${env}`,
    });

    // -----------------------------------------------------------------------
    // SSM Parameter Store exports
    // -----------------------------------------------------------------------

    const ssmPrefix = `/merch-os/${env}`;

    new ssm.StringParameter(this, 'PlatformKeyArnParam', {
      parameterName: `${ssmPrefix}/kms/platform-key-arn`,
      stringValue: this.platformKey.keyArn,
    });

    new ssm.StringParameter(this, 'SecretsKeyArnParam', {
      parameterName: `${ssmPrefix}/kms/secrets-key-arn`,
      stringValue: this.secretsKey.keyArn,
    });

    new ssm.StringParameter(this, 'EventBusNameParam', {
      parameterName: `${ssmPrefix}/eventbridge/bus-name`,
      stringValue: this.eventBus.eventBusName,
    });

    new ssm.StringParameter(this, 'EventBusArnParam', {
      parameterName: `${ssmPrefix}/eventbridge/bus-arn`,
      stringValue: this.eventBus.eventBusArn,
    });

    new ssm.StringParameter(this, 'RawUploadsBucketParam', {
      parameterName: `${ssmPrefix}/s3/raw-uploads-bucket`,
      stringValue: this.rawUploadsBucket.bucketName,
    });

    new ssm.StringParameter(this, 'AssetsBucketParam', {
      parameterName: `${ssmPrefix}/s3/assets-bucket`,
      stringValue: this.assetsBucket.bucketName,
    });

    new ssm.StringParameter(this, 'ExportsBucketParam', {
      parameterName: `${ssmPrefix}/s3/exports-bucket`,
      stringValue: this.exportsBucket.bucketName,
    });

    new ssm.StringParameter(this, 'InvoicesBucketParam', {
      parameterName: `${ssmPrefix}/s3/invoices-bucket`,
      stringValue: this.invoicesBucket.bucketName,
    });

    new ssm.StringParameter(this, 'ConfigBucketParam', {
      parameterName: `${ssmPrefix}/s3/config-bucket`,
      stringValue: this.configBucket.bucketName,
    });

    new ssm.StringParameter(this, 'OpsBucketParam', {
      parameterName: `${ssmPrefix}/s3/ops-bucket`,
      stringValue: this.opsBucket.bucketName,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      exportName: `${id}-EventBusArn`,
    });

    new cdk.CfnOutput(this, 'PlatformKeyArn', {
      value: this.platformKey.keyArn,
      exportName: `${id}-PlatformKeyArn`,
    });
  }
}

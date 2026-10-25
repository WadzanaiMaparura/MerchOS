/**
 * MerchOS Tenant Stack
 *
 * Provisions the single DynamoDB table that holds tenant, account-owner,
 * marketing-consent, and short-lived pending-registration data.
 *
 * Single-table design (PK/SK), tenant-scoped. Access patterns:
 *   - Tenant metadata        : PK = TENANT#<tenantId>, SK = METADATA
 *   - Owner / contact profile: PK = TENANT#<tenantId>, SK = USER#<cognitoSub>
 *   - Consent audit history  : PK = TENANT#<tenantId>,
 *                              SK = USER#<cognitoSub>#CONSENT#<timestamp-or-version>
 *   - Pending registration   : PK = PENDINGREG#<registrationId>, SK = META
 *                              (carries post-verification registration details +
 *                               an `expiresAt` TTL attribute)
 *
 * This stack is intentionally INDEPENDENT of AuthStack and AuthApiStack to keep
 * the stack dependency graph acyclic. It consumes only the Foundation KMS key
 * (platform-wide customer-managed key), the same pattern used by the other
 * data stacks. Other stacks consume the table via SSM parameters / stack
 * outputs rather than a direct construct dependency.
 *
 * NOTE: This gate provisions the table only. The PostConfirmation runtime wiring
 * (setting TENANTS_TABLE and granting the trigger IAM access) is intentionally
 * deferred to the coordinated registration-lifecycle stage, because the current
 * PostConfirmation handler would otherwise create incomplete tenant records
 * (name derived from the email local-part rather than the real organisation
 * name). See the gate report for details.
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface TenantStackProps extends cdk.StackProps {
  /** Deployment environment (e.g. "dev", "prod"). */
  environment: string;
  /** Platform-wide customer-managed KMS key from the Foundation stack. */
  platformKey: kms.IKey;
}

export class TenantStack extends cdk.Stack {
  /** The single tenant/pending-registration DynamoDB table. */
  public readonly tenantsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: TenantStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // -----------------------------------------------------------------------
    // Tags — applied to all resources in this stack (matches project convention)
    // -----------------------------------------------------------------------
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'Tenant');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // DynamoDB Tenants Table (single-table design)
    //
    // Keys: PK (string), SK (string). On-demand billing, customer-managed KMS,
    // point-in-time recovery, RETAIN. TTL on `expiresAt` for pending-registration
    // records (other item types simply omit the attribute and never expire).
    // No GSIs/LSIs — all approved access patterns are satisfied by PK/SK alone.
    // -----------------------------------------------------------------------
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: `merch-os-tenants-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.platformKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // SSM Parameter Store exports (cross-stack consumption without a construct
    // dependency — same pattern as the other stacks).
    // -----------------------------------------------------------------------
    const ssmPrefix = `/merch-os/${env}`;

    new ssm.StringParameter(this, 'TenantsTableNameParam', {
      parameterName: `${ssmPrefix}/dynamodb/tenants-table`,
      stringValue: this.tenantsTable.tableName,
    });

    new ssm.StringParameter(this, 'TenantsTableArnParam', {
      parameterName: `${ssmPrefix}/dynamodb/tenants-table-arn`,
      stringValue: this.tenantsTable.tableArn,
    });

    // -----------------------------------------------------------------------
    // Stack outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'TenantsTableName', {
      value: this.tenantsTable.tableName,
      exportName: `${id}-TenantsTableName`,
    });

    new cdk.CfnOutput(this, 'TenantsTableArn', {
      value: this.tenantsTable.tableArn,
      exportName: `${id}-TenantsTableArn`,
    });
  }
}

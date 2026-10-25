/**
 * MerchOS Registration Reconciliation Stack (Stage B).
 *
 * Provisions the durable reconciliation path used when a registration
 * confirmation cannot be persisted synchronously:
 *   - An encrypted SQS reconciliation queue (customer-managed KMS).
 *   - An encrypted dead-letter queue with a redrive policy + long retention.
 *   - A reconciliation Lambda worker consuming the queue (partial batch
 *     responses, bounded SQS retries → DLQ).
 *   - Least-privilege IAM: queue consume, pending-record GetItem/DeleteItem by
 *     primary key, Cognito AdminGetUser, the existing idempotent persistence
 *     writes (TransactWriteItems/GetItem on the tenants table), and KMS.
 *   - CloudWatch alarms: DLQ depth, queue backlog, message age, worker error
 *     rate (reconciliation failures), and failure-to-enqueue.
 *
 * This stack is INDEPENDENT of AuthStack/AuthApiStack/TenantStack to keep the
 * stack dependency graph acyclic. It consumes the Foundation KMS key by
 * construct reference (same pattern as TenantStack) and everything else — the
 * tenants table name/ARN and the Cognito user pool id — via SSM parameters
 * (deploy-time string lookups), exactly like AuthApiStack and
 * SupplierIntelligenceStack. It does not import those stacks' constructs.
 *
 * The pending-registration producer (register-pending endpoint + the message
 * enqueue) is intentionally OUT OF SCOPE for this stage; this stack provisions
 * the durable consumer side against the approved pending-registration data
 * contract (PK=PENDINGREG#<registrationId>, SK=META on the tenants table).
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface RegistrationReconciliationStackProps extends cdk.StackProps {
  /** Deployment environment (e.g. "dev", "prod"). */
  environment: string;
  /** Platform-wide customer-managed KMS key from the Foundation stack. */
  platformKey: kms.IKey;
}

export class RegistrationReconciliationStack extends cdk.Stack {
  /** SQS queue carrying registration reconciliation messages. */
  public readonly reconciliationQueue: sqs.Queue;
  /** Dead-letter queue for reconciliation messages that exhaust retries. */
  public readonly reconciliationDlq: sqs.Queue;
  /** The reconciliation worker Lambda. */
  public readonly reconciliationWorker: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: RegistrationReconciliationStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const ssmPrefix = `/merch-os/${env}`;
    const platformKey = props.platformKey;

    // -----------------------------------------------------------------------
    // Tags (match project convention)
    // -----------------------------------------------------------------------
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Subsystem', 'RegistrationReconciliation');
    cdk.Tags.of(this).add('TenantScope', 'platform');
    cdk.Tags.of(this).add('CostCenter', 'merch-os-platform');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // -----------------------------------------------------------------------
    // Cross-stack references via SSM (no construct dependency → acyclic graph)
    // -----------------------------------------------------------------------
    const tenantsTableName = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/dynamodb/tenants-table`,
    );
    const tenantsTableArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/dynamodb/tenants-table-arn`,
    );
    const cognitoUserPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `${ssmPrefix}/cognito/tenant-pool-id`,
    );

    // Cognito user pool ARN for AdminGetUser (SSM exposes the id; the ARN is
    // deterministic from account/region/id).
    const userPoolArn = `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${cognitoUserPoolId}`;

    // -----------------------------------------------------------------------
    // SQS — Dead-Letter Queue
    //
    // Messages that exhaust the redrive policy land here and are retained for
    // 14 days for operator investigation / manual redrive. Encrypted with the
    // platform CMK.
    // -----------------------------------------------------------------------
    this.reconciliationDlq = new sqs.Queue(this, 'ReconciliationDlq', {
      queueName: `merch-os-registration-reconciliation-dlq-${env}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: platformKey,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // SQS — Reconciliation Queue
    //
    // Standard (not FIFO) queue: reconciliation is idempotent and order
    // independent (the persistence layer dedupes via attribute_not_exists), so
    // standard delivery is sufficient and avoids FIFO throughput constraints.
    // visibilityTimeout is set to 6× the worker timeout (AWS guidance for
    // Lambda SQS triggers). maxReceiveCount=5 gives bounded retries before DLQ.
    // -----------------------------------------------------------------------
    this.reconciliationQueue = new sqs.Queue(this, 'ReconciliationQueue', {
      queueName: `merch-os-registration-reconciliation-${env}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: platformKey,
      visibilityTimeout: cdk.Duration.seconds(180),
      retentionPeriod: cdk.Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: {
        queue: this.reconciliationDlq,
        maxReceiveCount: 5,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // Reconciliation worker Lambda (dedicated least-privilege role)
    // -----------------------------------------------------------------------
    const workerRole = new iam.Role(this, 'ReconciliationWorkerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') as unknown as iam.IPrincipal,
      description: 'Execution role for the registration reconciliation worker',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Pending-record read + consume, and the approved idempotent persistence.
    // All DynamoDB access is primary-key scoped (no Scan, no Query, no index).
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems'],
        resources: [tenantsTableArn],
      }),
    );
    // Authoritative identity lookup.
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser'],
        resources: [userPoolArn],
      }),
    );
    // KMS for the CMK-encrypted tenants table and SQS messages.
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [platformKey.keyArn],
      }),
    );

    const handlersEntry = path.join(
      __dirname,
      '../../services/auth/workers/registration-reconciliation-worker.ts',
    );

    this.reconciliationWorker = new lambdaNodejs.NodejsFunction(this, 'ReconciliationWorker', {
      functionName: `merch-os-registration-reconciliation-${env}`,
      entry: handlersEntry,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      role: workerRole as unknown as iam.IRole,
      environment: {
        ENVIRONMENT: env,
        TENANTS_TABLE: tenantsTableName,
        COGNITO_USER_POOL_ID: cognitoUserPoolId,
        SERVICE_NAME: 'registration-reconciliation',
        POWERTOOLS_SERVICE_NAME: 'registration-reconciliation',
        POWERTOOLS_METRICS_NAMESPACE: 'MerchOS',
        LOG_LEVEL: env === 'production' ? 'WARN' : 'INFO',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        // Same ESM/createRequire banner as AuthApiStack — some transitive CJS
        // dependencies perform a dynamic require() during module init, which
        // crashes ESM Lambdas on cold start without a real require shim.
        banner:
          "import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);",
      },
    });

    // Wire the queue to the worker. reportBatchItemFailures lets one retryable
    // message be retried without reprocessing successful siblings.
    this.reconciliationWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(this.reconciliationQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
      }),
    );

    // -----------------------------------------------------------------------
    // CloudWatch Alarms
    // -----------------------------------------------------------------------

    // 1) DLQ depth > 0 — any message on the DLQ is an operator-actionable event.
    new cloudwatch.Alarm(this, 'ReconciliationDlqDepthAlarm', {
      alarmName: `merch-os-registration-reconciliation-dlq-depth-${env}`,
      alarmDescription:
        'Registration reconciliation messages have landed on the DLQ (exhausted retries). Investigate and redrive.',
      metric: this.reconciliationDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // 2) Queue backlog > 100 — the worker is not keeping up.
    new cloudwatch.Alarm(this, 'ReconciliationQueueBacklogAlarm', {
      alarmName: `merch-os-registration-reconciliation-backlog-${env}`,
      alarmDescription:
        'Registration reconciliation queue backlog is high; the worker may be failing or under-provisioned.',
      metric: this.reconciliationQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 100,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // 3) Oldest message age > 15 min — messages are stuck (poison / throttled).
    new cloudwatch.Alarm(this, 'ReconciliationMessageAgeAlarm', {
      alarmName: `merch-os-registration-reconciliation-message-age-${env}`,
      alarmDescription:
        'Oldest registration reconciliation message is too old; messages are not being processed promptly.',
      metric: this.reconciliationQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: cdk.Duration.minutes(15).toSeconds(),
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // 4) Worker error rate > 5% over 5 min — reconciliation (retryable) failures.
    const workerErrors = this.reconciliationWorker.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });
    const workerInvocations = this.reconciliationWorker.metricInvocations({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });
    const workerErrorRate = new cloudwatch.MathExpression({
      expression: '100 * (errors / MAX([invocations, 1]))',
      usingMetrics: { errors: workerErrors, invocations: workerInvocations },
      label: 'ReconciliationWorkerErrorRate',
      period: cdk.Duration.minutes(5),
    });
    new cloudwatch.Alarm(this, 'ReconciliationWorkerErrorRateAlarm', {
      alarmName: `merch-os-registration-reconciliation-worker-error-rate-${env}`,
      alarmDescription:
        'Registration reconciliation worker error rate exceeded 5% over 5 minutes.',
      metric: workerErrorRate,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // 5) Failure to ENQUEUE a reconciliation message. The producer (a later
    //    stage) emits the custom EMF metric `ReconciliationEnqueueFailure`
    //    under the MerchOS namespace when it cannot put a message on the queue.
    //    The alarm is defined here, alongside the queue it protects, so the
    //    reconciliation subsystem owns its full observability surface.
    new cloudwatch.Alarm(this, 'ReconciliationEnqueueFailureAlarm', {
      alarmName: `merch-os-registration-reconciliation-enqueue-failure-${env}`,
      alarmDescription:
        'A registration confirmation failed to enqueue a reconciliation message (durable recovery path at risk).',
      metric: new cloudwatch.Metric({
        namespace: 'MerchOS',
        metricName: 'ReconciliationEnqueueFailure',
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // -----------------------------------------------------------------------
    // SSM exports (consumed by the later producer stage without a construct dep)
    // -----------------------------------------------------------------------
    new ssm.StringParameter(this, 'ReconciliationQueueUrlParam', {
      parameterName: `${ssmPrefix}/sqs/registration-reconciliation-url`,
      stringValue: this.reconciliationQueue.queueUrl,
    });
    new ssm.StringParameter(this, 'ReconciliationQueueArnParam', {
      parameterName: `${ssmPrefix}/sqs/registration-reconciliation-arn`,
      stringValue: this.reconciliationQueue.queueArn,
    });
    new ssm.StringParameter(this, 'ReconciliationDlqUrlParam', {
      parameterName: `${ssmPrefix}/sqs/registration-reconciliation-dlq-url`,
      stringValue: this.reconciliationDlq.queueUrl,
    });
    new ssm.StringParameter(this, 'ReconciliationDlqArnParam', {
      parameterName: `${ssmPrefix}/sqs/registration-reconciliation-dlq-arn`,
      stringValue: this.reconciliationDlq.queueArn,
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ReconciliationQueueUrl', {
      value: this.reconciliationQueue.queueUrl,
      exportName: `${id}-ReconciliationQueueUrl`,
    });
    new cdk.CfnOutput(this, 'ReconciliationDlqUrl', {
      value: this.reconciliationDlq.queueUrl,
      exportName: `${id}-ReconciliationDlqUrl`,
    });
    new cdk.CfnOutput(this, 'ReconciliationWorkerName', {
      value: this.reconciliationWorker.functionName,
      exportName: `${id}-ReconciliationWorkerName`,
    });
  }
}

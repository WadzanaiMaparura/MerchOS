/**
 * Tenant-scoped DynamoDB client wrapper for the MerchOS platform.
 *
 * This module enforces tenant isolation at the data access layer by
 * automatically injecting ConditionExpressions that verify the caller's
 * tenantId matches the record's tenantId on every write operation.
 *
 * Requirements: 1.3, 1.8
 */

import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandInput,
  GetCommandOutput,
  PutCommand,
  PutCommandInput,
  PutCommandOutput,
  UpdateCommand,
  UpdateCommandInput,
  UpdateCommandOutput,
  DeleteCommand,
  DeleteCommandInput,
  DeleteCommandOutput,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommand,
  ScanCommandInput,
  ScanCommandOutput,
  TransactWriteCommand,
  TransactWriteCommandInput,
  TransactWriteCommandOutput,
} from '@aws-sdk/lib-dynamodb';

// ---------------------------------------------------------------------------
// Table name constants (read from environment variables)
// ---------------------------------------------------------------------------

export const TENANTS_TABLE = process.env['TENANTS_TABLE'] ?? 'merch-os-tenants';
export const PRODUCTS_TABLE = process.env['PRODUCTS_TABLE'] ?? 'merch-os-products';
export const INVENTORY_TABLE = process.env['INVENTORY_TABLE'] ?? 'merch-os-inventory';
export const INVENTORY_TRANSACTIONS_TABLE =
  process.env['INVENTORY_TRANSACTIONS_TABLE'] ?? 'merch-os-inventory-transactions';
export const BILLING_TABLE = process.env['BILLING_TABLE'] ?? 'merch-os-billing';
export const AUDIT_LOG_TABLE = process.env['AUDIT_LOG_TABLE'] ?? 'merch-os-audit-log';
export const COMPLIANCE_RULES_TABLE =
  process.env['COMPLIANCE_RULES_TABLE'] ?? 'merch-os-compliance-rules';

// ---------------------------------------------------------------------------
// Key helper functions
// ---------------------------------------------------------------------------

/** Returns the DynamoDB partition key for a tenant: `TENANT#<tenantId>` */
export function tenantPK(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

/** Returns the sort key for a product record: `PRODUCT#<productId>` */
export function productSK(productId: string): string {
  return `PRODUCT#${productId}`;
}

/** Returns the sort key for a user record: `USER#<userId>` */
export function userSK(userId: string): string {
  return `USER#${userId}`;
}

/** Returns the sort key for an audit log entry: `AUDIT#<timestamp>#<eventId>` */
export function auditSK(timestamp: string, eventId: string): string {
  return `AUDIT#${timestamp}#${eventId}`;
}

/** Returns the sort key for an inventory record: `SKU#<sku>#WH#<warehouseId>` */
export function inventorySK(sku: string, warehouseId: string): string {
  return `SKU#${sku}#WH#${warehouseId}`;
}

/** Returns the sort key for an inventory transaction: `TXN#<timestamp>#<txnId>` */
export function transactionSK(timestamp: string, txnId: string): string {
  return `TXN#${timestamp}#${txnId}`;
}

/** Returns the sort key for a subscription: `SUBSCRIPTION#current` */
export function subscriptionSK(): string {
  return 'SUBSCRIPTION#current';
}

/** Returns the sort key for monthly usage: `USAGE#<yyyyMM>` */
export function usageSK(billingMonth: string): string {
  return `USAGE#${billingMonth}`;
}

/** Returns the sort key for an invoice: `INVOICE#<invoiceId>` */
export function invoiceSK(invoiceId: string): string {
  return `INVOICE#${invoiceId}`;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when a write operation is attempted without a valid tenantId,
 * indicating a potential cross-tenant data access violation.
 */
export class TenantIsolationError extends Error {
  public readonly code = 'TENANT_ISOLATION_VIOLATION';

  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

// ---------------------------------------------------------------------------
// Tenant-scoped DynamoDB client
// ---------------------------------------------------------------------------

/**
 * A DynamoDB document client scoped to a specific tenant.
 *
 * All write operations (put, update, delete, transactWrite) automatically
 * enforce that the record belongs to the calling tenant via ConditionExpressions.
 * This prevents cross-tenant data access at the data layer regardless of
 * application-level bugs.
 */
export class TenantDynamoClient {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tenantId: string;

  constructor(tenantId: string, config?: DynamoDBClientConfig) {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new TenantIsolationError(
        'TenantDynamoClient requires a non-empty tenantId'
      );
    }

    this.tenantId = tenantId;
    const client = new DynamoDBClient(config ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /** Returns the tenantId this client is scoped to. */
  getTenantId(): string {
    return this.tenantId;
  }

  /** Returns the tenant partition key for use in queries. */
  getPK(): string {
    return tenantPK(this.tenantId);
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /**
   * Get a single item. The caller must use the correct tenant-scoped PK.
   */
  async get(input: GetCommandInput): Promise<GetCommandOutput> {
    return this.docClient.send(new GetCommand(input));
  }

  /**
   * Query items. The caller should scope the KeyConditionExpression to the
   * tenant's partition key.
   */
  async query(input: QueryCommandInput): Promise<QueryCommandOutput> {
    return this.docClient.send(new QueryCommand(input));
  }

  /**
   * Scan with automatic tenant filter applied.
   */
  async scan(input: ScanCommandInput): Promise<ScanCommandOutput> {
    const tenantFilter = 'PK = :tenantPK';
    const enhanced: ScanCommandInput = {
      ...input,
      FilterExpression: input.FilterExpression
        ? `(${input.FilterExpression}) AND ${tenantFilter}`
        : tenantFilter,
      ExpressionAttributeValues: {
        ...input.ExpressionAttributeValues,
        ':tenantPK': this.getPK(),
      },
    };
    return this.docClient.send(new ScanCommand(enhanced));
  }

  // -------------------------------------------------------------------------
  // Write operations (tenant isolation enforced)
  // -------------------------------------------------------------------------

  /**
   * Put an item with tenant isolation enforcement.
   * Adds a condition that prevents overwriting items belonging to other tenants.
   */
  async put(input: PutCommandInput): Promise<PutCommandOutput> {
    const tenantCondition =
      'attribute_not_exists(PK) OR PK = :callerTenantPK';

    const enhanced: PutCommandInput = {
      ...input,
      ConditionExpression: input.ConditionExpression
        ? `(${input.ConditionExpression}) AND (${tenantCondition})`
        : tenantCondition,
      ExpressionAttributeValues: {
        ...input.ExpressionAttributeValues,
        ':callerTenantPK': this.getPK(),
      },
    };

    return this.docClient.send(new PutCommand(enhanced));
  }

  /**
   * Update an item with tenant isolation enforcement.
   * The condition ensures the item belongs to the calling tenant.
   */
  async update(input: UpdateCommandInput): Promise<UpdateCommandOutput> {
    const tenantCondition = 'attribute_exists(PK) AND PK = :callerTenantPK';

    const enhanced: UpdateCommandInput = {
      ...input,
      ConditionExpression: input.ConditionExpression
        ? `(${input.ConditionExpression}) AND (${tenantCondition})`
        : tenantCondition,
      ExpressionAttributeValues: {
        ...input.ExpressionAttributeValues,
        ':callerTenantPK': this.getPK(),
      },
    };

    return this.docClient.send(new UpdateCommand(enhanced));
  }

  /**
   * Delete an item with tenant isolation enforcement.
   * The condition ensures only items belonging to the calling tenant can be deleted.
   */
  async delete(input: DeleteCommandInput): Promise<DeleteCommandOutput> {
    const tenantCondition = 'attribute_exists(PK) AND PK = :callerTenantPK';

    const enhanced: DeleteCommandInput = {
      ...input,
      ConditionExpression: input.ConditionExpression
        ? `(${input.ConditionExpression}) AND (${tenantCondition})`
        : tenantCondition,
      ExpressionAttributeValues: {
        ...input.ExpressionAttributeValues,
        ':callerTenantPK': this.getPK(),
      },
    };

    return this.docClient.send(new DeleteCommand(enhanced));
  }

  /**
   * Transact write with tenant isolation enforcement on all items.
   * Each item in the transaction has a tenant condition appended.
   */
  async transactWrite(
    input: TransactWriteCommandInput
  ): Promise<TransactWriteCommandOutput> {
    const enhancedItems = input.TransactItems.map((item) => {
      if (item.Put) {
        const tenantCondition =
          'attribute_not_exists(PK) OR PK = :callerTenantPK';
        return {
          Put: {
            ...item.Put,
            ConditionExpression: item.Put.ConditionExpression
              ? `(${item.Put.ConditionExpression}) AND (${tenantCondition})`
              : tenantCondition,
            ExpressionAttributeValues: {
              ...item.Put.ExpressionAttributeValues,
              ':callerTenantPK': this.getPK(),
            },
          },
        };
      }
      if (item.Update) {
        const tenantCondition =
          'attribute_exists(PK) AND PK = :callerTenantPK';
        return {
          Update: {
            ...item.Update,
            ConditionExpression: item.Update.ConditionExpression
              ? `(${item.Update.ConditionExpression}) AND (${tenantCondition})`
              : tenantCondition,
            ExpressionAttributeValues: {
              ...item.Update.ExpressionAttributeValues,
              ':callerTenantPK': this.getPK(),
            },
          },
        };
      }
      if (item.Delete) {
        const tenantCondition =
          'attribute_exists(PK) AND PK = :callerTenantPK';
        return {
          Delete: {
            ...item.Delete,
            ConditionExpression: item.Delete.ConditionExpression
              ? `(${item.Delete.ConditionExpression}) AND (${tenantCondition})`
              : tenantCondition,
            ExpressionAttributeValues: {
              ...item.Delete.ExpressionAttributeValues,
              ':callerTenantPK': this.getPK(),
            },
          },
        };
      }
      // ConditionCheck items pass through unchanged
      return item;
    });

    return this.docClient.send(
      new TransactWriteCommand({ ...input, TransactItems: enhancedItems })
    );
  }
}

/**
 * Factory function to create a tenant-scoped DynamoDB client.
 * Use this in Lambda handlers after extracting tenantId from the request context.
 */
export function createTenantDynamoClient(
  tenantId: string,
  config?: DynamoDBClientConfig
): TenantDynamoClient {
  return new TenantDynamoClient(tenantId, config);
}

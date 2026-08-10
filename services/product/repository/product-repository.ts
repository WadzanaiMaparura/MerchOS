/**
 * ProductRepository — Persistence boundary for CanonicalProduct.
 *
 * Uses DynamoDBDocumentClient directly (not TenantDynamoClient) since the
 * repository itself handles all key construction, condition expressions,
 * and tenant isolation explicitly.
 */

import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { CanonicalProduct } from '@merch-os/types';
import { PRODUCTS_TABLE, tenantPK, productSK } from '../../shared/utils/dynamo-client';
import { ListProductsOptions, PaginatedProducts } from './types';
import { ProductAlreadyExistsError, ProductNotFoundError, ProductPersistenceError } from './errors';

// ---------------------------------------------------------------------------
// GSI key helpers
// ---------------------------------------------------------------------------

function gsi1PK(tenantId: string): string {
  return `TENANT#${tenantId}#SKU`;
}

function gsi1SK(sku: string): string {
  return `SKU#${sku}`;
}

// ---------------------------------------------------------------------------
// DynamoDB item mapping
// ---------------------------------------------------------------------------

interface ProductItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
}

function toItem(product: CanonicalProduct): ProductItem {
  return {
    ...product,
    PK: tenantPK(product.tenantId),
    SK: productSK(product.productId),
    GSI1PK: gsi1PK(product.tenantId),
    GSI1SK: gsi1SK(product.content.sku),
  };
}

function fromItem(item: Record<string, unknown>): CanonicalProduct {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  return rest as unknown as CanonicalProduct;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export class ProductRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config?: DynamoDBClientConfig) {
    const client = new DynamoDBClient(config ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.tableName = PRODUCTS_TABLE;
  }

  /**
   * Allows injection of a pre-configured DynamoDBDocumentClient (useful for testing).
   */
  static fromDocClient(docClient: DynamoDBDocumentClient): ProductRepository {
    const repo = Object.create(ProductRepository.prototype) as ProductRepository;
    Object.defineProperty(repo, 'docClient', { value: docClient, writable: false });
    Object.defineProperty(repo, 'tableName', { value: PRODUCTS_TABLE, writable: false });
    return repo;
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(product: CanonicalProduct): Promise<CanonicalProduct> {
    const now = new Date().toISOString();
    const productWithTimestamps: CanonicalProduct = {
      ...product,
      createdAt: now,
      updatedAt: now,
    };

    const item = toItem(productWithTimestamps);

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        throw new ProductAlreadyExistsError(product.tenantId, product.productId);
      }
      throw new ProductPersistenceError(
        `Failed to create product: ${product.productId}`,
        error instanceof Error ? error : undefined
      );
    }

    return productWithTimestamps;
  }

  // -------------------------------------------------------------------------
  // Get
  // -------------------------------------------------------------------------

  async get(tenantId: string, productId: string): Promise<CanonicalProduct | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: tenantPK(tenantId),
          SK: productSK(productId),
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return fromItem(result.Item);
  }

  // -------------------------------------------------------------------------
  // List by Tenant
  // -------------------------------------------------------------------------

  async listByTenant(
    tenantId: string,
    options?: ListProductsOptions
  ): Promise<PaginatedProducts> {
    const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (options?.nextToken) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(options.nextToken, 'base64').toString('utf-8')
        );
      } catch {
        throw new ProductPersistenceError('Invalid pagination token');
      }
    }

    const queryInput: {
      TableName: string;
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, string>;
      Limit: number;
      ExclusiveStartKey?: Record<string, unknown>;
    } = {
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': tenantPK(tenantId),
        ':skPrefix': 'PRODUCT#',
      },
      Limit: limit,
    };

    if (exclusiveStartKey) {
      queryInput.ExclusiveStartKey = exclusiveStartKey;
    }

    const result = await this.docClient.send(new QueryCommand(queryInput));

    const items = (result.Items ?? []).map(fromItem);

    if (result.LastEvaluatedKey) {
      const nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
      return { items, nextToken };
    }

    return { items };
  }

  // -------------------------------------------------------------------------
  // Find by SKU (GSI1)
  // -------------------------------------------------------------------------

  async findBySku(tenantId: string, sku: string): Promise<CanonicalProduct | null> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk',
        ExpressionAttributeValues: {
          ':gsi1pk': gsi1PK(tenantId),
          ':gsi1sk': gsi1SK(sku),
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return fromItem(result.Items[0]!);
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  async update(
    tenantId: string,
    productId: string,
    product: CanonicalProduct
  ): Promise<CanonicalProduct> {
    // Protect immutable identity fields
    if (product.tenantId !== tenantId || product.productId !== productId) {
      throw new ProductPersistenceError(
        'Cannot change tenantId or productId during update'
      );
    }

    // Read existing item to get the stored createdAt (incoming value is NOT trusted)
    const existing = await this.get(tenantId, productId);
    if (!existing) {
      throw new ProductNotFoundError(tenantId, productId);
    }

    // Preserve stored createdAt; refresh updatedAt
    const updatedProduct: CanonicalProduct = {
      ...product,
      createdAt: existing.createdAt, // NEVER trust incoming createdAt
      updatedAt: new Date().toISOString(),
    };

    const item = toItem(updatedProduct);

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_exists(PK) AND PK = :callerTenantPK',
          ExpressionAttributeValues: {
            ':callerTenantPK': tenantPK(tenantId),
          },
        })
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        throw new ProductNotFoundError(tenantId, productId);
      }
      throw new ProductPersistenceError(
        `Failed to update product: ${productId}`,
        error instanceof Error ? error : undefined
      );
    }

    return updatedProduct;
  }

  // -------------------------------------------------------------------------
  // Delete (Soft Delete — archives the product)
  // -------------------------------------------------------------------------

  /**
   * Soft-deletes a product by setting lifecycleState to 'archived'.
   * The DynamoDB item is NOT removed — it remains for audit, history, and recovery.
   *
   * @returns The archived product, or throws ProductNotFoundError if not found.
   */
  async delete(tenantId: string, productId: string): Promise<CanonicalProduct> {
    const now = new Date().toISOString();

    try {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: tenantPK(tenantId),
            SK: productSK(productId),
          },
          UpdateExpression: 'SET lifecycleState = :archived, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: {
            ':archived': 'archived',
            ':now': now,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      if (!result.Attributes) {
        throw new ProductNotFoundError(tenantId, productId);
      }

      return fromItem(result.Attributes);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        throw new ProductNotFoundError(tenantId, productId);
      }
      if (error instanceof ProductNotFoundError) {
        throw error;
      }
      throw new ProductPersistenceError(
        `Failed to archive product: ${productId}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Token Tracker service for the Product Intelligence Engine.
 *
 * Records per-invocation token usage, aggregates daily and monthly totals
 * in DynamoDB using atomic ADD operations, and enforces budget limits
 * by emitting EventBridge events when a tenant exceeds their monthly budget.
 *
 * @module token-tracker
 * @see Requirements 15.1, 15.2, 15.3
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

import type { GenerationType } from '../types/generation.types';
import type { TokenUsageRecord, TokenUsageSummary } from '../types/usage.types';
import type { TokenUsageItem } from '../types/dynamo.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DynamoDB table name from environment */
const TABLE_NAME = process.env['PRODUCT_INTELLIGENCE_TABLE'] ?? 'product-intelligence';

/** Default monthly token budget (configurable via environment variable) */
const DEFAULT_MONTHLY_BUDGET = 1_000_000;

/** EventBridge source identifier for product intelligence events */
const PRODUCT_INTELLIGENCE_EVENT_SOURCE = 'merch-os.product-intelligence';

/** EventBridge detail type for budget exceeded events */
const BUDGET_EXCEEDED_DETAIL_TYPE = 'product-intelligence.budget-exceeded';

// ---------------------------------------------------------------------------
// DynamoDB Client Setup
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

/**
 * Override the DynamoDB Document Client (used for testing).
 *
 * @param client - The mock or test DynamoDB document client
 */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// EventBridge Client Setup
// ---------------------------------------------------------------------------

let eventBridgeClient: EventBridgeClient | null = null;

function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
  }
  return eventBridgeClient;
}

/**
 * Override the EventBridge Client (used for testing).
 *
 * @param client - The mock or test EventBridge client
 */
export function setEventBridgeClient(client: EventBridgeClient): void {
  eventBridgeClient = client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the configured monthly token budget for a tenant.
 * Reads from environment variable MONTHLY_TOKEN_BUDGET or falls back to default.
 *
 * @returns The budget limit in tokens
 */
function getMonthlyBudgetLimit(): number {
  const envBudget = process.env['MONTHLY_TOKEN_BUDGET'];
  if (envBudget) {
    const parsed = parseInt(envBudget, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MONTHLY_BUDGET;
}

/**
 * Extracts the daily period string (YYYY-MM-DD) from an ISO 8601 timestamp.
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Date string in YYYY-MM-DD format
 */
function getDayPeriod(timestamp: string): string {
  return timestamp.slice(0, 10); // "2024-01-15T..."  → "2024-01-15"
}

/**
 * Extracts the monthly period string (YYYY-MM) from an ISO 8601 timestamp.
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Month string in YYYY-MM format
 */
function getMonthPeriod(timestamp: string): string {
  return timestamp.slice(0, 7); // "2024-01-15T..."  → "2024-01"
}

/**
 * Returns the current month period string (YYYY-MM).
 *
 * @returns Current month in YYYY-MM format
 */
function getCurrentMonthPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Token Tracker Class
// ---------------------------------------------------------------------------

/**
 * Token Tracker service that records token usage, aggregates daily/monthly
 * totals, and enforces budget limits with EventBridge notifications.
 *
 * DynamoDB access patterns:
 * - Get Token Usage (daily): PK=`TENANT#{tenantId}#USAGE`, SK=`DAY#{YYYY-MM-DD}`
 * - Get Token Usage (monthly): PK=`TENANT#{tenantId}#USAGE`, SK=`MONTH#{YYYY-MM}`
 *
 * Uses atomic ADD operations for concurrent-safe aggregation.
 *
 * @see Requirements 15.1, 15.2, 15.3
 */
export class TokenTracker {
  /**
   * Records token usage from a Bedrock invocation.
   *
   * Updates BOTH daily and monthly aggregates in DynamoDB using atomic ADD
   * operations. Each aggregate maintains a breakdown by generation type.
   *
   * After recording, checks if the monthly budget is exceeded and emits
   * a `product-intelligence.budget-exceeded` EventBridge event if so.
   *
   * @param usage - The token usage record to persist
   * @see Requirements 15.1, 15.2
   */
  async record(usage: TokenUsageRecord): Promise<void> {
    const { tenantId, generationType, inputTokens, outputTokens, timestamp } = usage;
    const dayPeriod = getDayPeriod(timestamp);
    const monthPeriod = getMonthPeriod(timestamp);
    const budgetLimit = getMonthlyBudgetLimit();
    const now = new Date().toISOString();

    const client = getDynamoDocClient();

    // Update daily and monthly aggregates in parallel
    await Promise.all([
      // Daily aggregate
      client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `TENANT#${tenantId}#USAGE`,
            SK: `DAY#${dayPeriod}`,
          },
          UpdateExpression:
            'ADD totalInputTokens :inputTokens, totalOutputTokens :outputTokens, breakdown.#genType.inputTokens :inputTokens, breakdown.#genType.outputTokens :outputTokens ' +
            'SET tenantId = :tenantId, period = :period, budgetLimit = :budgetLimit, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#genType': generationType,
          },
          ExpressionAttributeValues: {
            ':inputTokens': inputTokens,
            ':outputTokens': outputTokens,
            ':tenantId': tenantId,
            ':period': dayPeriod,
            ':budgetLimit': budgetLimit,
            ':updatedAt': now,
          },
        }),
      ),
      // Monthly aggregate
      client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `TENANT#${tenantId}#USAGE`,
            SK: `MONTH#${monthPeriod}`,
          },
          UpdateExpression:
            'ADD totalInputTokens :inputTokens, totalOutputTokens :outputTokens, breakdown.#genType.inputTokens :inputTokens, breakdown.#genType.outputTokens :outputTokens ' +
            'SET tenantId = :tenantId, period = :period, budgetLimit = :budgetLimit, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#genType': generationType,
          },
          ExpressionAttributeValues: {
            ':inputTokens': inputTokens,
            ':outputTokens': outputTokens,
            ':tenantId': tenantId,
            ':period': monthPeriod,
            ':budgetLimit': budgetLimit,
            ':updatedAt': now,
          },
        }),
      ),
    ]);

    // Check budget after recording and emit event if exceeded
    const budgetCheck = await this.checkBudget(tenantId);
    if (!budgetCheck.allowed) {
      await this.emitBudgetExceededEvent(tenantId, budgetLimit, budgetCheck.remaining);
    }
  }

  /**
   * Retrieves aggregated token usage for a tenant in a given period.
   *
   * Queries the DynamoDB usage item for the current day or month and
   * returns a summary including breakdown by generation type.
   *
   * @param tenantId - The tenant identifier
   * @param period - 'daily' for today's usage, 'monthly' for this month's usage
   * @returns A summary of token usage with breakdown
   * @see Requirements 15.1, 15.2
   */
  async getTenantUsage(
    tenantId: string,
    period: 'daily' | 'monthly',
  ): Promise<TokenUsageSummary> {
    const client = getDynamoDocClient();
    const budgetLimit = getMonthlyBudgetLimit();

    const sk =
      period === 'daily'
        ? `DAY#${getDayPeriod(new Date().toISOString())}`
        : `MONTH#${getCurrentMonthPeriod()}`;

    const response = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `TENANT#${tenantId}#USAGE`,
          SK: sk,
        },
      }),
    );

    if (!response.Item) {
      // No usage recorded yet for this period
      const emptyBreakdown = {} as Record<
        GenerationType,
        { inputTokens: number; outputTokens: number }
      >;

      return {
        tenantId,
        period,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        budgetLimit,
        budgetRemaining: budgetLimit,
        breakdown: emptyBreakdown,
      };
    }

    const item = response.Item as TokenUsageItem;
    const totalTokens = item.totalInputTokens + item.totalOutputTokens;
    const budgetRemaining = Math.max(0, budgetLimit - totalTokens);

    // Estimate cost: rough pricing model (input: $0.00025/1K tokens, output: $0.00125/1K tokens for Haiku)
    const totalCost =
      (item.totalInputTokens / 1000) * 0.00025 +
      (item.totalOutputTokens / 1000) * 0.00125;

    return {
      tenantId,
      period,
      totalInputTokens: item.totalInputTokens,
      totalOutputTokens: item.totalOutputTokens,
      totalCost: Math.round(totalCost * 1_000_000) / 1_000_000, // 6 decimal places
      budgetLimit,
      budgetRemaining,
      breakdown: (item.breakdown ?? {}) as Record<
        GenerationType,
        { inputTokens: number; outputTokens: number }
      >,
    };
  }

  /**
   * Checks whether the tenant's accumulated monthly token usage
   * is within the configured budget limit.
   *
   * @param tenantId - The tenant identifier
   * @returns An object with `allowed` (true if under budget) and `remaining` (tokens left)
   * @see Requirement 15.3
   */
  async checkBudget(
    tenantId: string,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const client = getDynamoDocClient();
    const budgetLimit = getMonthlyBudgetLimit();
    const monthPeriod = getCurrentMonthPeriod();

    const response = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `TENANT#${tenantId}#USAGE`,
          SK: `MONTH#${monthPeriod}`,
        },
      }),
    );

    if (!response.Item) {
      // No usage yet — full budget available
      return { allowed: true, remaining: budgetLimit };
    }

    const item = response.Item as TokenUsageItem;
    const totalTokens = item.totalInputTokens + item.totalOutputTokens;
    const remaining = Math.max(0, budgetLimit - totalTokens);
    const allowed = totalTokens < budgetLimit;

    return { allowed, remaining };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Emits a `product-intelligence.budget-exceeded` event to EventBridge.
   *
   * @param tenantId - The tenant whose budget was exceeded
   * @param budgetLimit - The configured budget limit
   * @param remaining - Remaining budget (0 or negative)
   * @see Requirement 15.3
   */
  private async emitBudgetExceededEvent(
    tenantId: string,
    budgetLimit: number,
    remaining: number,
  ): Promise<void> {
    const eventBusName = process.env['EVENT_BUS_NAME'];
    if (!eventBusName) {
      // Silently skip if no bus is configured (e.g., in unit tests)
      return;
    }

    const client = getEventBridgeClient();
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: PRODUCT_INTELLIGENCE_EVENT_SOURCE,
          DetailType: BUDGET_EXCEEDED_DETAIL_TYPE,
          Detail: JSON.stringify({
            tenantId,
            budgetLimit,
            remaining,
            timestamp: new Date().toISOString(),
          }),
          EventBusName: eventBusName,
          Time: new Date(),
        },
      ],
    });

    await client.send(command);
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared TokenTracker instance */
export const tokenTracker = new TokenTracker();

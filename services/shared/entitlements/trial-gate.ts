/**
 * Free-trial entitlement gate.
 *
 * Each seller (tenant) gets a free trial of TRIAL_PRODUCT_LIMIT products, EVER.
 * Past that, creating new products and generating AI content stop until they
 * subscribe. The first products stay fully editable and regenerable so a seller
 * can correct any that failed.
 *
 * WHERE THE STATE LIVES: in the PRODUCTS table, under the tenant's own partition,
 * not in the billing table. Every service that has to enforce the cap (product
 * API, the supplier import persister, product intelligence) already has IAM + KMS
 * access to the products table, so no service gains access to billing data.
 * Billing is the only writer of the entitlement itself (activation/subscription).
 *
 *   PK = TENANT#<tenantId>
 *   SK = ENTITLEMENT#trial                       { status, productsUsed, productLimit, ... }
 *   SK = ENTITLEMENT#trial#PRODUCT#<productId>   one marker per trial product (allow-list)
 *
 * Neither SK matches the PRODUCT# prefix the product listing queries use, and the
 * items carry no GSI keys, so they never appear as products.
 *
 * SAFETY: enforcement is OFF unless TRIAL_ENFORCEMENT=true. When off, every
 * function returns immediately without touching DynamoDB, so shipping this code
 * cannot change existing behaviour. Turn it on only once sellers can activate.
 *
 * COUNTING RULES
 *  - A slot is reserved atomically (counter bump + marker, one transaction) with
 *    the cap checked in the SAME write, so concurrent creates cannot overshoot.
 *  - The counter never decrements for deletes/archives ("ever" semantics); it only
 *    decrements via releaseProductSlot, used when a creation FAILED after reserving.
 *  - Reserving the same product twice is a no-op, so retries are safe.
 */
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { createTenantDynamoClient, tenantPK } from "../utils/dynamo-client";

export const TRIAL_PRODUCT_LIMIT = 15;
export const ENTITLEMENT_SK = "ENTITLEMENT#trial";
export const trialProductSK = (productId: string): string =>
  `ENTITLEMENT#trial#PRODUCT#${productId}`;

/**
 *  - active:     in the free trial (card verified), capped at productLimit
 *  - subscribed: paying; not limited by the trial
 *  - exempt:     internal/grandfathered account; not limited
 * A tenant with NO entitlement record has not activated its trial yet.
 */
export type EntitlementStatus = "active" | "subscribed" | "exempt";

export interface Entitlement {
  status: EntitlementStatus;
  productsUsed: number;
  productLimit: number;
  cardVerifiedAt?: string;
}

export class TrialNotActivatedError extends Error {
  readonly code = "TRIAL_NOT_ACTIVATED";
  readonly status = 402;
  constructor() {
    super("Add a card to start your free trial.");
    this.name = "TrialNotActivatedError";
  }
}

export class TrialLimitReachedError extends Error {
  readonly code = "TRIAL_LIMIT_REACHED";
  readonly status = 402;
  constructor(
    message = `Your free trial of ${TRIAL_PRODUCT_LIMIT} products is used up. Subscribe to continue.`,
  ) {
    super(message);
    this.name = "TrialLimitReachedError";
  }
}

export type TrialError = TrialNotActivatedError | TrialLimitReachedError;

export function isTrialError(error: unknown): error is TrialError {
  return (
    error instanceof TrialNotActivatedError ||
    error instanceof TrialLimitReachedError
  );
}

export interface GateOptions {
  /** Products table name; defaults to $PRODUCTS_TABLE then $PRODUCTS_TABLE_NAME. */
  tableName?: string;
  /** Override the TRIAL_ENFORCEMENT env switch (tests). */
  enforced?: boolean;
}

export function isTrialEnforced(options: GateOptions = {}): boolean {
  return options.enforced ?? process.env["TRIAL_ENFORCEMENT"] === "true";
}

function tableFor(options: GateOptions): string {
  const name =
    options.tableName ??
    process.env["PRODUCTS_TABLE"] ??
    process.env["PRODUCTS_TABLE_NAME"];
  // Enforcement on + no table is a deployment mistake. Fail loudly instead of
  // silently letting everyone through (or guessing a table).
  if (!name)
    throw new Error(
      "Trial gate: products table name is not configured (PRODUCTS_TABLE)",
    );
  return name;
}

export async function getEntitlement(
  tenantId: string,
  options: GateOptions = {},
): Promise<Entitlement | null> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: tableFor(options),
    Key: { PK: tenantPK(tenantId), SK: ENTITLEMENT_SK },
    ConsistentRead: true,
  });
  const item = res.Item;
  if (!item) return null;
  const status = item["status"];
  if (status !== "active" && status !== "subscribed" && status !== "exempt")
    return null;
  return {
    status,
    productsUsed:
      typeof item["productsUsed"] === "number"
        ? (item["productsUsed"] as number)
        : 0,
    productLimit:
      typeof item["productLimit"] === "number"
        ? (item["productLimit"] as number)
        : TRIAL_PRODUCT_LIMIT,
    ...(typeof item["cardVerifiedAt"] === "string"
      ? { cardVerifiedAt: item["cardVerifiedAt"] as string }
      : {}),
  };
}

async function isTrialProduct(
  tenantId: string,
  productId: string,
  tableName: string,
): Promise<boolean> {
  const res = await createTenantDynamoClient(tenantId).get({
    TableName: tableName,
    Key: { PK: tenantPK(tenantId), SK: trialProductSK(productId) },
    ConsistentRead: true,
  });
  return !!res.Item;
}

function reasonCodes(error: unknown): Array<string | undefined> {
  if (
    error instanceof TransactionCanceledException ||
    (error as { name?: string })?.name === "TransactionCanceledException"
  ) {
    return (
      (error as TransactionCanceledException).CancellationReasons ?? []
    ).map((r) => r.Code);
  }
  return [];
}

/**
 * DynamoDB cancels a transaction with `TransactionConflict` when another
 * transaction touches the same item at the same moment: here, the shared trial
 * counter, whenever a seller creates several products at once. That is contention,
 * not a refusal, so retry it. Verified against real DynamoDB: 40 concurrent
 * creates produced 9 such conflicts without this.
 */
const CONFLICT_RETRIES = 8;
function isTransactionConflict(error: unknown): boolean {
  return reasonCodes(error).includes("TransactionConflict");
}
const backoff = (attempt: number) =>
  new Promise<void>((r) =>
    setTimeout(r, Math.round(Math.random() * 20 * 2 ** Math.min(attempt, 5))),
  );

export type ReserveOutcome = "reserved" | "already" | "unlimited";

/**
 * Takes one trial slot for `productId`.
 *  - 'unlimited': not enforced, or the tenant is subscribed/exempt (nothing reserved)
 *  - 'reserved':  a new slot was taken
 *  - 'already':   this product already held a slot (idempotent retry)
 * Throws TrialNotActivatedError / TrialLimitReachedError when it must not proceed.
 */
export async function reserveProductSlot(
  tenantId: string,
  productId: string,
  options: GateOptions = {},
): Promise<ReserveOutcome> {
  if (!isTrialEnforced(options)) return "unlimited";
  const tableName = tableFor(options);

  const entitlement = await getEntitlement(tenantId, options);
  if (!entitlement) throw new TrialNotActivatedError();
  if (entitlement.status !== "active") return "unlimited";

  const client = createTenantDynamoClient(tenantId);
  const pk = tenantPK(tenantId);
  for (let attempt = 0; ; attempt++) {
    try {
      await client.transactWrite({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: { PK: pk, SK: ENTITLEMENT_SK },
              UpdateExpression: "ADD #used :one",
              // The cap is enforced IN the write: two concurrent creates cannot both pass.
              ConditionExpression:
                "#status = :active AND (attribute_not_exists(#used) OR #used < #limit)",
              ExpressionAttributeNames: {
                "#used": "productsUsed",
                "#status": "status",
                "#limit": "productLimit",
              },
              ExpressionAttributeValues: { ":one": 1, ":active": "active" },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: pk,
                SK: trialProductSK(productId),
                tenantId,
                productId,
                reservedAt: new Date().toISOString(),
              },
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
        ],
      });
      return "reserved";
    } catch (error) {
      if (isTransactionConflict(error) && attempt < CONFLICT_RETRIES) {
        await backoff(attempt);
        continue;
      }
      const [counterReason, markerReason] = reasonCodes(error);
      // The marker already exists: this product holds a slot (retry / duplicate call).
      if (markerReason === "ConditionalCheckFailed") return "already";
      if (counterReason === "ConditionalCheckFailed") {
        // Either the cap is full, or the tenant subscribed between our read and write.
        const fresh = await getEntitlement(tenantId, options);
        if (fresh && fresh.status !== "active") return "unlimited";
        throw new TrialLimitReachedError();
      }
      throw error;
    }
  }
}

export interface ReserveManyResult {
  allowed: string[];
  blocked: string[];
  /** Why the blocked ones were blocked (absent when none were). */
  reason?: "TRIAL_LIMIT_REACHED" | "TRIAL_NOT_ACTIVATED";
}

/**
 * Reserves slots for many products (bulk import) and reports which may be
 * created. Never throws for a limit: a bulk import should create what fits and
 * report the rest, not fail the whole job. Stops at the first refusal, so the
 * number of DynamoDB calls is bounded by the remaining allowance.
 */
export async function reserveProductSlots(
  tenantId: string,
  productIds: string[],
  options: GateOptions = {},
): Promise<ReserveManyResult> {
  if (!isTrialEnforced(options))
    return { allowed: [...productIds], blocked: [] };

  const allowed: string[] = [];
  for (let i = 0; i < productIds.length; i++) {
    try {
      await reserveProductSlot(tenantId, productIds[i]!, options);
      allowed.push(productIds[i]!);
    } catch (error) {
      if (
        error instanceof TrialLimitReachedError ||
        error instanceof TrialNotActivatedError
      ) {
        return {
          allowed,
          blocked: productIds.slice(i),
          reason:
            error instanceof TrialLimitReachedError
              ? "TRIAL_LIMIT_REACHED"
              : "TRIAL_NOT_ACTIVATED",
        };
      }
      throw error;
    }
  }
  return { allowed, blocked: [] };
}

/**
 * Gives a slot back because the product was NOT actually created (the write
 * failed after reserving). Failed uploads must not use up the trial. No-op if the
 * product holds no slot.
 */
export async function releaseProductSlot(
  tenantId: string,
  productId: string,
  options: GateOptions = {},
): Promise<void> {
  if (!isTrialEnforced(options)) return;
  const tableName = tableFor(options);
  const pk = tenantPK(tenantId);
  for (let attempt = 0; ; attempt++) {
    try {
      await createTenantDynamoClient(tenantId).transactWrite({
        TransactItems: [
          {
            Delete: {
              TableName: tableName,
              Key: { PK: pk, SK: trialProductSK(productId) },
              ConditionExpression: "attribute_exists(SK)",
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: pk, SK: ENTITLEMENT_SK },
              UpdateExpression: "ADD #used :minusOne",
              ConditionExpression: "#used > :zero",
              ExpressionAttributeNames: { "#used": "productsUsed" },
              ExpressionAttributeValues: { ":minusOne": -1, ":zero": 0 },
            },
          },
        ],
      });
      return;
    } catch (error) {
      if (isTransactionConflict(error) && attempt < CONFLICT_RETRIES) {
        await backoff(attempt);
        continue;
      }
      // No marker (nothing was reserved, or already released): nothing to give back.
      if (reasonCodes(error).some((c) => c === "ConditionalCheckFailed"))
        return;
      throw error;
    }
  }
}

/**
 * Throws unless AI generation is allowed.
 *  - subscribed / exempt: always allowed
 *  - active trial, for a specific product: allowed only for products in the trial
 *    allow-list (so the seller can keep correcting those)
 *  - active trial, no product (free-form generation): allowed only while the trial
 *    still has unused slots
 *  - no entitlement: not activated
 */
export async function assertCanGenerate(
  tenantId: string,
  productId: string | undefined,
  options: GateOptions = {},
): Promise<void> {
  if (!isTrialEnforced(options)) return;
  const entitlement = await getEntitlement(tenantId, options);
  if (!entitlement) throw new TrialNotActivatedError();
  if (entitlement.status !== "active") return;

  if (productId) {
    if (await isTrialProduct(tenantId, productId, tableFor(options))) return;
    throw new TrialLimitReachedError(
      "This product is not part of your free trial. Subscribe to generate content for more products.",
    );
  }
  if (entitlement.productsUsed >= entitlement.productLimit)
    throw new TrialLimitReachedError();
}

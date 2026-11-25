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
 * gate function returns immediately without touching DynamoDB, so shipping this
 * code cannot change existing behaviour.
 *
 * ACTIVATION (TRIAL_ACTIVATION):
 *  - 'auto' (default): a seller's trial starts with their first product. Anti-abuse
 *    is enforced at sign-up (one account per email / phone / business name).
 *  - 'card': the trial must be activated by billing after a card check (parked
 *    with the PayFast card-verification work); until then creation is refused.
 *
 * SUBSCRIPTIONS: billing calls markSubscribed() when a payment lands, recording
 * `subscribedUntil` (the paid period end). Up to GRACE_DAYS past that date it
 * still counts as paid; after that the plan is paused (PlanPausedError) without
 * any cancellation hook. See billing-stage.ts for the full cycle.
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
import { GRACE_DAYS } from "./billing-stage";

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
  /** ISO end of the paid period; absent for exempt / never-paid tenants. */
  subscribedUntil?: string;
  /** Paid plans: new products allowed per calendar month (absent = unlimited). */
  monthlyProductLimit?: number;
}

/** Calendar month key (UTC), e.g. "202611". */
export function monthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7).replace('-', '');
}
export const monthCounterSK = (yyyyMM: string): string => `ENTITLEMENT#month#${yyyyMM}`;
export const monthProductSK = (yyyyMM: string, productId: string): string =>
  `ENTITLEMENT#month#${yyyyMM}#PRODUCT#${productId}`;

/** What applies right now: the stored status, or 'lapsed' for a paid plan that has run out. */
export type EffectiveStatus = EntitlementStatus | "lapsed";

/**
 * The status that applies right now (see billing-stage.ts):
 *  - a paid period that ended less than GRACE_DAYS ago still counts as paid
 *  - after that the plan is 'lapsed' (paused, then closed): no new products and
 *    no new listings until the seller pays again. A lapsed seller does NOT fall
 *    back to the free trial (that would hand out 15 more free products).
 */
export function effectiveStatus(e: Entitlement, now: Date = new Date()): EffectiveStatus {
  if (e.status === "subscribed" && e.subscribedUntil) {
    const until = Date.parse(e.subscribedUntil);
    if (!Number.isNaN(until) && until + GRACE_DAYS * 24 * 60 * 60 * 1000 <= now.getTime()) return "lapsed";
  }
  return e.status;
}

export type TrialActivationMode = "auto" | "card";
export function trialActivationMode(): TrialActivationMode {
  return process.env["TRIAL_ACTIVATION"] === "card" ? "card" : "auto";
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

/** A paid plan's new-product allowance for this month is used up. */
export class PlanLimitReachedError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";
  readonly status = 402;
  constructor(limit: number) {
    super(
      `You've added all ${limit.toLocaleString("en-ZA")} new products in your plan this month. Upgrade your plan, or carry on next month.`,
    );
    this.name = "PlanLimitReachedError";
  }
}

/** The paid plan ran out more than GRACE_DAYS ago: paused until the seller pays again. */
export class PlanPausedError extends Error {
  readonly code = "PLAN_PAUSED";
  readonly status = 402;
  constructor() {
    super(
      "Your plan is paused because the last payment was not made. Your products are safe. Pay on the Billing page to add products and write listings again.",
    );
    this.name = "PlanPausedError";
  }
}

export type TrialError = TrialNotActivatedError | TrialLimitReachedError | PlanLimitReachedError | PlanPausedError;

/** True for every entitlement refusal (all map to HTTP 402 with their code). */
export function isTrialError(error: unknown): error is TrialError {
  return (
    error instanceof TrialNotActivatedError ||
    error instanceof TrialLimitReachedError ||
    error instanceof PlanLimitReachedError ||
    error instanceof PlanPausedError
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
    ...(typeof item["subscribedUntil"] === "string"
      ? { subscribedUntil: item["subscribedUntil"] as string }
      : {}),
    ...(typeof item["monthlyProductLimit"] === "number"
      ? { monthlyProductLimit: item["monthlyProductLimit"] as number }
      : {}),
  };
}

/**
 * Paid plans: takes one of this month's new-product slots (counter + marker in
 * one transaction, cap checked in the write, same pattern as the trial).
 */
async function reserveMonthlySlot(
  tenantId: string,
  productId: string,
  limit: number,
  options: GateOptions,
): Promise<ReserveOutcome> {
  const tableName = tableFor(options);
  const client = createTenantDynamoClient(tenantId);
  const pk = tenantPK(tenantId);
  const yyyyMM = monthKey();
  // The tenant-scoped client only updates EXISTING items, so create the month's
  // counter first (put-if-absent; concurrent first products are fine).
  try {
    await client.put({
      TableName: tableName,
      Item: { PK: pk, SK: monthCounterSK(yyyyMM), tenantId, month: yyyyMM, productsUsed: 0 },
      ConditionExpression: "attribute_not_exists(SK)",
    });
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await client.transactWrite({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: { PK: pk, SK: monthCounterSK(yyyyMM) },
              UpdateExpression: "ADD #used :one SET #limit = :limit",
              ConditionExpression: "attribute_not_exists(#used) OR #used < :limit",
              ExpressionAttributeNames: { "#used": "productsUsed", "#limit": "productLimit" },
              ExpressionAttributeValues: { ":one": 1, ":limit": limit },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: pk,
                SK: monthProductSK(yyyyMM, productId),
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
      if (markerReason === "ConditionalCheckFailed") return "already";
      if (counterReason === "ConditionalCheckFailed") throw new PlanLimitReachedError(limit);
      throw error;
    }
  }
}

/** Gives back this month's slot for a product whose creation failed. */
async function releaseMonthlySlot(tenantId: string, productId: string, tableName: string): Promise<void> {
  const pk = tenantPK(tenantId);
  const yyyyMM = monthKey();
  for (let attempt = 0; ; attempt++) {
    try {
      await createTenantDynamoClient(tenantId).transactWrite({
        TransactItems: [
          {
            Delete: {
              TableName: tableName,
              Key: { PK: pk, SK: monthProductSK(yyyyMM, productId) },
              ConditionExpression: "attribute_exists(SK)",
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: pk, SK: monthCounterSK(yyyyMM) },
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
      if (reasonCodes(error).some((c) => c === "ConditionalCheckFailed")) return;
      throw error;
    }
  }
}

function isConditionalFailure(error: unknown): boolean {
  return (error as { name?: string })?.name === "ConditionalCheckFailedException";
}

/**
 * Returns the tenant's entitlement, starting the free trial if it has none and
 * activation is automatic. Concurrent first calls are safe (put-if-absent).
 */
async function ensureEntitlement(
  tenantId: string,
  options: GateOptions,
): Promise<Entitlement | null> {
  const existing = await getEntitlement(tenantId, options);
  if (existing || trialActivationMode() !== "auto") return existing;
  try {
    await createTenantDynamoClient(tenantId).put({
      TableName: tableFor(options),
      Item: {
        PK: tenantPK(tenantId),
        SK: ENTITLEMENT_SK,
        tenantId,
        status: "active",
        productsUsed: 0,
        productLimit: TRIAL_PRODUCT_LIMIT,
        activation: "auto",
        activatedAt: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(SK)",
    });
  } catch (error) {
    if (!isConditionalFailure(error)) throw error; // another request created it first
  }
  return getEntitlement(tenantId, options);
}

/** What the seller UI shows ("X of 15 free products used"). Never creates anything. */
export interface TrialUsage {
  enforced: boolean;
  /** 'not_started' = no product created yet (the trial starts with the first one). */
  /** 'paused' = a paid plan ran out (past the grace period). */
  status: "not_started" | "trial" | "subscribed" | "exempt" | "paused";
  /** What productsUsed/productLimit count: the one-off trial, or this calendar month. */
  period: "trial" | "month";
  productsUsed: number;
  productLimit: number;
  remaining: number;
  subscribedUntil?: string;
  activation: TrialActivationMode;
}

export async function getTrialUsage(
  tenantId: string,
  options: GateOptions = {},
): Promise<TrialUsage> {
  const enforced = isTrialEnforced(options);
  const e = await getEntitlement(tenantId, options);
  const s = e ? effectiveStatus(e) : null;
  let productLimit = e?.productLimit ?? TRIAL_PRODUCT_LIMIT;
  let productsUsed = e?.productsUsed ?? 0;
  let period: "trial" | "month" = "trial";
  if (s === "subscribed" && e?.monthlyProductLimit !== undefined) {
    // Paid plan: report this month's new-product count.
    const res = await createTenantDynamoClient(tenantId).get({
      TableName: tableFor(options),
      Key: { PK: tenantPK(tenantId), SK: monthCounterSK(monthKey()) },
      ConsistentRead: true,
    });
    productLimit = e.monthlyProductLimit;
    productsUsed = typeof res.Item?.["productsUsed"] === "number" ? (res.Item["productsUsed"] as number) : 0;
    period = "month";
  }
  return {
    enforced,
    status: !e
      ? "not_started"
      : s === "active"
        ? "trial"
        : s === "subscribed"
          ? "subscribed"
          : s === "lapsed"
            ? "paused"
            : "exempt",
    period,
    productsUsed,
    productLimit,
    remaining: Math.max(0, productLimit - productsUsed),
    ...(e?.subscribedUntil ? { subscribedUntil: e.subscribedUntil } : {}),
    activation: trialActivationMode(),
  };
}

/**
 * Billing: the tenant has paid until `until` (ISO). Recorded whether or not
 * enforcement is on, so switching it on later does not cap paying sellers.
 * Idempotent, and never shortens an existing paid period.
 */
export async function markSubscribed(
  tenantId: string,
  until: string,
  options: {
    tableName?: string;
    /** The plan's new products per month; null/undefined = unlimited (custom plans). */
    monthlyProductLimit?: number | null;
    /** Card on file, charged automatically (reminder and banner wording). */
    autoRenew?: boolean;
  } = {},
): Promise<void> {
  const client = createTenantDynamoClient(tenantId);
  const TableName = tableFor(options);
  const Key = { PK: tenantPK(tenantId), SK: ENTITLEMENT_SK };
  const limit = typeof options.monthlyProductLimit === "number" ? options.monthlyProductLimit : undefined;
  const auto = typeof options.autoRenew === "boolean" ? options.autoRenew : undefined;
  try {
    await client.put({
      TableName,
      Item: {
        ...Key, tenantId, status: "subscribed", subscribedUntil: until, productsUsed: 0, productLimit: TRIAL_PRODUCT_LIMIT,
        ...(limit !== undefined ? { monthlyProductLimit: limit } : {}),
        ...(auto !== undefined ? { autoRenew: auto } : {}),
      },
      ConditionExpression: "attribute_not_exists(SK)",
    });
    return;
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
  try {
    const sets = ["#status = :subscribed", "#until = :until"];
    if (limit !== undefined) sets.push("#mpl = :mpl");
    if (auto !== undefined) sets.push("#auto = :auto");
    await client.update({
      TableName,
      Key,
      // exempt accounts stay exempt; a later (or equal) period wins. The plan's
      // monthly allowance follows the latest payment (upgrades/downgrades).
      UpdateExpression: `SET ${sets.join(", ")}${limit === undefined ? " REMOVE #mpl" : ""}`,
      ConditionExpression:
        "#status <> :exempt AND (attribute_not_exists(#until) OR #until <= :until OR #status <> :subscribed)",
      ExpressionAttributeNames: {
        "#status": "status", "#until": "subscribedUntil", "#mpl": "monthlyProductLimit",
        ...(auto !== undefined ? { "#auto": "autoRenew" } : {}),
      },
      ExpressionAttributeValues: {
        ":subscribed": "subscribed", ":exempt": "exempt", ":until": until,
        ...(limit !== undefined ? { ":mpl": limit } : {}),
        ...(auto !== undefined ? { ":auto": auto } : {}),
      },
    });
  } catch (error) {
    // Exempt, or already paid for a later period: nothing to do.
    if (!isConditionalFailure(error)) throw error;
  }
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

  const entitlement = await ensureEntitlement(tenantId, options);
  if (!entitlement) throw new TrialNotActivatedError();
  const status = effectiveStatus(entitlement);
  if (status === "lapsed") throw new PlanPausedError();
  if (status === "subscribed") {
    // Paid plans sell a number of NEW products per month.
    return entitlement.monthlyProductLimit !== undefined
      ? reserveMonthlySlot(tenantId, productId, entitlement.monthlyProductLimit, options)
      : "unlimited";
  }
  if (status !== "active") return "unlimited";

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
              // Only trial sellers use this counter (a lapsed plan is refused above).
              ConditionExpression:
                "#status = :active AND (attribute_not_exists(#used) OR #used < #limit)",
              ExpressionAttributeNames: {
                "#used": "productsUsed",
                "#status": "status",
                "#limit": "productLimit",
              },
              ExpressionAttributeValues: {
                ":one": 1,
                ":active": "active",
              },
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
        if (fresh && effectiveStatus(fresh) === "subscribed" && fresh.monthlyProductLimit !== undefined) {
          // Subscribed between our read and write: count against the plan instead.
          return reserveMonthlySlot(tenantId, productId, fresh.monthlyProductLimit, options);
        }
        if (fresh && effectiveStatus(fresh) === "lapsed") throw new PlanPausedError();
        if (fresh && effectiveStatus(fresh) !== "active") return "unlimited";
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
  reason?: "TRIAL_LIMIT_REACHED" | "TRIAL_NOT_ACTIVATED" | "PLAN_LIMIT_REACHED" | "PLAN_PAUSED";
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

  // Unlimited (exempt, or a plan without a monthly limit): one read instead of
  // one per product (large imports).
  const entitlement = await ensureEntitlement(tenantId, options);
  if (entitlement) {
    const s = effectiveStatus(entitlement);
    if (s === "exempt" || (s === "subscribed" && entitlement.monthlyProductLimit === undefined))
      return { allowed: [...productIds], blocked: [] };
  }

  const allowed: string[] = [];
  for (let i = 0; i < productIds.length; i++) {
    try {
      await reserveProductSlot(tenantId, productIds[i]!, options);
      allowed.push(productIds[i]!);
    } catch (error) {
      if (isTrialError(error)) {
        return { allowed, blocked: productIds.slice(i), reason: error.code };
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
      // No trial marker: the slot (if any) came from this month's paid allowance.
      if (reasonCodes(error).some((c) => c === "ConditionalCheckFailed"))
        return releaseMonthlySlot(tenantId, productId, tableName);
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
  const entitlement = await ensureEntitlement(tenantId, options);
  if (!entitlement) throw new TrialNotActivatedError();
  const status = effectiveStatus(entitlement);
  // Paused: the seller can still edit by hand, but no new listings are written.
  if (status === "lapsed") throw new PlanPausedError();
  if (status !== "active") return;

  if (productId) {
    if (await isTrialProduct(tenantId, productId, tableFor(options))) return;
    throw new TrialLimitReachedError(
      "This product is not part of your free trial. Subscribe to generate content for more products.",
    );
  }
  if (entitlement.productsUsed >= entitlement.productLimit)
    throw new TrialLimitReachedError();
}

/**
 * Billing: automatic charges switched off (the seller cancelled, or PayFast
 * ended the card subscription). The paid period itself is unchanged.
 */
export async function setAutoRenew(tenantId: string, autoRenew: boolean, options: GateOptions = {}): Promise<void> {
  try {
    await createTenantDynamoClient(tenantId).update({
      TableName: tableFor(options),
      Key: { PK: tenantPK(tenantId), SK: ENTITLEMENT_SK },
      UpdateExpression: "SET #auto = :auto",
      ConditionExpression: "attribute_exists(SK)",
      ExpressionAttributeNames: { "#auto": "autoRenew" },
      ExpressionAttributeValues: { ":auto": autoRenew },
    });
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
}

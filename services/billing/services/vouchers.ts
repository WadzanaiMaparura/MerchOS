/**
 * Discount vouchers.
 *
 * Storage (BILLING_TABLE), deliberately OUTSIDE the tenant partitions so a
 * tenant-scoped client can never read or write them:
 *   PK = VOUCHER#<CODE>      SK = META                 the voucher definition
 *   PK = VOUCHERUSE#<CODE>   SK = PAYMENT#<mPaymentId> one marker per redemption
 *
 * The price a seller pays is ALWAYS computed here on the server and stored on
 * the checkout intent; the ITN then verifies PayFast's posted amount against
 * it. A client can send a code but never an amount.
 *
 * A voucher can never take the charge below PAYFAST_MIN_CHARGE_CENTS (R5.00,
 * the minimum PayFast/banks accept) - the discount is capped instead.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { BILLING_TABLE } from '../../shared/utils/dynamo-client';

/** PayFast rejects live transactions below R5.00. */
export const PAYFAST_MIN_CHARGE_CENTS = 500;

export type VoucherKind = 'amount_off_cents' | 'percent_off';

export interface VoucherRecord {
  code: string;
  kind: VoucherKind;
  /** amount_off_cents: cents off. percent_off: whole percent 1-100. */
  value: number;
  /** Restrict to these plan ids; omit for all plans. */
  planIds?: string[];
  /** Maximum successful redemptions; omit for unlimited. */
  maxRedemptions?: number;
  redeemed: number;
  /** ISO 8601 expiry; omit for none. */
  expiresAt?: string;
  active: boolean;
  note?: string;
  createdAt: string;
}

export interface VoucherPricing {
  voucherCode: string;
  listPriceCents: number;
  discountCents: number;
  finalCents: number;
}

/** Deliberately generic: never reveals whether a code exists. */
export class VoucherError extends Error {
  readonly code = 'VOUCHER_INVALID';
  readonly status = 400;
  constructor() {
    super('This voucher code is not valid for this plan.');
    this.name = 'VoucherError';
  }
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

export function normaliseVoucherCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function voucherPK(code: string): string {
  return `VOUCHER#${code}`;
}
function voucherUsePK(code: string): string {
  return `VOUCHERUSE#${code}`;
}

/** Pure pricing + validity rules (no I/O). Throws VoucherError when unusable. */
export function priceWithVoucher(
  voucher: VoucherRecord | null | undefined,
  planId: string,
  listPriceCents: number,
  now: Date = new Date()
): VoucherPricing {
  if (!voucher || !voucher.active) throw new VoucherError();
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() <= now.getTime()) {
    throw new VoucherError();
  }
  if (voucher.planIds && voucher.planIds.length > 0 && !voucher.planIds.includes(planId)) {
    throw new VoucherError();
  }
  if (voucher.maxRedemptions !== undefined && voucher.redeemed >= voucher.maxRedemptions) {
    throw new VoucherError();
  }

  let discount: number;
  if (voucher.kind === 'amount_off_cents') {
    if (!Number.isInteger(voucher.value) || voucher.value <= 0) throw new VoucherError();
    discount = voucher.value;
  } else if (voucher.kind === 'percent_off') {
    if (!Number.isInteger(voucher.value) || voucher.value < 1 || voucher.value > 100) {
      throw new VoucherError();
    }
    discount = Math.floor((listPriceCents * voucher.value) / 100);
  } else {
    throw new VoucherError();
  }

  // Never charge below PayFast's minimum (and never below zero).
  const maxDiscount = Math.max(0, listPriceCents - PAYFAST_MIN_CHARGE_CENTS);
  const appliedDiscount = Math.min(discount, maxDiscount);
  return {
    voucherCode: voucher.code,
    listPriceCents,
    discountCents: appliedDiscount,
    finalCents: listPriceCents - appliedDiscount,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let docClient: DynamoDBDocumentClient | undefined;
function client(): DynamoDBDocumentClient {
  docClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return docClient;
}

/** Test seam. */
export function setVoucherDocClient(c: DynamoDBDocumentClient | undefined): void {
  docClient = c;
}

export async function getVoucher(code: string): Promise<VoucherRecord | null> {
  const normalised = normaliseVoucherCode(code);
  if (!CODE_PATTERN.test(normalised)) return null;
  const res = await client().send(
    new GetCommand({
      TableName: BILLING_TABLE,
      Key: { PK: voucherPK(normalised), SK: 'META' },
    })
  );
  return res.Item ? (res.Item as unknown as VoucherRecord) : null;
}

/** Looks up and prices a voucher for a plan; throws VoucherError if unusable. */
export async function resolveVoucher(
  code: string,
  planId: string,
  listPriceCents: number,
  now: Date = new Date()
): Promise<VoucherPricing> {
  return priceWithVoucher(await getVoucher(code), planId, listPriceCents, now);
}

/**
 * Records one redemption for a completed payment. Idempotent per payment: the
 * marker item is created with attribute_not_exists, in the same transaction as
 * the counter increment, so a retried ITN cannot double count.
 * Returns true if this call recorded it, false if it was already recorded.
 */
export async function recordVoucherRedemption(
  code: string,
  tenantId: string,
  mPaymentId: string
): Promise<boolean> {
  try {
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: BILLING_TABLE,
              Item: {
                PK: voucherUsePK(code),
                SK: `PAYMENT#${mPaymentId}`,
                code,
                tenantId,
                mPaymentId,
                redeemedAt: new Date().toISOString(),
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Update: {
              TableName: BILLING_TABLE,
              Key: { PK: voucherPK(code), SK: 'META' },
              // `redeemed` is not reserved, but alias anyway for consistency.
              UpdateExpression: 'SET #r = if_not_exists(#r, :zero) + :one',
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeNames: { '#r': 'redeemed' },
              ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
            },
          },
        ],
      })
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'TransactionCanceledException') return false;
    throw error;
  }
}

#!/usr/bin/env node
/**
 * Creates (or refuses to overwrite) a discount voucher in the billing table.
 *
 * Usage (from services/billing, with AWS SSO logged in):
 *   $env:AWS_PROFILE='merchos-admin'; $env:AWS_REGION='eu-west-1'
 *   node scripts/create-voucher.mjs --code LIVE-TEST-R5 --kind amount_off_cents --value 49400 \
 *        --plans starter --max 5 --expires 2026-11-24T00:00:00Z --note "Live smoke test"
 *
 *   --kind   amount_off_cents (value = cents off) | percent_off (value = 1-100)
 *   --plans  comma-separated plan ids (default: all plans)
 *   --max    maximum successful redemptions (default: unlimited)
 *   --expires ISO-8601 expiry (default: none)
 *   --table  billing table (default: merch-os-billing-dev)
 *
 * The charge can never fall below R5.00 (PayFast minimum), whatever the value.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const code = String(args.code ?? '').trim().toUpperCase();
if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) fail('--code must be 3-40 chars: A-Z, 0-9, _ or -');
const kind = args.kind;
if (!['amount_off_cents', 'percent_off'].includes(kind)) fail('--kind must be amount_off_cents or percent_off');
const value = Number(args.value);
if (!Number.isInteger(value) || value <= 0) fail('--value must be a positive integer');
if (kind === 'percent_off' && value > 100) fail('percent_off --value must be 1-100');

const item = {
  PK: `VOUCHER#${code}`,
  SK: 'META',
  code,
  kind,
  value,
  redeemed: 0,
  active: true,
  createdAt: new Date().toISOString(),
  ...(args.plans ? { planIds: String(args.plans).split(',').map((p) => p.trim()).filter(Boolean) } : {}),
  ...(args.max ? { maxRedemptions: Number(args.max) } : {}),
  ...(args.expires ? { expiresAt: new Date(args.expires).toISOString() } : {}),
  ...(args.note ? { note: String(args.note) } : {}),
};
if (item.maxRedemptions !== undefined && (!Number.isInteger(item.maxRedemptions) || item.maxRedemptions < 1)) {
  fail('--max must be a positive integer');
}

const table = args.table ?? 'merch-os-billing-dev';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'eu-west-1' }));

try {
  await client.send(
    new PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }),
  );
  console.log(`Created voucher ${code} in ${table}:`);
  console.log(JSON.stringify({ ...item, PK: undefined, SK: undefined }, null, 2));
} catch (e) {
  if (e?.name === 'ConditionalCheckFailedException') fail(`voucher ${code} already exists (not overwritten)`);
  throw e;
}

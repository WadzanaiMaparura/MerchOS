/**
 * Sequential, gap-free invoice numbers (MOS-000001, MOS-000002, ...).
 *
 * A serial number is a legal requirement on invoices and an auditor expects an
 * unbroken sequence. So the number is claimed in ONE DynamoDB transaction that
 *   (a) bumps the global counter, guarded by the value we just read, and
 *   (b) stamps that number onto the invoice item, guarded by "has no number yet".
 * Either both happen or neither does, so a crash, a retry or two concurrent
 * attempts can never skip a number or give one invoice two numbers.
 *
 * The counter item lives outside any tenant partition (PK = COUNTER#INVOICE).
 */
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { BILLING_TABLE, invoiceSK, tenantPK } from '../../shared/utils/dynamo-client';
import { getDocClient } from '../services/doc-client';

export const INVOICE_PREFIX = 'MOS-';
const COUNTER_KEY = { PK: 'COUNTER#INVOICE', SK: 'META' };
const MAX_ATTEMPTS = 8;

export function formatInvoiceNumber(sequence: number): string {
  return `${INVOICE_PREFIX}${String(sequence).padStart(6, '0')}`;
}

async function existingNumber(tenantId: string, invoiceId: string): Promise<string | undefined> {
  const res = await getDocClient().send(
    new GetCommand({
      TableName: BILLING_TABLE,
      Key: { PK: tenantPK(tenantId), SK: invoiceSK(invoiceId) },
      ConsistentRead: true,
    })
  );
  if (!res.Item) throw new Error(`Invoice ${invoiceId} not found for tenant`);
  const n = res.Item['invoiceNumber'];
  return typeof n === 'string' ? n : undefined;
}

/** Returns the invoice's number, assigning the next one if it has none. Idempotent. */
export async function assignInvoiceNumber(tenantId: string, invoiceId: string): Promise<string> {
  const client = getDocClient();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const already = await existingNumber(tenantId, invoiceId);
    if (already) return already;

    const counter = await client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: COUNTER_KEY, ConsistentRead: true })
    );
    const current = typeof counter.Item?.['seq'] === 'number' ? (counter.Item['seq'] as number) : 0;
    const next = current + 1;
    const number = formatInvoiceNumber(next);

    try {
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: BILLING_TABLE,
                Key: COUNTER_KEY,
                UpdateExpression: 'SET #s = :next',
                // First ever use (no item/attribute yet) or still exactly what we read.
                ConditionExpression: 'attribute_not_exists(#s) OR #s = :current',
                ExpressionAttributeNames: { '#s': 'seq' },
                ExpressionAttributeValues: { ':next': next, ':current': current },
              },
            },
            {
              Update: {
                TableName: BILLING_TABLE,
                Key: { PK: tenantPK(tenantId), SK: invoiceSK(invoiceId) },
                UpdateExpression: 'SET #n = :number, #t = :now',
                ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#n)',
                ExpressionAttributeNames: { '#n': 'invoiceNumber', '#t': 'numberAssignedAt' },
                ExpressionAttributeValues: { ':number': number, ':now': new Date().toISOString() },
              },
            },
          ],
        })
      );
      return number;
    } catch (error) {
      // Lost a race (counter moved, or another attempt numbered this invoice).
      // Loop: re-read, and either return the number someone else assigned or retry.
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;
    }
  }
  throw new Error(`Could not assign an invoice number for ${invoiceId} after ${MAX_ATTEMPTS} attempts`);
}

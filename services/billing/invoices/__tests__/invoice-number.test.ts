import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assignInvoiceNumber, formatInvoiceNumber, INVOICE_START_NUMBER } from '../invoice-number';
import { setDocClient } from '../../services/doc-client';

const send = vi.fn();

/** Programs `send` from a queue of results; a result that is an Error is thrown. */
function queue(...results: unknown[]) {
  for (const r of results) {
    send.mockImplementationOnce(async () => {
      if (r instanceof Error) throw r;
      return r;
    });
  }
}
const cancelled = () => Object.assign(new Error('tx cancelled'), { name: 'TransactionCanceledException' });
const invoiceItem = (invoiceNumber?: string) => ({ Item: { PK: 'TENANT#t1', SK: 'INVOICE#i1', ...(invoiceNumber ? { invoiceNumber } : {}) } });

beforeEach(() => {
  send.mockReset();
  setDocClient({ send } as never);
});

describe('formatInvoiceNumber', () => {
  it.each([
    [1, 'MOS-000001'],
    [42, 'MOS-000042'],
    [999999, 'MOS-999999'],
    [1000000, 'MOS-1000000'],
  ])('%i -> %s', (n, out) => expect(formatInvoiceNumber(n)).toBe(out));
});

describe('assignInvoiceNumber', () => {
  it('returns the existing number without touching the counter (idempotent)', async () => {
    queue(invoiceItem('MOS-000007'));
    expect(await assignInvoiceNumber('t1', 'i1')).toBe('MOS-000007');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('starts at the configured offset (MOS-010000), not at 1, when no counter exists yet', async () => {
    expect(INVOICE_START_NUMBER).toBe(10000);
    queue(invoiceItem(), {} /* no counter */, {} /* transaction ok */);
    expect(await assignInvoiceNumber('t1', 'i1')).toBe('MOS-010000');
    const tx = send.mock.calls[2]![0].input.TransactItems;
    expect(tx[0].Update.Key).toEqual({ PK: 'COUNTER#INVOICE', SK: 'META' });
    expect(tx[0].Update.ExpressionAttributeValues).toEqual({ ':next': 10000, ':current': 0 });
  });

  it('claims counter+1 and stamps it on the invoice in ONE transaction, guarded both ways', async () => {
    queue(invoiceItem(), { Item: { seq: 10041 } }, {});
    expect(await assignInvoiceNumber('t1', 'i1')).toBe('MOS-010042');
    const [counter, invoice] = send.mock.calls[2]![0].input.TransactItems;
    expect(counter.Update.ConditionExpression).toBe('attribute_not_exists(#s) OR #s = :current');
    expect(counter.Update.ExpressionAttributeValues).toEqual({ ':next': 10042, ':current': 10041 });
    expect(invoice.Update.Key).toEqual({ PK: 'TENANT#t1', SK: 'INVOICE#i1' });
    expect(invoice.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_not_exists(#n)');
    expect(invoice.Update.ExpressionAttributeValues[':number']).toBe('MOS-010042');
  });

  it('on a lost race (counter moved) re-reads and takes the next number: no number is skipped or reused', async () => {
    queue(
      invoiceItem(), { Item: { seq: 10005 } }, cancelled(), // someone else took 10006
      invoiceItem(), { Item: { seq: 10006 } }, {} // we take 10007
    );
    expect(await assignInvoiceNumber('t1', 'i1')).toBe('MOS-010007');
  });

  it('if another attempt numbered THIS invoice meanwhile, returns that number and consumes nothing', async () => {
    queue(invoiceItem(), { Item: { seq: 9 } }, cancelled(), invoiceItem('MOS-000010'));
    expect(await assignInvoiceNumber('t1', 'i1')).toBe('MOS-000010');
    // 4 calls only: no second counter read / transaction.
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('a counter below the offset (e.g. left over from testing) still jumps to the offset, never below it', async () => {
    queue(invoiceItem(), { Item: { seq: 3 } }, {});
    expect(await assignInvoiceNumber('t1', 'i1')).toBe('MOS-010000');
  });

  it('rejects an unknown invoice', async () => {
    queue({});
    await expect(assignInvoiceNumber('t1', 'nope')).rejects.toThrow(/not found/);
  });

  it('gives up after repeated contention instead of looping forever', async () => {
    for (let i = 0; i < 8; i++) queue(invoiceItem(), { Item: { seq: i } }, cancelled());
    await expect(assignInvoiceNumber('t1', 'i1')).rejects.toThrow(/after 8 attempts/);
  });

  it('propagates unexpected errors (does not swallow them as a lost race)', async () => {
    queue(invoiceItem(), { Item: { seq: 1 } }, Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    await expect(assignInvoiceNumber('t1', 'i1')).rejects.toThrow('throttled');
  });
});

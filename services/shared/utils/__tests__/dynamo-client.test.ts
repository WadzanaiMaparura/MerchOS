import { describe, it, expect } from 'vitest';
import {
  tenantPK,
  productSK,
  userSK,
  auditSK,
  inventorySK,
  transactionSK,
  subscriptionSK,
  usageSK,
  invoiceSK,
  TenantIsolationError,
  TenantDynamoClient,
} from '../dynamo-client';

describe('Key helper functions', () => {
  it('tenantPK returns correct format', () => {
    expect(tenantPK('abc-123')).toBe('TENANT#abc-123');
  });

  it('productSK returns correct format', () => {
    expect(productSK('prod-456')).toBe('PRODUCT#prod-456');
  });

  it('userSK returns correct format', () => {
    expect(userSK('user-789')).toBe('USER#user-789');
  });

  it('auditSK returns correct format', () => {
    expect(auditSK('2025-01-15T10:00:00Z', 'evt-001')).toBe(
      'AUDIT#2025-01-15T10:00:00Z#evt-001'
    );
  });

  it('inventorySK returns correct format', () => {
    expect(inventorySK('SKU-001', 'WH-MAIN')).toBe('SKU#SKU-001#WH#WH-MAIN');
  });

  it('transactionSK returns correct format', () => {
    expect(transactionSK('2025-01-15T10:00:00Z', 'txn-001')).toBe(
      'TXN#2025-01-15T10:00:00Z#txn-001'
    );
  });

  it('subscriptionSK returns static value', () => {
    expect(subscriptionSK()).toBe('SUBSCRIPTION#current');
  });

  it('usageSK returns correct format', () => {
    expect(usageSK('202501')).toBe('USAGE#202501');
  });

  it('invoiceSK returns correct format', () => {
    expect(invoiceSK('inv-001')).toBe('INVOICE#inv-001');
  });
});

describe('TenantDynamoClient', () => {
  it('throws TenantIsolationError when tenantId is empty', () => {
    expect(() => new TenantDynamoClient('')).toThrow(TenantIsolationError);
    expect(() => new TenantDynamoClient('  ')).toThrow(TenantIsolationError);
  });

  it('constructs successfully with valid tenantId', () => {
    const client = new TenantDynamoClient('tenant-123', {
      region: 'us-east-1',
    });
    expect(client.getTenantId()).toBe('tenant-123');
    expect(client.getPK()).toBe('TENANT#tenant-123');
  });
});

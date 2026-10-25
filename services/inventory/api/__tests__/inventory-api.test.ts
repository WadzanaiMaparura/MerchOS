/**
 * Inventory API handler tests.
 *
 * Exercises the full middy stack (rbacMiddleware -> tenantContextMiddleware ->
 * handler) with a mocked InventoryService injected via each handler's test
 * seam. The powertools aggregator imported by rbac.ts is mocked to avoid the
 * X-Ray/cls-hooked ESM resolution in the test environment (same approach as the
 * shared rbac middleware tests).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

// Mock the powertools aggregator used by rbac.ts (keeps tests independent of
// the Tracer/X-Ray chain). tenant-context + handlers use ./logger directly.
vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// RBAC issuer must be set before the middleware's lazy init runs.
const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
process.env['COGNITO_ISSUER'] = ISSUER;

import { handler as listHandler, setInventoryService as setListSvc } from '../handlers/list-inventory';
import { handler as getHandler, setInventoryService as setGetSvc } from '../handlers/get-inventory';
import { handler as updateHandler, setInventoryService as setUpdateSvc } from '../handlers/update-inventory';
import { handler as importHandler, setInventoryService as setImportSvc } from '../handlers/import-inventory';
import { handler as txHandler, setInventoryService as setTxSvc } from '../handlers/list-transactions';
import { _resetForTesting } from '../../../shared/middleware/rbac';
import {
  ProductNotFoundError,
  NegativeStockError,
  InventoryConcurrentUpdateError,
} from '../../service';
import type { InventoryService } from '../../service';

const TENANT = 'tenant-abc';
const USER = 'user-789';
const CTX = {} as Context;

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

interface ClaimOverrides {
  role?: string;
  tenantId?: string | undefined;
  exp?: number;
  iss?: string;
  omitGroups?: boolean;
  omitAuthorizer?: boolean;
}

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> = {},
  claims: ClaimOverrides = {}
): APIGatewayProxyEventV2 {
  const jwtClaims: Record<string, unknown> = {
    sub: USER,
    iss: claims.iss ?? ISSUER,
    exp: claims.exp ?? futureExp(),
    ...(claims.omitGroups ? {} : { 'cognito:groups': [claims.role ?? 'Seller'] }),
    ...('tenantId' in claims ? (claims.tenantId !== undefined ? { 'custom:tenantId': claims.tenantId } : {}) : { 'custom:tenantId': TENANT }),
  };
  const authorizer = claims.omitAuthorizer ? {} : { jwt: { claims: jwtClaims } };
  return {
    version: '2.0',
    routeKey: 'ANY /inventory',
    rawPath: '/inventory',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      authorizer,
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/inventory', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: 'ANY /inventory',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

function makeService(): InventoryService & {
  listInventory: ReturnType<typeof vi.fn>;
  getBySku: ReturnType<typeof vi.fn>;
  updateStock: ReturnType<typeof vi.fn>;
  listTransactions: ReturnType<typeof vi.fn>;
  importCsvRows: ReturnType<typeof vi.fn>;
} {
  return {
    listInventory: vi.fn(),
    getBySku: vi.fn(),
    updateStock: vi.fn(),
    listTransactions: vi.fn(),
    importCsvRows: vi.fn(),
  } as never;
}

let svc: ReturnType<typeof makeService>;

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
  process.env['COGNITO_ISSUER'] = ISSUER;
  svc = makeService();
  setListSvc(svc);
  setGetSvc(svc);
  setUpdateSvc(svc);
  setImportSvc(svc);
  setTxSvc(svc);
});

// ---------------------------------------------------------------------------
// Auth / RBAC / tenant
// ---------------------------------------------------------------------------

describe('auth and RBAC', () => {
  it('returns 401 when there is no JWT (auth failure)', async () => {
    const res: any = await listHandler(makeEvent({}, { omitAuthorizer: true }), CTX);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('MISSING_TOKEN');
    expect(svc.listInventory).not.toHaveBeenCalled();
  });

  it('returns 403 when the role lacks the required permission (Support cannot update)', async () => {
    const event = makeEvent({ pathParameters: { sku: 'SKU-1' }, body: JSON.stringify({ warehouseId: 'WH-1', onHand: 5 }) }, { role: 'Support' });
    const res: any = await updateHandler(event, CTX);
    expect(res.statusCode).toBe(403);
    expect(svc.updateStock).not.toHaveBeenCalled();
  });

  it('returns 401 when tenant context is missing (JWT without custom:tenantId, Seller role)', async () => {
    // Seller is a non-bypass role, so tenantContextMiddleware requires a tenantId.
    const res: any = await listHandler(makeEvent({}, { tenantId: undefined }), CTX);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('MISSING_TENANT');
  });

  it('allows a valid Seller with tenant to read', async () => {
    svc.listInventory.mockResolvedValue({ items: [], nextToken: undefined });
    const res: any = await listHandler(makeEvent(), CTX);
    expect(res.statusCode).toBe(200);
    expect(svc.listInventory).toHaveBeenCalledWith(TENANT, {});
  });
});

// ---------------------------------------------------------------------------
// list-inventory (pagination)
// ---------------------------------------------------------------------------

describe('GET /inventory', () => {
  it('passes pagination params through to the service', async () => {
    svc.listInventory.mockResolvedValue({ items: [{ sku: 'SKU-1' }], nextToken: 'tkn' });
    const event = makeEvent({ queryStringParameters: { limit: '10', nextToken: 'abc' } });
    const res: any = await listHandler(event, CTX);
    expect(res.statusCode).toBe(200);
    expect(svc.listInventory).toHaveBeenCalledWith(TENANT, { limit: 10, nextToken: 'abc' });
    const body = JSON.parse(res.body);
    expect(body.nextToken).toBe('tkn');
  });

  it('returns 400 VALIDATION_ERROR for an invalid limit', async () => {
    const event = makeEvent({ queryStringParameters: { limit: '-5' } });
    const res: any = await listHandler(event, CTX);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// get-inventory
// ---------------------------------------------------------------------------

describe('GET /inventory/{sku}', () => {
  it('returns 200 with records', async () => {
    svc.getBySku.mockResolvedValue([{ sku: 'SKU-1', warehouseId: 'WH-1', onHand: 3 }]);
    const res: any = await getHandler(makeEvent({ pathParameters: { sku: 'SKU-1' } }), CTX);
    expect(res.statusCode).toBe(200);
    expect(svc.getBySku).toHaveBeenCalledWith(TENANT, 'SKU-1');
  });

  it('returns 404 INVENTORY_NOT_FOUND when the SKU has no records', async () => {
    svc.getBySku.mockResolvedValue([]);
    const res: any = await getHandler(makeEvent({ pathParameters: { sku: 'SKU-x' } }), CTX);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('INVENTORY_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// update-inventory (valid, invalid, unknown SKU, negative, concurrency)
// ---------------------------------------------------------------------------

describe('PUT /inventory/{sku}', () => {
  function putEvent(body: unknown, sku = 'SKU-1') {
    return makeEvent({ pathParameters: { sku }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  }

  it('returns 200 and uses the path SKU + JWT actor (valid request)', async () => {
    svc.updateStock.mockResolvedValue({ sku: 'SKU-1', warehouseId: 'WH-1', onHand: 15, reserved: 0, available: 15 });
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: 15 }), CTX);
    expect(res.statusCode).toBe(200);
    expect(svc.updateStock).toHaveBeenCalledWith(TENANT, {
      sku: 'SKU-1',
      warehouseId: 'WH-1',
      onHand: 15,
      actor: USER,
      source: 'api',
    });
  });

  it('rejects a body that tries to override sku (strict schema => 400)', async () => {
    const res: any = await updateHandler(putEvent({ sku: 'SKU-EVIL', warehouseId: 'WH-1', onHand: 5 }), CTX);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(svc.updateStock).not.toHaveBeenCalled();
  });

  it('rejects a non-integer onHand (400)', async () => {
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: 2.5 }), CTX);
    expect(res.statusCode).toBe(400);
    expect(svc.updateStock).not.toHaveBeenCalled();
  });

  it('rejects a negative onHand at the schema (400)', async () => {
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: -1 }), CTX);
    expect(res.statusCode).toBe(400);
    expect(svc.updateStock).not.toHaveBeenCalled();
  });

  it('maps unknown SKU to 404 PRODUCT_NOT_FOUND', async () => {
    svc.updateStock.mockRejectedValue(new ProductNotFoundError(TENANT, 'SKU-1'));
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: 5 }), CTX);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('maps NegativeStock to 409 INVENTORY_NEGATIVE_STOCK', async () => {
    svc.updateStock.mockRejectedValue(new NegativeStockError('SKU-1', 'WH-1', -2));
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: 0 }), CTX);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('INVENTORY_NEGATIVE_STOCK');
  });

  it('maps concurrency conflict to 409 INVENTORY_CONCURRENT_UPDATE', async () => {
    svc.updateStock.mockRejectedValue(new InventoryConcurrentUpdateError('SKU-1', 'WH-1'));
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: 9 }), CTX);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('INVENTORY_CONCURRENT_UPDATE');
  });

  it('does not leak internal error detail (generic 500)', async () => {
    svc.updateStock.mockRejectedValue(new Error('secret DynamoDB internals'));
    const res: any = await updateHandler(putEvent({ warehouseId: 'WH-1', onHand: 9 }), CTX);
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('DynamoDB');
  });
});

// ---------------------------------------------------------------------------
// list-transactions (DTO mapping txnId -> transactionId)
// ---------------------------------------------------------------------------

describe('GET /inventory/{sku}/transactions', () => {
  it('maps domain txnId to API transactionId', async () => {
    svc.listTransactions.mockResolvedValue({
      items: [{ txnId: 'txn-1', sku: 'SKU-1', warehouseId: 'WH-1', deltaQty: 5, previousQty: 0, newQty: 5, actor: USER, source: 'manual', tenantId: TENANT, timestamp: '2024-01-01T00:00:00.000Z' }],
      nextToken: undefined,
    });
    const res: any = await txHandler(makeEvent({ pathParameters: { sku: 'SKU-1' } }), CTX);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transactions[0].transactionId).toBe('txn-1');
    expect(body.transactions[0].txnId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// import-inventory (CSV success, partial, malformed, limits)
// ---------------------------------------------------------------------------

describe('POST /inventory/import', () => {
  function csvEvent(csv: string) {
    return makeEvent({ body: csv });
  }

  it('CSV success: all valid rows accepted (200 with summary)', async () => {
    svc.importCsvRows.mockResolvedValue({
      summary: { totalRows: 2, accepted: 2, rejected: 0 },
      results: [
        { rowNumber: 1, sku: 'SKU-1', warehouseId: 'WH-1', status: 'accepted', txnId: 't1' },
        { rowNumber: 2, sku: 'SKU-2', warehouseId: 'WH-1', status: 'accepted', txnId: 't2' },
      ],
    });
    const csv = 'sku,warehouseId,onHand\nSKU-1,WH-1,5\nSKU-2,WH-1,8\n';
    const res: any = await importHandler(csvEvent(csv), CTX);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary).toEqual({ totalRows: 2, accepted: 2, rejected: 0 });
    // service received 2 parsed rows
    expect(svc.importCsvRows.mock.calls[0][1]).toHaveLength(2);
  });

  it('CSV partial success: service rejects one row AND a parse-level bad row is merged', async () => {
    // Rows: 1 valid, 2 valid-but-service-rejects (unknown SKU), 3 parse error (decimal qty)
    svc.importCsvRows.mockResolvedValue({
      summary: { totalRows: 2, accepted: 1, rejected: 1 },
      results: [
        { rowNumber: 1, sku: 'SKU-1', warehouseId: 'WH-1', status: 'accepted', txnId: 't1' },
        { rowNumber: 2, sku: 'SKU-x', warehouseId: 'WH-1', status: 'rejected', error: { code: 'PRODUCT_NOT_FOUND', message: 'no' } },
      ],
    });
    const csv = 'sku,warehouseId,onHand\nSKU-1,WH-1,5\nSKU-x,WH-1,8\nSKU-1,WH-1,2.5\n';
    const res: any = await importHandler(csvEvent(csv), CTX);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // 2 service rows + 1 parse-error row = 3 total; accepted 1; rejected 2
    expect(body.summary).toEqual({ totalRows: 3, accepted: 1, rejected: 2 });
    expect(body.results).toHaveLength(3);
    // results sorted by rowNumber; row 3 is the parse-level INVALID_QUANTITY
    expect(body.results[2].rowNumber).toBe(3);
    expect(body.results[2].error.code).toBe('INVALID_QUANTITY');
    // Only the 2 well-formed rows were handed to the service
    expect(svc.importCsvRows.mock.calls[0][1]).toHaveLength(2);
  });

  it('CSV malformed header: 400 CSV_INVALID_HEADER, no rows processed', async () => {
    const csv = 'wrong,header,cols\nSKU-1,WH-1,5\n';
    const res: any = await importHandler(csvEvent(csv), CTX);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('CSV_INVALID_HEADER');
    expect(svc.importCsvRows).not.toHaveBeenCalled();
  });

  it('CSV too many rows: 400 CSV_TOO_MANY_ROWS, no rows processed', async () => {
    const lines = ['sku,warehouseId,onHand'];
    for (let i = 0; i < 1001; i++) {
      lines.push(`SKU-${i},WH-1,1`);
    }
    const res: any = await importHandler(csvEvent(lines.join('\n')), CTX);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('CSV_TOO_MANY_ROWS');
    expect(svc.importCsvRows).not.toHaveBeenCalled();
  });

  it('CSV oversized body: 413 PAYLOAD_TOO_LARGE, no rows processed', async () => {
    // Build a > 1 MB body cheaply.
    const big = 'sku,warehouseId,onHand\n' + 'SKU-1,WH-1,1\n'.repeat(90000);
    const res: any = await importHandler(csvEvent(big), CTX);
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(svc.importCsvRows).not.toHaveBeenCalled();
  });

  it('CSV ignores blank rows and accepts duplicate sku+warehouse in order', async () => {
    svc.importCsvRows.mockResolvedValue({
      summary: { totalRows: 2, accepted: 2, rejected: 0 },
      results: [
        { rowNumber: 1, sku: 'SKU-1', warehouseId: 'WH-1', status: 'accepted', txnId: 't1' },
        { rowNumber: 2, sku: 'SKU-1', warehouseId: 'WH-1', status: 'accepted', txnId: 't2' },
      ],
    });
    const csv = 'sku,warehouseId,onHand\nSKU-1,WH-1,5\n\nSKU-1,WH-1,9\n';
    const res: any = await importHandler(csvEvent(csv), CTX);
    expect(res.statusCode).toBe(200);
    // blank line ignored => 2 rows handed to the service, in order
    const rowsArg = svc.importCsvRows.mock.calls[0][1];
    expect(rowsArg).toHaveLength(2);
    expect(rowsArg[0].onHand).toBe(5);
    expect(rowsArg[1].onHand).toBe(9);
  });
});

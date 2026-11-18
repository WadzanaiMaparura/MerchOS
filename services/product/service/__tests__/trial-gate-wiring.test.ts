/**
 * Free-trial gate in the product service and AI entry points.
 * (The gate itself is tested in services/shared; this proves the wiring.)
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const reserveProductSlot = vi.fn();
const releaseProductSlot = vi.fn();
const assertCanGenerate = vi.fn();
vi.mock('../../../shared/entitlements/trial-gate', async (orig) => ({
  ...(await orig<typeof import('../../../shared/entitlements/trial-gate')>()),
  reserveProductSlot: (...a: unknown[]) => reserveProductSlot(...a),
  releaseProductSlot: (...a: unknown[]) => releaseProductSlot(...a),
  assertCanGenerate: (...a: unknown[]) => assertCanGenerate(...a),
}));

import { ProductService } from '../product-service';
import type { ProductRepository } from '../../repository/product-repository';
import { ProductPersistenceError as RepoPersistenceError } from '../../repository/errors';
import { ProductPersistenceError } from '../errors';
import { mapErrorToResponse } from '../../api/error-mapper';
import { handler as synthesize, setProductService as setSynthService } from '../../api/handlers/synthesize-product';
import { setIntelligenceCaller } from '../index';
import { TrialLimitReachedError, TrialNotActivatedError } from '../../../shared/entitlements/trial-gate';

const TENANT = 'tenant-abc';

describe('ProductService.createProduct + free-trial gate', () => {
  let repo: { findBySku: Mock; create: Mock };
  let service: ProductService;
  const input = { title: 'T', sku: 'SKU-1', brand: 'B' };

  beforeEach(() => {
    vi.clearAllMocks();
    reserveProductSlot.mockResolvedValue('reserved');
    releaseProductSlot.mockResolvedValue(undefined);
    repo = { findBySku: vi.fn().mockResolvedValue(null), create: vi.fn(async (p) => p) };
    service = new ProductService(repo as unknown as ProductRepository);
  });

  it('reserves a slot for the new product id BEFORE writing it', async () => {
    const product = await service.createProduct(TENANT, input);
    expect(reserveProductSlot).toHaveBeenCalledWith(TENANT, product.productId);
    expect(reserveProductSlot.mock.invocationCallOrder[0]!).toBeLessThan(repo.create.mock.invocationCallOrder[0]!);
    expect(releaseProductSlot).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the trial limit is reached', async () => {
    reserveProductSlot.mockRejectedValue(new TrialLimitReachedError());
    await expect(service.createProduct(TENANT, input)).rejects.toBeInstanceOf(TrialLimitReachedError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the trial was never activated', async () => {
    reserveProductSlot.mockRejectedValue(new TrialNotActivatedError());
    await expect(service.createProduct(TENANT, input)).rejects.toBeInstanceOf(TrialNotActivatedError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('does not take a slot for a duplicate SKU (rejected before the gate)', async () => {
    repo.findBySku.mockResolvedValue({ productId: 'existing' });
    await expect(service.createProduct(TENANT, input)).rejects.toThrow();
    expect(reserveProductSlot).not.toHaveBeenCalled();
  });

  it('GIVES THE SLOT BACK when the write fails: a failed upload must not use up the trial', async () => {
    repo.create.mockRejectedValue(new RepoPersistenceError('dynamo down'));
    const err = await service.createProduct(TENANT, input).catch((e) => e);
    expect(err).toBeInstanceOf(ProductPersistenceError);
    expect(releaseProductSlot).toHaveBeenCalledTimes(1);
    expect(releaseProductSlot.mock.calls[0]![1]).toBe(reserveProductSlot.mock.calls[0]![1]); // same product id
  });

  it('still reports the original failure even if releasing the slot also fails', async () => {
    repo.create.mockRejectedValue(new RepoPersistenceError('dynamo down'));
    releaseProductSlot.mockRejectedValue(new Error('release failed'));
    await expect(service.createProduct(TENANT, input)).rejects.toBeInstanceOf(ProductPersistenceError);
  });
});

describe('API error mapping', () => {
  it('maps trial errors to 402 with their code (so the dashboard can show an upgrade prompt)', () => {
    for (const [err, code] of [
      [new TrialLimitReachedError(), 'TRIAL_LIMIT_REACHED'],
      [new TrialNotActivatedError(), 'TRIAL_NOT_ACTIVATED'],
    ] as const) {
      const res = mapErrorToResponse(err);
      expect(res.statusCode).toBe(402);
      expect(JSON.parse(res.body).error.code).toBe(code);
    }
  });
  it('still collapses unknown errors to a generic 500', () => {
    expect(mapErrorToResponse(new Error('secret')).statusCode).toBe(500);
  });
});

describe('POST /products/{id}/synthesize + free-trial gate', () => {
  const PRODUCT = 'prod-001';
  const event = {
    pathParameters: { productId: PRODUCT },
    headers: { authorization: 'Bearer test-jwt' },
    requestContext: { authorizer: { jwt: { claims: { 'custom:tenantId': TENANT, sub: 'user-1' } } } },
    body: null,
  } as unknown as APIGatewayProxyEventV2;
  const dto = {
    productId: PRODUCT, tenantId: TENANT, sku: 'S', title: 'T', description: 'D', brand: 'B', attributes: {}, images: [], variants: [],
    lifecycleState: 'DRAFT', lifecycleHistory: [], enrichmentLayer: { attributes: {}, channelContent: {}, detectedLanguage: '', enrichedAt: '' },
    categoryMappings: {}, complianceReports: {}, createdAt: 'x', updatedAt: 'x',
  };
  let svc: { getProductDto: ReturnType<typeof vi.fn>; appendLifecycleTransition: ReturnType<typeof vi.fn>; applyAndPersistSynthesis: ReturnType<typeof vi.fn> };
  const generate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    svc = { getProductDto: vi.fn().mockResolvedValue(dto), appendLifecycleTransition: vi.fn().mockResolvedValue({}), applyAndPersistSynthesis: vi.fn().mockResolvedValue({}) };
    setSynthService(svc as never);
    setIntelligenceCaller({ generate } as never);
    generate.mockResolvedValue({ status: 'completed', type: 'title', content: { type: 'title', title: 'X' }, confidenceScore: 0.9, metadata: {} });
    assertCanGenerate.mockResolvedValue(undefined);
  });

  it('checks the gate for THIS product and passes productId on to the intelligence API', async () => {
    await synthesize(event);
    expect(assertCanGenerate).toHaveBeenCalledWith(TENANT, PRODUCT);
    expect(generate.mock.calls[0]![0]).toMatchObject({ productId: PRODUCT });
  });

  it('answers 402 and never leaves the product stuck in GENERATING when blocked', async () => {
    assertCanGenerate.mockRejectedValue(new TrialLimitReachedError('not part of your free trial'));
    const res = (await synthesize(event)) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error.code).toBe('TRIAL_LIMIT_REACHED');
    expect(svc.appendLifecycleTransition).not.toHaveBeenCalled(); // no GENERATING transition
    expect(generate).not.toHaveBeenCalled();
  });
});

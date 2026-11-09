import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler, setProductService } from '../handlers/synthesize-product';
import { setIntelligenceCaller, resetIntelligenceCaller } from '../../service';
import type { IntelligenceCaller } from '../../service';

const TENANT = 'tenant-abc';
const PRODUCT = 'prod-001';

function makeEvent(overrides?: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
  return {
    pathParameters: { productId: PRODUCT },
    headers: { authorization: 'Bearer test-jwt' },
    requestContext: {
      authorizer: { jwt: { claims: { 'custom:tenantId': TENANT, sub: 'user-1' } } },
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

function makeDto(lifecycleState: string) {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    sku: 'SKU-1',
    title: 'Title',
    description: 'Desc',
    brand: 'Brand',
    attributes: {},
    images: [],
    variants: [],
    lifecycleState,
    lifecycleHistory: [],
    enrichmentLayer: { attributes: {}, channelContent: {}, detectedLanguage: '', enrichedAt: '' },
    categoryMappings: {},
    complianceReports: {},
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

function createMockService() {
  return {
    getProductDto: vi.fn(),
    appendLifecycleTransition: vi.fn().mockResolvedValue({}),
    applyAndPersistSynthesis: vi.fn().mockResolvedValue({}),
  };
}

let mockService: ReturnType<typeof createMockService>;

beforeEach(() => {
  mockService = createMockService();
  setProductService(mockService as never);
  resetIntelligenceCaller();
});

describe('POST /products/{id}/synthesize', () => {
  it('returns 401 without tenant context', async () => {
    const event = makeEvent({ requestContext: { authorizer: {} } as never });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 400 when productId is missing', async () => {
    const event = makeEvent({ pathParameters: {} });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 401 when the bearer token is missing', async () => {
    const event = makeEvent({ headers: {} });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it('happy path: DRAFT → GENERATING → REVIEW and returns the updated product', async () => {
    // getProductDto called twice: first (DRAFT), last (REVIEW).
    mockService.getProductDto
      .mockResolvedValueOnce(makeDto('DRAFT'))
      .mockResolvedValueOnce(makeDto('REVIEW'));

    const caller: IntelligenceCaller = {
      generate: vi.fn().mockResolvedValue({
        type: 'title',
        status: 'completed',
        confidenceScore: 0.9,
        content: { type: 'title', title: 'Generated' },
      }),
    };
    setIntelligenceCaller(caller);

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.product.lifecycleState).toBe('REVIEW');
    // GENERATING transition recorded, then applyAndPersistSynthesis to REVIEW.
    expect(mockService.appendLifecycleTransition).toHaveBeenCalledWith(
      TENANT,
      PRODUCT,
      expect.objectContaining({ toState: 'GENERATING' }),
      'GENERATING'
    );
    expect(mockService.applyAndPersistSynthesis).toHaveBeenCalledWith(
      TENANT,
      PRODUCT,
      expect.any(Array),
      'REVIEW',
      expect.any(Array)
    );
  });

  it('reverts to DRAFT and returns 502 when the engine yields no results', async () => {
    mockService.getProductDto.mockResolvedValue(makeDto('DRAFT'));
    const caller: IntelligenceCaller = {
      generate: vi.fn().mockResolvedValue(null),
    };
    setIntelligenceCaller(caller);

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body as string).error.code).toBe('SYNTHESIS_FAILED');
    expect(mockService.appendLifecycleTransition).toHaveBeenCalledWith(
      TENANT,
      PRODUCT,
      expect.objectContaining({ toState: 'DRAFT', reason: expect.any(String) }),
      'DRAFT'
    );
    expect(mockService.applyAndPersistSynthesis).not.toHaveBeenCalled();
  });

  it('rejects synthesizing from a non-transitionable state (e.g. PUBLISHED)', async () => {
    mockService.getProductDto.mockResolvedValue(makeDto('PUBLISHED'));
    const result = await handler(makeEvent());
    // assertTransition PUBLISHED → GENERATING throws INVALID_PRODUCT_LIFECYCLE → 409
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error.code).toBe('INVALID_PRODUCT_LIFECYCLE');
    expect(mockService.appendLifecycleTransition).not.toHaveBeenCalled();
  });

  it('marks partial=true when some types fail but at least one succeeds', async () => {
    mockService.getProductDto
      .mockResolvedValueOnce(makeDto('DRAFT'))
      .mockResolvedValueOnce(makeDto('REVIEW'));
    let call = 0;
    const caller: IntelligenceCaller = {
      generate: vi.fn().mockImplementation(() => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? { type: 'title', status: 'completed', confidenceScore: 0.9, content: { type: 'title', title: 'T' } }
            : null
        );
      }),
    };
    setIntelligenceCaller(caller);

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).partial).toBe(true);
  });
});

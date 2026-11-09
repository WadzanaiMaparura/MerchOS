/**
 * Unit tests for the ProductRepository enrichment methods (#ENRICHMENT item):
 * getEnrichment / putEnrichment / appendLifecycleTransition.
 *
 * Uses aws-sdk-client-mock to mock DynamoDBDocumentClient commands.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { LifecycleTransition } from '@merch-os/types';
import { ProductRepository } from '../product-repository';
import { ProductNotFoundError } from '../errors';
import type { ProductEnrichmentRecord } from '../types';

const ddbMock = mockClient(DynamoDBDocumentClient);

function createRepo(): ProductRepository {
  return ProductRepository.fromDocClient(
    ddbMock as unknown as DynamoDBDocumentClient
  );
}

const TENANT = 'tenant-abc';
const PRODUCT = 'prod-001';

function makeRecord(): Omit<ProductEnrichmentRecord, 'updatedAt'> {
  return {
    uiLifecycleState: 'REVIEW',
    enrichment: {
      attributes: {
        title: {
          value: 'AI title',
          confidence: 0.9,
          source: 'bedrock',
          flaggedForReview: false,
        },
      },
      channelContent: {},
      detectedLanguage: 'en',
      enrichedAt: '2026-11-02T10:00:00.000Z',
    },
    lifecycleHistory: [],
  };
}

beforeEach(() => {
  ddbMock.reset();
});

describe('ProductRepository.getEnrichment', () => {
  it('returns null when no enrichment item exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const repo = createRepo();
    const result = await repo.getEnrichment(TENANT, PRODUCT);
    expect(result).toBeNull();
  });

  it('reads the enrichment record, stripping PK/SK', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: `TENANT#${TENANT}`,
        SK: `PRODUCT#${PRODUCT}#ENRICHMENT`,
        ...makeRecord(),
        updatedAt: '2026-11-02T10:00:00.000Z',
      },
    });
    const repo = createRepo();
    const result = await repo.getEnrichment(TENANT, PRODUCT);
    expect(result).not.toBeNull();
    expect(result?.uiLifecycleState).toBe('REVIEW');
    expect((result as Record<string, unknown>).PK).toBeUndefined();
    expect((result as Record<string, unknown>).SK).toBeUndefined();
  });

  it('queries the correct tenant-scoped #ENRICHMENT key', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const repo = createRepo();
    await repo.getEnrichment(TENANT, PRODUCT);
    const call = ddbMock.commandCalls(GetCommand)[0];
    expect(call?.args[0].input.Key).toEqual({
      PK: `TENANT#${TENANT}`,
      SK: `PRODUCT#${PRODUCT}#ENRICHMENT`,
    });
  });
});

describe('ProductRepository.putEnrichment', () => {
  it('writes the record with a refreshed updatedAt and correct keys', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = createRepo();
    const before = Date.now();
    const result = await repo.putEnrichment(TENANT, PRODUCT, makeRecord());

    expect(result.updatedAt).toBeDefined();
    expect(new Date(result.updatedAt).getTime()).toBeGreaterThanOrEqual(before);

    const call = ddbMock.commandCalls(PutCommand)[0];
    const item = call?.args[0].input.Item as Record<string, unknown>;
    expect(item.PK).toBe(`TENANT#${TENANT}`);
    expect(item.SK).toBe(`PRODUCT#${PRODUCT}#ENRICHMENT`);
    expect(item.uiLifecycleState).toBe('REVIEW');
  });

  it('maps a cross-tenant conditional failure to ProductNotFoundError', async () => {
    const err = new Error('conditional');
    err.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejects(err);
    const repo = createRepo();
    await expect(repo.putEnrichment(TENANT, PRODUCT, makeRecord())).rejects.toBeInstanceOf(
      ProductNotFoundError
    );
  });
});

describe('ProductRepository.appendLifecycleTransition', () => {
  const transition: LifecycleTransition = {
    fromState: 'DRAFT',
    toState: 'GENERATING',
    transitionedAt: '2026-11-02T10:00:00.000Z',
    actor: 'user-1',
  };

  it('creates an enrichment record with the transition when none exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    const repo = createRepo();

    const result = await repo.appendLifecycleTransition(
      TENANT,
      PRODUCT,
      transition,
      'GENERATING'
    );

    expect(result.uiLifecycleState).toBe('GENERATING');
    expect(result.lifecycleHistory).toHaveLength(1);
    expect(result.lifecycleHistory[0]).toEqual(transition);
    // empty enrichment layer seeded
    expect(result.enrichment.attributes).toEqual({});
  });

  it('appends to existing history preserving prior transitions', async () => {
    const prior: LifecycleTransition = {
      fromState: 'GENERATING',
      toState: 'REVIEW',
      transitionedAt: '2026-11-02T11:00:00.000Z',
      actor: 'system',
    };
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: `TENANT#${TENANT}`,
        SK: `PRODUCT#${PRODUCT}#ENRICHMENT`,
        uiLifecycleState: 'REVIEW',
        enrichment: {
          attributes: {},
          channelContent: {},
          detectedLanguage: 'en',
          enrichedAt: '2026-11-02T10:05:00.000Z',
        },
        lifecycleHistory: [prior],
        updatedAt: '2026-11-02T11:00:00.000Z',
      },
    });
    ddbMock.on(PutCommand).resolves({});
    const repo = createRepo();

    const result = await repo.appendLifecycleTransition(
      TENANT,
      PRODUCT,
      transition,
      'DRAFT'
    );

    expect(result.lifecycleHistory).toHaveLength(2);
    expect(result.lifecycleHistory[0]).toEqual(prior);
    expect(result.lifecycleHistory[1]).toEqual(transition);
    expect(result.uiLifecycleState).toBe('DRAFT');
  });
});

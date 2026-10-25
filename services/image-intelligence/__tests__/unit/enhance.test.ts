/**
 * Unit tests for the enhance processor and model adapter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { shouldEnhance, enhanceHero, setS3Client } from '../../processors/enhance';
import {
  getEnhancementModelId,
  isEnhancementEnabled,
  setBedrockClient,
  DEFAULT_ENHANCEMENT_MODEL_ID,
} from '../../services/enhancement-model';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('enhancement-model config', () => {
  it('defaults to Stable Image Inpaint when no model id is configured', () => {
    delete process.env['IMAGE_ENHANCEMENT_MODEL_ID'];
    expect(getEnhancementModelId()).toBe(DEFAULT_ENHANCEMENT_MODEL_ID);
    expect(DEFAULT_ENHANCEMENT_MODEL_ID).toContain('stable-image-inpaint');
  });

  it('resolves the model id from config when set (pluggable)', () => {
    process.env['IMAGE_ENHANCEMENT_MODEL_ID'] = 'some.other-model:1';
    expect(getEnhancementModelId()).toBe('some.other-model:1');
  });

  it('is disabled unless the feature flag is exactly true', () => {
    delete process.env['IMAGE_ENHANCEMENT_ENABLED'];
    expect(isEnhancementEnabled()).toBe(false);
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'true';
    expect(isEnhancementEnabled()).toBe(true);
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'TRUE';
    expect(isEnhancementEnabled()).toBe(true);
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'yes';
    expect(isEnhancementEnabled()).toBe(false);
  });
});

describe('shouldEnhance', () => {
  it('only enhances weak photos when the feature is enabled', () => {
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'true';
    expect(shouldEnhance(true)).toBe(true);
    expect(shouldEnhance(false)).toBe(false);
  });

  it('never enhances when the feature is disabled', () => {
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'false';
    expect(shouldEnhance(true)).toBe(false);
  });
});

describe('enhanceHero', () => {
  it('skips (not attempted) when the photo is not weak', async () => {
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'true';
    const result = await enhanceHero({ bucket: 'assets', heroKey: 'k', weak: false });
    expect(result).toEqual({ attempted: false, applied: false, skippedReason: 'photo-not-weak' });
  });

  it('skips when the feature is disabled', async () => {
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'false';
    const result = await enhanceHero({ bucket: 'assets', heroKey: 'k', weak: true });
    expect(result).toEqual({
      attempted: false,
      applied: false,
      skippedReason: 'enhancement-disabled',
    });
  });

  it('falls back (applied=false) without throwing when the model call fails', async () => {
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'true';
    // S3 get returns a readable body; Bedrock throws.
    setS3Client({
      send: vi.fn().mockResolvedValue({
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      }),
    } as unknown as S3Client);
    setBedrockClient({
      send: vi.fn().mockRejectedValue(new Error('model unavailable')),
    } as unknown as BedrockRuntimeClient);

    const result = await enhanceHero({ bucket: 'assets', heroKey: 'k', weak: true });
    expect(result.attempted).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.skippedReason).toContain('enhancement-failed');
  });

  it('applies the enhanced image on success', async () => {
    process.env['IMAGE_ENHANCEMENT_ENABLED'] = 'true';
    const putSpy = vi.fn().mockResolvedValue({});
    const s3Send = vi
      .fn()
      // first call: GetObject (read source); second: PutObject (write enhanced)
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      })
      .mockImplementationOnce((cmd: unknown) => putSpy(cmd));
    setS3Client({ send: s3Send } as unknown as S3Client);

    const enhancedBase64 = Buffer.from([9, 9, 9]).toString('base64');
    setBedrockClient({
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ images: [enhancedBase64] })),
      }),
    } as unknown as BedrockRuntimeClient);

    const result = await enhanceHero({ bucket: 'assets', heroKey: 'k', weak: true });
    expect(result).toEqual({ attempted: true, applied: true });
    expect(putSpy).toHaveBeenCalledTimes(1);
  });
});

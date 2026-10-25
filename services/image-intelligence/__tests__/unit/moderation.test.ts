/**
 * Unit tests for the moderation processor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import {
  moderateImage,
  setRekognitionClient,
  MODERATION_CONFIDENCE_THRESHOLD,
} from '../../processors/moderation';

describe('moderateImage', () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    setRekognitionClient({ send: sendSpy } as unknown as RekognitionClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when no moderation labels are returned', async () => {
    sendSpy.mockResolvedValueOnce({ ModerationLabels: [] });
    const result = await moderateImage({ bucket: 'b', key: 'k' });
    expect(result).toEqual({ passed: true });
  });

  it('rejects when a disallowed label meets the confidence threshold', async () => {
    sendSpy.mockResolvedValueOnce({
      ModerationLabels: [
        { Name: 'Graphic Violence', ParentName: 'Violence', Confidence: 95 },
      ],
    });
    const result = await moderateImage({ bucket: 'b', key: 'k' });
    expect(result.passed).toBe(false);
    expect(result.rejectedLabels).toContain('Violence');
  });

  it('matches a top-level disallowed label with no parent', async () => {
    sendSpy.mockResolvedValueOnce({
      ModerationLabels: [{ Name: 'Violence', ParentName: '', Confidence: 88 }],
    });
    const result = await moderateImage({ bucket: 'b', key: 'k' });
    expect(result.passed).toBe(false);
    expect(result.rejectedLabels).toEqual(['Violence']);
  });

  it('passes when a disallowed label is below the threshold', async () => {
    sendSpy.mockResolvedValueOnce({
      ModerationLabels: [
        { Name: 'Violence', ParentName: 'Violence', Confidence: MODERATION_CONFIDENCE_THRESHOLD - 1 },
      ],
    });
    const result = await moderateImage({ bucket: 'b', key: 'k' });
    expect(result).toEqual({ passed: true });
  });

  it('ignores labels not in the disallowed set', async () => {
    sendSpy.mockResolvedValueOnce({
      ModerationLabels: [{ Name: 'Rude Gestures', ParentName: 'Rude Gestures', Confidence: 99 }],
    });
    const result = await moderateImage({ bucket: 'b', key: 'k' });
    expect(result).toEqual({ passed: true });
  });

  it('de-duplicates repeated category names', async () => {
    sendSpy.mockResolvedValueOnce({
      ModerationLabels: [
        { Name: 'Exposed Breast', ParentName: 'Nudity', Confidence: 97 },
        { Name: 'Exposed Buttocks', ParentName: 'Nudity', Confidence: 91 },
      ],
    });
    const result = await moderateImage({ bucket: 'b', key: 'k' });
    expect(result.passed).toBe(false);
    expect(result.rejectedLabels).toEqual(['Nudity']);
  });
});

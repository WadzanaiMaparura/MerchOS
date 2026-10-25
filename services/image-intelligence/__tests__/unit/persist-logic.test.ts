/**
 * Unit tests for persist pure logic — buildImageRefs canonical shape.
 */
import { describe, it, expect } from 'vitest';
import { buildImageRefs } from '../../processors/persist';
import type { ImageVariant } from '../../types/image.types';

describe('buildImageRefs', () => {
  const variants: ImageVariant[] = [
    { channel: 'takealot', s3Key: 'images/t/p/takealot/1000x1000.jpg', width: 1000, height: 1000, upscaled: false },
    { channel: 'amazon', s3Key: 'images/t/p/amazon/1600x1600.jpg', width: 1600, height: 1600, upscaled: true },
  ];

  it('places the hero at position 0 with null variantId', () => {
    const refs = buildImageRefs('images/t/p/hero.jpg', 2000, variants);
    expect(refs[0]?.position).toBe(0);
    expect(refs[0]?.s3Key).toBe('images/t/p/hero.jpg');
    expect(refs[0]?.variantId).toBeNull();
    expect(refs[0]?.width).toBe(2000);
  });

  it('appends one ref per variant with incrementing positions and channel variantId', () => {
    const refs = buildImageRefs('images/t/p/hero.jpg', 2000, variants);
    expect(refs).toHaveLength(3); // hero + 2 variants
    expect(refs[1]?.position).toBe(1);
    expect(refs[1]?.variantId).toBe('takealot');
    expect(refs[2]?.position).toBe(2);
    expect(refs[2]?.variantId).toBe('amazon');
  });

  it('produces canonical CanonicalImageRef fields (mimeType jpeg, nullable altText)', () => {
    const refs = buildImageRefs('images/t/p/hero.jpg', 2000, []);
    expect(refs[0]?.mimeType).toBe('image/jpeg');
    expect(refs[0]?.altText).toBeNull();
    expect(typeof refs[0]?.imageId).toBe('string');
  });

  it('assigns unique imageIds per ref', () => {
    const refs = buildImageRefs('images/t/p/hero.jpg', 2000, variants);
    const ids = new Set(refs.map((r) => r.imageId));
    expect(ids.size).toBe(refs.length);
  });
});

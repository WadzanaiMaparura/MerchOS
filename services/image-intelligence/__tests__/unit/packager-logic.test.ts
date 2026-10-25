/**
 * Unit tests for packager pure logic (no Sharp / AWS needed).
 */
import { describe, it, expect } from 'vitest';
import {
  CHANNEL_SPECS,
  CUSTOM_CHANNEL_SPEC,
  ALL_CHANNEL_SPECS,
  isUpscaleRequired,
} from '../../utils/channel-specs';

describe('channel specs', () => {
  it('defines the required minimum resolutions', () => {
    expect(CHANNEL_SPECS.takealot.width).toBe(1000);
    expect(CHANNEL_SPECS.amazon.width).toBe(1600);
    expect(CHANNEL_SPECS.makro.width).toBe(800);
    expect(CHANNEL_SPECS.shopify.width).toBe(2048);
    expect(CHANNEL_SPECS.woocommerce.width).toBe(800);
    expect(CUSTOM_CHANNEL_SPEC.width).toBe(1200);
  });

  it('includes all six channels in ALL_CHANNEL_SPECS', () => {
    const channels = ALL_CHANNEL_SPECS.map((s) => s.channel).sort();
    expect(channels).toEqual(
      ['amazon', 'custom', 'makro', 'shopify', 'takealot', 'woocommerce'],
    );
  });
});

describe('isUpscaleRequired', () => {
  it('flags upscale when source edge is below the channel minimum', () => {
    expect(isUpscaleRequired(500, CHANNEL_SPECS.amazon)).toBe(true); // 500 < 1600
  });

  it('does not flag upscale when source edge meets/exceeds the minimum', () => {
    expect(isUpscaleRequired(1600, CHANNEL_SPECS.amazon)).toBe(false);
    expect(isUpscaleRequired(2000, CHANNEL_SPECS.makro)).toBe(false);
  });

  it('is evaluated per channel for the same source', () => {
    // A 1000px source is enough for Makro (800) but not Amazon (1600).
    expect(isUpscaleRequired(1000, CHANNEL_SPECS.makro)).toBe(false);
    expect(isUpscaleRequired(1000, CHANNEL_SPECS.amazon)).toBe(true);
  });
});

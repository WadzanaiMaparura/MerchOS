/**
 * Per-channel image specifications for the Image Intelligence Engine.
 *
 * Minimum square resolutions per marketplace (requirement 4.2). The packager
 * resizes/crops the hero to each channel's dimensions and upscales (bicubic)
 * when the source is below the minimum, flagging the result as `upscaled`.
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import type { ChannelId } from '@merch-os/types';

/** A single channel's output dimensions. */
export interface ChannelSpec {
  channel: ChannelId;
  width: number;
  height: number;
}

/**
 * Minimum square resolutions per channel (platform spec §5, requirement 4.2).
 * All are square; aspect ratio is preserved with white padding during resize.
 */
export const CHANNEL_SPECS: Readonly<Record<Exclude<ChannelId, 'custom'>, ChannelSpec>> = {
  takealot: { channel: 'takealot', width: 1000, height: 1000 },
  amazon: { channel: 'amazon', width: 1600, height: 1600 },
  makro: { channel: 'makro', width: 800, height: 800 },
  shopify: { channel: 'shopify', width: 2048, height: 2048 },
  woocommerce: { channel: 'woocommerce', width: 800, height: 800 },
};

/** The `custom` channel default (requirement 4; platform spec §5). */
export const CUSTOM_CHANNEL_SPEC: ChannelSpec = {
  channel: 'custom',
  width: 1200,
  height: 1200,
};

/** All channel specs the packager produces by default. */
export const ALL_CHANNEL_SPECS: readonly ChannelSpec[] = [
  ...Object.values(CHANNEL_SPECS),
  CUSTOM_CHANNEL_SPEC,
];

/**
 * Decide whether a source of `sourceEdge` px (longest edge) must be upscaled to
 * reach a channel's required dimension. Pure function — no image library needed.
 */
export function isUpscaleRequired(sourceEdge: number, spec: ChannelSpec): boolean {
  return sourceEdge < spec.width;
}

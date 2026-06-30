/**
 * Export-related DTOs for the MerchOS frontend.
 */

import { ChannelId } from './common';

/** Summary representation of an export operation. */
export interface ExportSummary {
  exportId: string;
  channelId: ChannelId;
  exportDate: string; // ISO 8601
  productCount: number;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  downloadUrl?: string; // Signed S3 URL (generated on demand)
}

/** Payload to trigger a new export for a channel. */
export interface TriggerExportPayload {
  channelId: ChannelId;
}

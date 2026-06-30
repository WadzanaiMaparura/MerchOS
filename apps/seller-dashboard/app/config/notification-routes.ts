/**
 * Notification Navigation Routing
 *
 * Maps notification event types to their corresponding navigation paths.
 * When a user clicks a notification, they are navigated to the relevant page.
 *
 * Validates: Requirement 12.3
 *
 * Routing rules:
 * - Product events (product.*, compliance.*, listing.*, ingestion.*, image.*) → Product detail page
 * - Inventory events (inventory.*) → Inventory page
 * - Billing events (billing.*) → Billing page
 * - Channel events (taxonomy.*) → Channels page
 */

import type { EventType, Notification } from '@merch-os/types';

/**
 * Event type category prefixes and their corresponding route destinations.
 */
const EVENT_ROUTE_MAP: { prefix: string; getPath: (resourceId?: string) => string }[] = [
  // Product lifecycle events → product detail page
  { prefix: 'product.', getPath: (resourceId) => resourceId ? `/products/${resourceId}` : '/products' },
  // Compliance events → product detail page
  { prefix: 'compliance.', getPath: (resourceId) => resourceId ? `/products/${resourceId}` : '/products' },
  // Listing events → product detail page
  { prefix: 'listing.', getPath: (resourceId) => resourceId ? `/products/${resourceId}` : '/products' },
  // Ingestion events → product detail page
  { prefix: 'ingestion.', getPath: (resourceId) => resourceId ? `/products/${resourceId}` : '/products' },
  // Image events → product detail page
  { prefix: 'image.', getPath: (resourceId) => resourceId ? `/products/${resourceId}` : '/products' },
  // Inventory events → inventory page
  { prefix: 'inventory.', getPath: () => '/inventory' },
  // Billing events → billing page
  { prefix: 'billing.', getPath: () => '/billing' },
  // Channel/taxonomy events → channels page
  { prefix: 'taxonomy.', getPath: () => '/settings/channels' },
  // Tenant events → dashboard (no specific detail page)
  { prefix: 'tenant.', getPath: () => '/dashboard' },
];

/**
 * Get the navigation path for a notification based on its event type.
 * Returns the path to navigate to when a notification is clicked.
 */
export function getNotificationNavigationPath(notification: Notification): string {
  const eventType: EventType = notification.type;

  for (const mapping of EVENT_ROUTE_MAP) {
    if (eventType.startsWith(mapping.prefix)) {
      return mapping.getPath(notification.resourceId);
    }
  }

  // Default: navigate to dashboard if event type is unrecognized
  return '/dashboard';
}

/**
 * Determine if a notification is navigable (has a meaningful destination).
 */
export function isNotificationNavigable(notification: Notification): boolean {
  const path = getNotificationNavigationPath(notification);
  return path !== '/dashboard' || notification.type.startsWith('tenant.');
}

/**
 * Lifecycle reconciliation for products.
 *
 * MerchOS has two lifecycle vocabularies:
 *
 *  - The DTO / UI / API contract `LifecycleState` (packages/types/src/common.ts):
 *      DRAFT | GENERATING | INGESTED | ENRICHED | REVIEW | VALIDATED |
 *      EXPORT_READY | PUBLISHED | ARCHIVED
 *    This is the single EXTERNAL contract. It is what the dashboard shows and
 *    what the API accepts/returns.
 *
 *  - The canonical domain model's simplified subset
 *    (`CanonicalProduct.lifecycleState` in packages/types/src/marketplace.ts):
 *      draft | ready | validated | exported | archived
 *    This drives export-pipeline logic only.
 *
 * The mapping from DTO → canonical is lossy (several DTO states collapse to one
 * canonical state), so the PRECISE DTO state is persisted separately as
 * `uiLifecycleState` (see Task 4). This module is the single place that
 * translates between the two vocabularies and enforces the allowed-transition
 * rules — never duplicate these rules elsewhere.
 */

import type { LifecycleState } from '@merch-os/types';
import { InvalidProductLifecycleError } from './errors';

/** The canonical domain model's simplified lifecycle subset. */
export type CanonicalLifecycle =
  | 'draft'
  | 'ready'
  | 'validated'
  | 'exported'
  | 'archived';

// ─── DTO ↔ canonical mapping ─────────────────────────────────────────────────

/**
 * Maps a DTO LifecycleState to the canonical simplified subset.
 *
 * The mapping is intentionally lossy:
 *   DRAFT, GENERATING, INGESTED → draft
 *   ENRICHED, REVIEW            → ready
 *   VALIDATED, EXPORT_READY     → validated
 *   PUBLISHED                   → exported
 *   ARCHIVED                    → archived
 */
export function toCanonical(state: LifecycleState): CanonicalLifecycle {
  switch (state) {
    case 'DRAFT':
    case 'GENERATING':
    case 'INGESTED':
      return 'draft';
    case 'ENRICHED':
    case 'REVIEW':
      return 'ready';
    case 'VALIDATED':
    case 'EXPORT_READY':
      return 'validated';
    case 'PUBLISHED':
      return 'exported';
    case 'ARCHIVED':
      return 'archived';
  }
}

/**
 * Maps a canonical lifecycle value to a DTO LifecycleState.
 *
 * Because DTO → canonical is lossy, this reverse mapping returns the most
 * representative DTO state for each canonical value. It is ONLY a fallback for
 * legacy/records that have no stored `uiLifecycleState`; the precise DTO state
 * should always be read from `uiLifecycleState` when present (Task 4).
 */
export function toDto(canonical: CanonicalLifecycle): LifecycleState {
  switch (canonical) {
    case 'draft':
      return 'DRAFT';
    case 'ready':
      return 'REVIEW';
    case 'validated':
      return 'EXPORT_READY';
    case 'exported':
      return 'PUBLISHED';
    case 'archived':
      return 'ARCHIVED';
  }
}

// ─── Allowed transitions ─────────────────────────────────────────────────────

/**
 * Allowed DTO lifecycle transitions.
 *
 * Forward path:  DRAFT → GENERATING → REVIEW → EXPORT_READY → PUBLISHED
 * Recovery:      GENERATING → DRAFT (synthesis failed), REVIEW → DRAFT (re-edit),
 *                EXPORT_READY → REVIEW (changed mind after generating a file)
 * Terminal:      any state → ARCHIVED
 *
 * NOTE: the transition into EXPORT_READY is additionally gated at the service
 * layer (Task 6) — all review flags cleared, category confirmed, and marketplace
 * validation passing. This table expresses which transitions are STRUCTURALLY
 * legal; the extra gate is an additional runtime check on top.
 *
 * INGESTED / ENRICHED / VALIDATED remain in the enum for compatibility and are
 * reachable only via ARCHIVED here (they are not part of the synthesis path).
 */
export const ALLOWED_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  DRAFT: ['GENERATING', 'ARCHIVED'],
  GENERATING: ['REVIEW', 'DRAFT', 'ARCHIVED'],
  INGESTED: ['DRAFT', 'ARCHIVED'],
  ENRICHED: ['REVIEW', 'DRAFT', 'ARCHIVED'],
  REVIEW: ['EXPORT_READY', 'DRAFT', 'ARCHIVED'],
  VALIDATED: ['EXPORT_READY', 'REVIEW', 'ARCHIVED'],
  EXPORT_READY: ['PUBLISHED', 'REVIEW', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

/**
 * Returns true if transitioning from `from` to `to` is structurally allowed.
 * A no-op transition (from === to) is treated as allowed (idempotent).
 */
export function isTransitionAllowed(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Asserts a transition is allowed, throwing InvalidProductLifecycleError
 * (code INVALID_PRODUCT_LIFECYCLE) with a clear message if not.
 */
export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!isTransitionAllowed(from, to)) {
    throw new InvalidProductLifecycleError(
      `Invalid lifecycle transition: ${from} → ${to}. Allowed from ${from}: ` +
        `${ALLOWED_TRANSITIONS[from].join(', ') || '(none)'}.`
    );
  }
}

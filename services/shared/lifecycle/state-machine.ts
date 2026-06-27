/**
 * Product lifecycle state machine for the MerchOS platform.
 *
 * Defines valid state transitions and enforces the state machine graph:
 * DRAFT → INGESTED → ENRICHED → REVIEW → VALIDATED → EXPORT_READY → PUBLISHED → ARCHIVED
 * Plus backward edge: any state → REVIEW (on tenant attribute edit).
 *
 * Requirements: 19.1, 19.3
 */

import { LifecycleState, LifecycleTransition } from '../types';

// ---------------------------------------------------------------------------
// Valid transitions graph
// ---------------------------------------------------------------------------

/**
 * Forward transitions in the product lifecycle.
 * Each key maps to the set of states it can transition TO.
 */
const FORWARD_TRANSITIONS: Record<LifecycleState, ReadonlySet<LifecycleState>> = {
  DRAFT: new Set(['INGESTED']),
  INGESTED: new Set(['ENRICHED']),
  ENRICHED: new Set(['REVIEW']),
  REVIEW: new Set(['VALIDATED']),
  VALIDATED: new Set(['EXPORT_READY']),
  EXPORT_READY: new Set(['PUBLISHED']),
  PUBLISHED: new Set(['ARCHIVED']),
  ARCHIVED: new Set([]),
};

/**
 * States from which a backward transition to REVIEW is permitted.
 * This occurs when a tenant edits a previously validated attribute.
 */
const CAN_REVERT_TO_REVIEW: ReadonlySet<LifecycleState> = new Set([
  'VALIDATED',
  'EXPORT_READY',
  'PUBLISHED',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an invalid lifecycle state transition is attempted.
 */
export class InvalidTransitionError extends Error {
  public readonly code = 'INVALID_LIFECYCLE_TRANSITION';
  public readonly fromState: LifecycleState;
  public readonly toState: LifecycleState;

  constructor(fromState: LifecycleState, toState: LifecycleState) {
    super(
      `Invalid lifecycle transition: ${fromState} → ${toState} is not permitted`
    );
    this.name = 'InvalidTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}

// ---------------------------------------------------------------------------
// State machine logic
// ---------------------------------------------------------------------------

/**
 * Check whether a transition from `fromState` to `toState` is valid
 * according to the lifecycle state machine rules.
 *
 * Valid transitions include:
 * - Any forward transition as defined in the state graph
 * - Backward transition to REVIEW from VALIDATED, EXPORT_READY, or PUBLISHED
 */
export function isValidTransition(
  fromState: LifecycleState,
  toState: LifecycleState
): boolean {
  // Forward transition
  const forwardTargets = FORWARD_TRANSITIONS[fromState];
  if (forwardTargets.has(toState)) {
    return true;
  }

  // Backward transition to REVIEW (on attribute edit)
  if (toState === 'REVIEW' && CAN_REVERT_TO_REVIEW.has(fromState)) {
    return true;
  }

  return false;
}

/**
 * Attempt a lifecycle state transition. Returns the transition record
 * on success, or throws InvalidTransitionError if the transition is not
 * permitted by the state machine.
 *
 * @param fromState - Current lifecycle state of the product
 * @param toState - Desired target state
 * @param actor - Identifier of who triggered the transition (user ID or 'system')
 * @param reason - Optional reason for the transition
 * @returns The LifecycleTransition record to be stored in the product's history
 * @throws InvalidTransitionError if the transition is not valid
 */
export function transition(
  fromState: LifecycleState,
  toState: LifecycleState,
  actor: string,
  reason?: string
): LifecycleTransition {
  if (!isValidTransition(fromState, toState)) {
    throw new InvalidTransitionError(fromState, toState);
  }

  return {
    fromState,
    toState,
    transitionedAt: new Date().toISOString(),
    actor,
    reason,
  };
}

/**
 * Get all valid target states from a given state.
 * Useful for displaying available actions in the Seller Dashboard.
 */
export function getValidTargets(fromState: LifecycleState): LifecycleState[] {
  const targets: LifecycleState[] = [];

  // Forward transitions
  const forwardTargets = FORWARD_TRANSITIONS[fromState];
  for (const target of forwardTargets) {
    targets.push(target);
  }

  // Backward to REVIEW
  if (CAN_REVERT_TO_REVIEW.has(fromState) && fromState !== 'REVIEW') {
    targets.push('REVIEW');
  }

  return targets;
}

/**
 * All lifecycle states in order of the forward progression.
 */
export const LIFECYCLE_ORDER: readonly LifecycleState[] = [
  'DRAFT',
  'INGESTED',
  'ENRICHED',
  'REVIEW',
  'VALIDATED',
  'EXPORT_READY',
  'PUBLISHED',
  'ARCHIVED',
] as const;

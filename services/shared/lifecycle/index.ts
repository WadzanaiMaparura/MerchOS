/**
 * MerchOS Lifecycle module — barrel export
 */

export {
  isValidTransition,
  transition,
  getValidTargets,
  InvalidTransitionError,
  LIFECYCLE_ORDER,
} from './state-machine';

import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  transition,
  getValidTargets,
  InvalidTransitionError,
  LIFECYCLE_ORDER,
} from '../state-machine';
import { LifecycleState } from '../../types';

describe('Lifecycle State Machine', () => {
  describe('isValidTransition', () => {
    it('permits all forward transitions in sequence', () => {
      const pairs: [LifecycleState, LifecycleState][] = [
        ['DRAFT', 'INGESTED'],
        ['INGESTED', 'ENRICHED'],
        ['ENRICHED', 'REVIEW'],
        ['REVIEW', 'VALIDATED'],
        ['VALIDATED', 'EXPORT_READY'],
        ['EXPORT_READY', 'PUBLISHED'],
        ['PUBLISHED', 'ARCHIVED'],
      ];

      for (const [from, to] of pairs) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it('permits backward transition to REVIEW from VALIDATED, EXPORT_READY, PUBLISHED', () => {
      expect(isValidTransition('VALIDATED', 'REVIEW')).toBe(true);
      expect(isValidTransition('EXPORT_READY', 'REVIEW')).toBe(true);
      expect(isValidTransition('PUBLISHED', 'REVIEW')).toBe(true);
    });

    it('rejects skipping states (DRAFT → ENRICHED)', () => {
      expect(isValidTransition('DRAFT', 'ENRICHED')).toBe(false);
    });

    it('rejects going backward other than to REVIEW', () => {
      expect(isValidTransition('PUBLISHED', 'VALIDATED')).toBe(false);
      expect(isValidTransition('ENRICHED', 'DRAFT')).toBe(false);
    });

    it('rejects transition from ARCHIVED', () => {
      for (const state of LIFECYCLE_ORDER) {
        if (state !== 'ARCHIVED') {
          expect(isValidTransition('ARCHIVED', state)).toBe(false);
        }
      }
    });

    it('rejects DRAFT → PUBLISHED (skip)', () => {
      expect(isValidTransition('DRAFT', 'PUBLISHED')).toBe(false);
    });

    it('rejects backward to REVIEW from DRAFT, INGESTED, ENRICHED', () => {
      expect(isValidTransition('DRAFT', 'REVIEW')).toBe(false);
      expect(isValidTransition('INGESTED', 'REVIEW')).toBe(false);
      // ENRICHED → REVIEW is a forward transition, so it IS valid
      expect(isValidTransition('ENRICHED', 'REVIEW')).toBe(true);
    });
  });

  describe('transition()', () => {
    it('returns a LifecycleTransition record on success', () => {
      const result = transition('DRAFT', 'INGESTED', 'system', 'ingestion complete');
      expect(result.fromState).toBe('DRAFT');
      expect(result.toState).toBe('INGESTED');
      expect(result.actor).toBe('system');
      expect(result.reason).toBe('ingestion complete');
      expect(result.transitionedAt).toBeDefined();
    });

    it('throws InvalidTransitionError on invalid transition', () => {
      expect(() => transition('DRAFT', 'PUBLISHED', 'user:123')).toThrow(
        InvalidTransitionError
      );
    });
  });

  describe('getValidTargets()', () => {
    it('returns INGESTED for DRAFT', () => {
      expect(getValidTargets('DRAFT')).toEqual(['INGESTED']);
    });

    it('returns EXPORT_READY and REVIEW for VALIDATED', () => {
      const targets = getValidTargets('VALIDATED');
      expect(targets).toContain('EXPORT_READY');
      expect(targets).toContain('REVIEW');
    });

    it('returns empty array for ARCHIVED', () => {
      expect(getValidTargets('ARCHIVED')).toEqual([]);
    });
  });
});

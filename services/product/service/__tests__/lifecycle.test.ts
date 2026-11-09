import { describe, it, expect } from 'vitest';
import type { LifecycleState } from '@merch-os/types';
import {
  toCanonical,
  toDto,
  isTransitionAllowed,
  assertTransition,
  ALLOWED_TRANSITIONS,
  type CanonicalLifecycle,
} from '../lifecycle';
import { InvalidProductLifecycleError } from '../errors';

const ALL_DTO_STATES: LifecycleState[] = [
  'DRAFT',
  'GENERATING',
  'INGESTED',
  'ENRICHED',
  'REVIEW',
  'VALIDATED',
  'EXPORT_READY',
  'PUBLISHED',
  'ARCHIVED',
];

const ALL_CANONICAL: CanonicalLifecycle[] = [
  'draft',
  'ready',
  'validated',
  'exported',
  'archived',
];

describe('lifecycle: toCanonical mapping', () => {
  const cases: Array<[LifecycleState, CanonicalLifecycle]> = [
    ['DRAFT', 'draft'],
    ['GENERATING', 'draft'],
    ['INGESTED', 'draft'],
    ['ENRICHED', 'ready'],
    ['REVIEW', 'ready'],
    ['VALIDATED', 'validated'],
    ['EXPORT_READY', 'validated'],
    ['PUBLISHED', 'exported'],
    ['ARCHIVED', 'archived'],
  ];

  it.each(cases)('maps %s → %s', (dto, canonical) => {
    expect(toCanonical(dto)).toBe(canonical);
  });

  it('maps every DTO state to a valid canonical value', () => {
    for (const s of ALL_DTO_STATES) {
      expect(ALL_CANONICAL).toContain(toCanonical(s));
    }
  });
});

describe('lifecycle: toDto reverse mapping', () => {
  const cases: Array<[CanonicalLifecycle, LifecycleState]> = [
    ['draft', 'DRAFT'],
    ['ready', 'REVIEW'],
    ['validated', 'EXPORT_READY'],
    ['exported', 'PUBLISHED'],
    ['archived', 'ARCHIVED'],
  ];

  it.each(cases)('maps %s → %s', (canonical, dto) => {
    expect(toDto(canonical)).toBe(dto);
  });

  it('round-trips canonical → dto → canonical identically', () => {
    for (const c of ALL_CANONICAL) {
      expect(toCanonical(toDto(c))).toBe(c);
    }
  });
});

describe('lifecycle: ALLOWED_TRANSITIONS table', () => {
  it('defines an entry for every DTO state', () => {
    for (const s of ALL_DTO_STATES) {
      expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('only lists valid target states', () => {
    for (const s of ALL_DTO_STATES) {
      for (const target of ALLOWED_TRANSITIONS[s]) {
        expect(ALL_DTO_STATES).toContain(target);
      }
    }
  });

  it('every non-archived state can reach ARCHIVED', () => {
    for (const s of ALL_DTO_STATES) {
      if (s === 'ARCHIVED') continue;
      expect(ALLOWED_TRANSITIONS[s]).toContain('ARCHIVED');
    }
  });

  it('ARCHIVED is terminal (no outgoing transitions)', () => {
    expect(ALLOWED_TRANSITIONS.ARCHIVED).toEqual([]);
  });
});

describe('lifecycle: isTransitionAllowed — exhaustive pairs', () => {
  // Build the full 9x9 matrix and assert each pair matches the table (with the
  // identity transition always allowed).
  for (const from of ALL_DTO_STATES) {
    for (const to of ALL_DTO_STATES) {
      const expected = from === to || ALLOWED_TRANSITIONS[from].includes(to);
      it(`${from} → ${to} is ${expected ? 'allowed' : 'denied'}`, () => {
        expect(isTransitionAllowed(from, to)).toBe(expected);
      });
    }
  }
});

describe('lifecycle: key synthesis-path transitions', () => {
  it('allows the forward synthesis path', () => {
    expect(isTransitionAllowed('DRAFT', 'GENERATING')).toBe(true);
    expect(isTransitionAllowed('GENERATING', 'REVIEW')).toBe(true);
    expect(isTransitionAllowed('REVIEW', 'EXPORT_READY')).toBe(true);
    expect(isTransitionAllowed('EXPORT_READY', 'PUBLISHED')).toBe(true);
  });

  it('allows recovery transitions', () => {
    expect(isTransitionAllowed('GENERATING', 'DRAFT')).toBe(true); // synthesis failed
    expect(isTransitionAllowed('REVIEW', 'DRAFT')).toBe(true); // re-edit
    expect(isTransitionAllowed('EXPORT_READY', 'REVIEW')).toBe(true); // changed mind
  });

  it('denies skipping review', () => {
    expect(isTransitionAllowed('DRAFT', 'EXPORT_READY')).toBe(false);
    expect(isTransitionAllowed('DRAFT', 'PUBLISHED')).toBe(false);
    expect(isTransitionAllowed('GENERATING', 'EXPORT_READY')).toBe(false);
  });

  it('treats identity transitions as allowed (idempotent)', () => {
    for (const s of ALL_DTO_STATES) {
      expect(isTransitionAllowed(s, s)).toBe(true);
    }
  });
});

describe('lifecycle: assertTransition', () => {
  it('does not throw for an allowed transition', () => {
    expect(() => assertTransition('DRAFT', 'GENERATING')).not.toThrow();
  });

  it('does not throw for an identity transition', () => {
    expect(() => assertTransition('REVIEW', 'REVIEW')).not.toThrow();
  });

  it('throws InvalidProductLifecycleError for a denied transition', () => {
    expect(() => assertTransition('DRAFT', 'EXPORT_READY')).toThrow(
      InvalidProductLifecycleError
    );
  });

  it('error carries the INVALID_PRODUCT_LIFECYCLE code and a descriptive message', () => {
    try {
      assertTransition('PUBLISHED', 'DRAFT');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProductLifecycleError);
      expect((err as InvalidProductLifecycleError).code).toBe('INVALID_PRODUCT_LIFECYCLE');
      expect((err as Error).message).toContain('PUBLISHED');
      expect((err as Error).message).toContain('DRAFT');
    }
  });

  it('throws for any outgoing transition from the terminal ARCHIVED state', () => {
    for (const to of ALL_DTO_STATES) {
      if (to === 'ARCHIVED') continue; // identity allowed
      expect(() => assertTransition('ARCHIVED', to)).toThrow(InvalidProductLifecycleError);
    }
  });
});

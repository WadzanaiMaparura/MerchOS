// Feature: pricing-page, Property 1: Config-to-cards rendering completeness
// **Validates: Requirements 2.1, 2.5, 2.6, 4.1, 4.2, 8.4**

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import { PricingCards } from '@/app/(marketing)/pricing/components/PricingCards';
import { type PricingTier, formatPrice } from '@/app/config/pricing';

// Mock next/link since we're in a test environment
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

/**
 * Arbitrary generator for a valid PricingTier
 */
const arbPricingTier: fc.Arbitrary<PricingTier> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  priceMonthly: fc.oneof(
    fc.integer({ min: 100, max: 9999900 }),
    fc.constant(null)
  ),
  currency: fc.constant('ZAR' as const),
  badge: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0)
  ),
  highlighted: fc.boolean(),
  description: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  features: fc.array(
    fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    { minLength: 1, maxLength: 8 }
  ),
  ctaLabel: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  ctaHref: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
});

/**
 * Arbitrary generator for an array of 1–10 PricingTiers with unique ids
 */
const arbTiers: fc.Arbitrary<PricingTier[]> = fc
  .array(arbPricingTier, { minLength: 1, maxLength: 10 })
  .map((tiers) => {
    // Ensure unique ids by appending index
    return tiers.map((tier, i) => ({ ...tier, id: `${tier.id}-${i}` }));
  });

describe('Property 1: Config-to-cards rendering completeness', () => {
  it('rendered card count equals tier count', () => {
    fc.assert(
      fc.property(arbTiers, (tiers) => {
        const { container } = render(<PricingCards tiers={tiers} />);

        // Each PricingCard renders as a div with h3 for the tier name
        const headings = container.querySelectorAll('h3');
        expect(headings.length).toBe(tiers.length);
      }),
      { numRuns: 100 }
    );
  });

  it('each card displays the correct tier name', () => {
    fc.assert(
      fc.property(arbTiers, (tiers) => {
        const { container } = render(<PricingCards tiers={tiers} />);

        const headings = container.querySelectorAll('h3');
        tiers.forEach((tier, i) => {
          expect(headings[i].textContent).toBe(tier.name);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('each card displays the correct price or "Contact Us" for null price', () => {
    fc.assert(
      fc.property(arbTiers, (tiers) => {
        const { container } = render(<PricingCards tiers={tiers} />);

        // Each card is a direct child div in the grid
        const grid = container.querySelector('[class*="grid"]');
        expect(grid).not.toBeNull();
        const cards = grid!.children;

        tiers.forEach((tier, i) => {
          const card = cards[i] as HTMLElement;
          if (tier.priceMonthly !== null) {
            const expectedPrice = formatPrice(tier.priceMonthly);
            expect(card.textContent).toContain(expectedPrice);
          } else {
            expect(card.textContent).toContain('Contact Us');
          }
        });
      }),
      { numRuns: 100 }
    );
  });

  it('each card displays all configured features', () => {
    fc.assert(
      fc.property(arbTiers, (tiers) => {
        const { container } = render(<PricingCards tiers={tiers} />);

        const grid = container.querySelector('[class*="grid"]');
        const cards = grid!.children;

        tiers.forEach((tier, i) => {
          const card = cards[i] as HTMLElement;
          tier.features.forEach((feature) => {
            expect(card.textContent).toContain(feature);
          });
        });
      }),
      { numRuns: 100 }
    );
  });

  it('each card displays the badge when present', () => {
    fc.assert(
      fc.property(arbTiers, (tiers) => {
        const { container } = render(<PricingCards tiers={tiers} />);

        const grid = container.querySelector('[class*="grid"]');
        const cards = grid!.children;

        tiers.forEach((tier, i) => {
          const card = cards[i] as HTMLElement;
          if (tier.badge !== null) {
            expect(card.textContent).toContain(tier.badge);
          }
        });
      }),
      { numRuns: 100 }
    );
  });

  it('each card displays the correct CTA label', () => {
    fc.assert(
      fc.property(arbTiers, (tiers) => {
        const { container } = render(<PricingCards tiers={tiers} />);

        const grid = container.querySelector('[class*="grid"]');
        const cards = grid!.children;

        tiers.forEach((tier, i) => {
          const card = cards[i] as HTMLElement;
          const link = card.querySelector('a');
          expect(link).not.toBeNull();
          expect(link!.textContent).toBe(tier.ctaLabel);
          expect(link!.getAttribute('href')).toBe(tier.ctaHref);
        });
      }),
      { numRuns: 100 }
    );
  });
});

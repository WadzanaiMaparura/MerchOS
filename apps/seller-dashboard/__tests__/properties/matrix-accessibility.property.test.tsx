// Feature: pricing-page, Property 6: Matrix icon accessibility semantics
// **Validates: Requirements 10.6**

import React from 'react';
import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import { ComparisonMatrix } from '@/app/(marketing)/pricing/components/ComparisonMatrix';
import type { ComparisonCategory, PricingTier } from '@/app/config/pricing';

/**
 * Generators for random comparison matrix data with mixed boolean/string values.
 */

const tierIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

const tierArb: fc.Arbitrary<PricingTier> = fc.record({
  id: tierIdArb,
  name: fc.string({ minLength: 1, maxLength: 30 }),
  priceMonthly: fc.oneof(fc.integer({ min: 1000, max: 9999900 }), fc.constant(null)),
  currency: fc.constant('ZAR' as const),
  badge: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
  highlighted: fc.boolean(),
  description: fc.string({ minLength: 1, maxLength: 100 }),
  features: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
  ctaLabel: fc.string({ minLength: 1, maxLength: 20 }),
  ctaHref: fc.string({ minLength: 1, maxLength: 50 }),
});

function tiersArb(minCount = 2, maxCount = 5): fc.Arbitrary<PricingTier[]> {
  return fc.array(tierArb, { minLength: minCount, maxLength: maxCount }).map((tiers) => {
    // Ensure unique IDs
    const seen = new Set<string>();
    return tiers.reduce<PricingTier[]>((acc, tier, idx) => {
      const uniqueId = seen.has(tier.id) ? `${tier.id}-${idx}` : tier.id;
      seen.add(uniqueId);
      acc.push({ ...tier, id: uniqueId });
      return acc;
    }, []);
  });
}

function featureArb(tierIds: string[]): fc.Arbitrary<{ name: string; tiers: Record<string, boolean | string> }> {
  // Each tier value is either boolean or a non-empty string
  const tierValueArb = fc.oneof(
    fc.boolean(),
    fc.string({ minLength: 1, maxLength: 20 })
  );

  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    tiers: fc.tuple(...tierIds.map(() => tierValueArb)).map((values) => {
      const record: Record<string, boolean | string> = {};
      tierIds.forEach((id, i) => {
        record[id] = values[i];
      });
      return record;
    }),
  });
}

function categoriesArb(tierIds: string[]): fc.Arbitrary<ComparisonCategory[]> {
  return fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 30 }),
      features: fc.array(featureArb(tierIds), { minLength: 1, maxLength: 10 }),
    }),
    { minLength: 1, maxLength: 5 }
  );
}

/**
 * Property 6: Matrix icon accessibility semantics
 *
 * For any cell in the ComparisonMatrix that renders a decorative icon (checkmark or cross),
 * the icon element must have `aria-hidden="true"` set, and an adjacent visually-hidden <span>
 * must provide semantic text ("Included" for checkmarks, "Not included" for crosses).
 */
describe('Property 6: Matrix icon accessibility semantics', () => {
  it('every decorative SVG icon has aria-hidden="true" and an adjacent sr-only span with semantic text', () => {
    fc.assert(
      fc.property(
        tiersArb(2, 5).chain((tiers) => {
          const tierIds = tiers.map((t) => t.id);
          return categoriesArb(tierIds).map((categories) => ({ tiers, categories }));
        }),
        ({ tiers, categories }) => {
          // Count expected boolean values to ensure we have icons to test
          let expectedBooleanCount = 0;
          for (const category of categories) {
            for (const feature of category.features) {
              for (const tier of tiers) {
                const value = feature.tiers[tier.id];
                if (typeof value === 'boolean') {
                  expectedBooleanCount++;
                }
              }
            }
          }

          const { container } = render(
            <ComparisonMatrix categories={categories} tiers={tiers} />
          );

          // Query all SVG elements in the rendered output
          const svgElements = container.querySelectorAll('svg');

          // Every SVG must have aria-hidden="true"
          svgElements.forEach((svg) => {
            expect(svg.getAttribute('aria-hidden')).toBe('true');
          });

          // For each SVG, verify an adjacent sr-only span exists with proper text
          svgElements.forEach((svg) => {
            const parent = svg.parentElement;
            expect(parent).not.toBeNull();

            // The sr-only span should be a sibling of the SVG (next element sibling)
            const srOnlySpan = parent!.querySelector('span.sr-only');
            expect(srOnlySpan).not.toBeNull();

            // The text should be either "Included" or "Not included"
            const text = srOnlySpan!.textContent;
            expect(
              text === 'Included' || text === 'Not included'
            ).toBe(true);
          });

          // Verify the count of SVGs matches the number of boolean values
          // (string values should not render icons)
          expect(svgElements.length).toBe(expectedBooleanCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

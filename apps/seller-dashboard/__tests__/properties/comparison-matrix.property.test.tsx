// Feature: pricing-page, Property 3: Comparison matrix config-to-table rendering
// **Validates: Requirements 6.2, 6.3, 6.5, 8.5**

import React from 'react';
import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import { ComparisonMatrix } from '@/app/(marketing)/pricing/components/ComparisonMatrix';
import type { ComparisonCategory, ComparisonFeature, PricingTier } from '@/app/config/pricing';

/**
 * Arbitrary generator for a feature value: true, false, or a non-empty string.
 */
const featureValueArb = fc.oneof(
  fc.constant(true as boolean | string),
  fc.constant(false as boolean | string),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0) as fc.Arbitrary<boolean | string>
);

/**
 * Generate a valid comparison feature given tier IDs.
 */
function comparisonFeatureArb(tierIds: string[]): fc.Arbitrary<ComparisonFeature> {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    tiers: fc.tuple(...tierIds.map(() => featureValueArb)).map((values) => {
      const record: Record<string, boolean | string> = {};
      tierIds.forEach((id, i) => {
        record[id] = values[i];
      });
      return record;
    }),
  });
}

/**
 * Generate a valid comparison category given tier IDs.
 */
function comparisonCategoryArb(tierIds: string[]): fc.Arbitrary<ComparisonCategory> {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    features: fc.array(comparisonFeatureArb(tierIds), { minLength: 1, maxLength: 20 }),
  });
}

/**
 * Generate a minimal PricingTier with only the fields needed for ComparisonMatrix rendering.
 */
const pricingTierArb: fc.Arbitrary<PricingTier> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-z][a-z0-9-]*$/.test(s)),
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  priceMonthly: fc.constant(10000 as number | null),
  currency: fc.constant('ZAR' as const),
  badge: fc.constant(null as string | null),
  highlighted: fc.constant(false),
  description: fc.constant('Test tier'),
  features: fc.constant(['Feature 1']),
  ctaLabel: fc.constant('Get Started'),
  ctaHref: fc.constant('/register'),
});

/**
 * Generate an array of unique tiers (2–8) with unique IDs.
 */
const tiersArb: fc.Arbitrary<PricingTier[]> = fc
  .array(pricingTierArb, { minLength: 2, maxLength: 8 })
  .map((tiers) => {
    // Ensure unique IDs by appending index
    return tiers.map((tier, i) => ({ ...tier, id: `tier-${i}`, name: `Tier ${i}` }));
  });

describe('Property 3: Comparison matrix config-to-table rendering', () => {
  it('renders correct number of category heading rows, feature rows, tier column headers, and cell values', () => {
    fc.assert(
      fc.property(tiersArb, (tiers) => {
        const tierIds = tiers.map((t) => t.id);

        // Generate categories synchronously using fc.sample
        const categoriesArb = fc.array(comparisonCategoryArb(tierIds), {
          minLength: 1,
          maxLength: 5,
        });
        const [categories] = fc.sample(categoriesArb, 1);

        const { container } = render(
          <ComparisonMatrix categories={categories} tiers={tiers} />
        );

        const table = container.querySelector('table');
        expect(table).not.toBeNull();

        // Verify tier column headers in <thead>
        const thead = table!.querySelector('thead');
        expect(thead).not.toBeNull();
        // Tier headers are <th scope="col"> excluding the "Feature" header
        const colHeaders = thead!.querySelectorAll('th[scope="col"]');
        // First col header is the hidden "Feature" label, remaining are tiers
        // Based on component: first th has sr-only "Feature", then tier headers
        const tierHeaders = Array.from(colHeaders).filter(
          (th) => !th.querySelector('.sr-only') || th.textContent?.trim() !== 'Feature'
        );
        // Total col headers = tiers.length + 1 (Feature header)
        expect(colHeaders.length).toBe(tiers.length + 1);

        // Verify category heading rows
        const tbody = table!.querySelector('tbody');
        expect(tbody).not.toBeNull();
        // Category heading rows use <th scope="row" colSpan={...}> with font-bold and bg-gray-50
        const allRowHeaders = tbody!.querySelectorAll('th[scope="row"]');
        const categoryHeadingRows = Array.from(allRowHeaders).filter(
          (th) =>
            th.hasAttribute('colspan') &&
            th.classList.contains('font-bold') &&
            th.classList.contains('bg-gray-50')
        );
        expect(categoryHeadingRows.length).toBe(categories.length);

        // Verify each category heading has the correct name
        categories.forEach((cat, i) => {
          expect(categoryHeadingRows[i].textContent).toBe(cat.name);
        });

        // Verify feature rows
        const totalFeatures = categories.reduce(
          (sum, cat) => sum + cat.features.length,
          0
        );
        // Feature row headers are <th scope="row"> without colspan
        const featureRowHeaders = Array.from(allRowHeaders).filter(
          (th) => !th.hasAttribute('colspan')
        );
        expect(featureRowHeaders.length).toBe(totalFeatures);

        // Verify cell values for each feature
        const featureRows = Array.from(tbody!.querySelectorAll('tr')).filter(
          (tr) => {
            const th = tr.querySelector('th[scope="row"]');
            return th && !th.hasAttribute('colspan');
          }
        );

        let featureIndex = 0;
        categories.forEach((cat) => {
          cat.features.forEach((feature) => {
            const row = featureRows[featureIndex];
            const cells = row.querySelectorAll('td');
            expect(cells.length).toBe(tiers.length);

            tiers.forEach((tier, tierIdx) => {
              const value = feature.tiers[tier.id];
              const cell = cells[tierIdx];

              if (value === true) {
                // Should render CheckIcon with sr-only "Included"
                const srText = cell.querySelector('.sr-only');
                expect(srText?.textContent).toBe('Included');
              } else if (value === false) {
                // Should render CrossIcon with sr-only "Not included"
                const srText = cell.querySelector('.sr-only');
                expect(srText?.textContent).toBe('Not included');
              } else {
                // String value rendered as literal text
                expect(cell.textContent).toBe(value);
              }
            });

            featureIndex++;
          });
        });

        // Cleanup
        // React Testing Library auto-cleans up but we use container queries above
      }),
      { numRuns: 100 }
    );
  });
});

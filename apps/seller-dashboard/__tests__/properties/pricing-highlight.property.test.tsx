// Feature: pricing-page, Property 2: Highlighted vs non-highlighted styling differentiation
// **Validates: Requirements 3.1, 4.4, 4.5**

import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import React from 'react';

import { type PricingTier } from '@/app/config/pricing';
import { PricingCard } from '@/app/(marketing)/pricing/components/PricingCard';

// Mock next/link to render a plain anchor
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// Generator for arbitrary PricingTier objects
const arbPricingTier = (highlighted: boolean): fc.Arbitrary<PricingTier> =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z0-9-]+$/.test(s)),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    priceMonthly: fc.oneof(fc.integer({ min: 100, max: 9999900 }), fc.constant(null)),
    currency: fc.constant('ZAR' as const),
    badge: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
    highlighted: fc.constant(highlighted),
    description: fc.string({ minLength: 1, maxLength: 100 }),
    features: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 6 }),
    ctaLabel: fc.string({ minLength: 1, maxLength: 20 }),
    ctaHref: fc.constant('/register?plan=test'),
  });

// Highlighted card classes
const HIGHLIGHTED_CARD_CLASSES = ['border-primary-600', 'bg-primary-50', 'shadow-lg', 'scale-105'];
const HIGHLIGHTED_CTA_CLASSES = ['bg-primary-600', 'text-white'];

// Non-highlighted card classes
const NON_HIGHLIGHTED_CARD_CLASSES = ['border-gray-200', 'bg-white', 'shadow-sm'];
const NON_HIGHLIGHTED_CTA_CLASSES = ['border-primary-600', 'text-primary-600', 'bg-transparent'];

describe('Property 2: Highlighted vs non-highlighted styling differentiation', () => {
  it('highlighted cards have accent border, tinted background, elevated shadow, and filled CTA', () => {
    fc.assert(
      fc.property(arbPricingTier(true), (tier) => {
        const { container } = render(<PricingCard tier={tier} />);

        const cardDiv = container.firstElementChild as HTMLElement;
        const ctaLink = container.querySelector('a') as HTMLElement;

        // Highlighted card must have all highlighted classes
        for (const cls of HIGHLIGHTED_CARD_CLASSES) {
          expect(cardDiv.className).toContain(cls);
        }

        // Highlighted CTA must have filled style classes
        for (const cls of HIGHLIGHTED_CTA_CLASSES) {
          expect(ctaLink.className).toContain(cls);
        }

        // Highlighted card must NOT have non-highlighted exclusive classes
        expect(cardDiv.className).not.toContain('bg-white');
        expect(cardDiv.className).not.toContain('shadow-sm');
        expect(cardDiv.className).not.toContain('border-gray-200');

        // Highlighted CTA must NOT have outlined style
        expect(ctaLink.className).not.toContain('bg-transparent');
      }),
      { numRuns: 100 }
    );
  });

  it('non-highlighted cards have standard border, white background, standard shadow, and outlined CTA', () => {
    fc.assert(
      fc.property(arbPricingTier(false), (tier) => {
        const { container } = render(<PricingCard tier={tier} />);

        const cardDiv = container.firstElementChild as HTMLElement;
        const ctaLink = container.querySelector('a') as HTMLElement;

        // Non-highlighted card must have all standard classes
        for (const cls of NON_HIGHLIGHTED_CARD_CLASSES) {
          expect(cardDiv.className).toContain(cls);
        }

        // Non-highlighted CTA must have outlined style classes
        for (const cls of NON_HIGHLIGHTED_CTA_CLASSES) {
          expect(ctaLink.className).toContain(cls);
        }

        // Non-highlighted card must NOT have highlighted exclusive classes
        expect(cardDiv.className).not.toContain('bg-primary-50');
        expect(cardDiv.className).not.toContain('shadow-lg');
        expect(cardDiv.className).not.toContain('scale-105');
        expect(cardDiv.className).not.toContain('border-primary-600');

        // Non-highlighted CTA must NOT have filled style
        expect(ctaLink.className).not.toContain('text-white');
      }),
      { numRuns: 100 }
    );
  });

  it('highlighted and non-highlighted classes are mutually exclusive', () => {
    fc.assert(
      fc.property(fc.boolean(), (isHighlighted) => {
        const tierArb = arbPricingTier(isHighlighted);
        // Run inner assertion with a single generated tier
        fc.assert(
          fc.property(tierArb, (tier) => {
            const { container } = render(<PricingCard tier={tier} />);

            const cardDiv = container.firstElementChild as HTMLElement;
            const ctaLink = container.querySelector('a') as HTMLElement;

            if (isHighlighted) {
              // Card: highlighted present, non-highlighted absent
              for (const cls of HIGHLIGHTED_CARD_CLASSES) {
                expect(cardDiv.className).toContain(cls);
              }
              expect(cardDiv.className).not.toContain('bg-white');
              expect(cardDiv.className).not.toContain('shadow-sm');

              // CTA: filled present, outlined absent
              for (const cls of HIGHLIGHTED_CTA_CLASSES) {
                expect(ctaLink.className).toContain(cls);
              }
              expect(ctaLink.className).not.toContain('bg-transparent');
            } else {
              // Card: non-highlighted present, highlighted absent
              for (const cls of NON_HIGHLIGHTED_CARD_CLASSES) {
                expect(cardDiv.className).toContain(cls);
              }
              expect(cardDiv.className).not.toContain('bg-primary-50');
              expect(cardDiv.className).not.toContain('shadow-lg');
              expect(cardDiv.className).not.toContain('scale-105');

              // CTA: outlined present, filled absent
              for (const cls of NON_HIGHLIGHTED_CTA_CLASSES) {
                expect(ctaLink.className).toContain(cls);
              }
              expect(ctaLink.className).not.toContain('text-white');
            }
          }),
          { numRuns: 1 }
        );
      }),
      { numRuns: 100 }
    );
  });
});

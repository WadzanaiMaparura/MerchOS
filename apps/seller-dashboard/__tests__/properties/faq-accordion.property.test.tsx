// Feature: pricing-page, Property 4: FAQ accordion exclusivity
// **Validates: Requirements 7.5**

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as fc from 'fast-check';
import { FAQSection } from '@/app/(marketing)/pricing/components/FAQSection';
import { FAQItem } from '@/app/config/pricing';

describe('Property 4: FAQ accordion exclusivity', () => {
  it('at most one FAQ item is expanded at any given time after each activation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            question: fc.string({ minLength: 1, maxLength: 50 }),
            answer: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        fc.array(fc.nat(), { minLength: 1, maxLength: 10 }),
        async (items: FAQItem[], clickSequence: number[]) => {
          const user = userEvent.setup();
          const { unmount } = render(<FAQSection items={items} />);

          // Initially all items should be collapsed
          const initialButtons = screen.getAllByRole('button');
          const initialExpandedCount = initialButtons.filter(
            (btn) => btn.getAttribute('aria-expanded') === 'true'
          ).length;
          expect(initialExpandedCount).toBe(0);

          // Apply each click in the sequence
          for (const rawIndex of clickSequence) {
            const targetIndex = rawIndex % items.length;
            const buttons = screen.getAllByRole('button');
            await user.click(buttons[targetIndex]);

            // After each click, at most one item should be expanded
            const allButtons = screen.getAllByRole('button');
            const expandedCount = allButtons.filter(
              (btn) => btn.getAttribute('aria-expanded') === 'true'
            ).length;
            expect(expandedCount).toBeLessThanOrEqual(1);
          }

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('clicking the same button twice collapses it (expanded count = 0)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            question: fc.string({ minLength: 1, maxLength: 50 }),
            answer: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        fc.nat(),
        async (items: FAQItem[], rawIndex: number) => {
          const user = userEvent.setup();
          const targetIndex = rawIndex % items.length;
          const { unmount } = render(<FAQSection items={items} />);

          const buttons = screen.getAllByRole('button');

          // First click: should expand the item
          await user.click(buttons[targetIndex]);
          const afterFirstClick = screen.getAllByRole('button');
          const expandedAfterFirst = afterFirstClick.filter(
            (btn) => btn.getAttribute('aria-expanded') === 'true'
          ).length;
          expect(expandedAfterFirst).toBe(1);

          // Second click on same button: should collapse it
          await user.click(afterFirstClick[targetIndex]);
          const afterSecondClick = screen.getAllByRole('button');
          const expandedAfterSecond = afterSecondClick.filter(
            (btn) => btn.getAttribute('aria-expanded') === 'true'
          ).length;
          expect(expandedAfterSecond).toBe(0);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});

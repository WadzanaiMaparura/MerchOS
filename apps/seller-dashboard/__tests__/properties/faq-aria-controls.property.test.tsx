// Feature: pricing-page, Property 5: Accessible aria-controls linkage
// **Validates: Requirements 10.3**

import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import { FAQSection } from '@/app/(marketing)/pricing/components/FAQSection';
import { FAQItem } from '@/app/config/pricing';

describe('Property 5: Accessible aria-controls linkage', () => {
  it('each trigger button aria-controls matches corresponding answer panel id', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            question: fc.string({ minLength: 1, maxLength: 80 }),
            answer: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        (items: FAQItem[]) => {
          const { container, unmount } = render(<FAQSection items={items} />);

          items.forEach((_, index) => {
            const triggerId = `faq-trigger-${index}`;
            const trigger = container.querySelector(`#${triggerId}`);

            // Trigger button must exist
            expect(trigger).not.toBeNull();

            // aria-controls must be a non-empty string
            const ariaControls = trigger!.getAttribute('aria-controls');
            expect(ariaControls).toBeTruthy();
            expect(typeof ariaControls).toBe('string');
            expect(ariaControls!.length).toBeGreaterThan(0);

            // An element with the aria-controls id must exist in the document
            const panel = container.querySelector(`#${ariaControls}`);
            expect(panel).not.toBeNull();

            // The panel should be a <dd> element
            expect(panel!.tagName.toLowerCase()).toBe('dd');

            // The panel's aria-labelledby should point back to the trigger's id
            const ariaLabelledBy = panel!.getAttribute('aria-labelledby');
            expect(ariaLabelledBy).toBe(triggerId);
          });

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});

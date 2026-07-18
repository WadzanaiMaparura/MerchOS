'use client';

import { useState } from 'react';
import { FAQItem } from '@/app/config/pricing';

interface FAQSectionProps {
  items: FAQItem[];
}

export function FAQSection({ items }: FAQSectionProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  function toggleItem(index: number) {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }

  return (
    <section className="py-16 sm:py-24" aria-labelledby="faq-heading">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 id="faq-heading" className="text-3xl sm:text-4xl font-bold text-gray-900 text-center">
          Frequently Asked Questions
        </h2>

        <dl className="mt-12 divide-y divide-gray-200">
          {items.map((item, index) => {
            const isExpanded = expandedIndex === index;
            const panelId = `faq-panel-${index}`;
            const triggerId = `faq-trigger-${index}`;

            return (
              <div key={index} className="py-4">
                <dt>
                  <button
                    id={triggerId}
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => toggleItem(index)}
                    className="flex w-full items-center justify-between text-left text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 rounded-md"
                  >
                    <span className="text-base font-medium">{item.question}</span>
                    <span
                      aria-hidden="true"
                      className={`ml-4 flex-shrink-0 transition-transform duration-300 ${
                        isExpanded ? 'rotate-180' : 'rotate-0'
                      }`}
                    >
                      <svg
                        className="h-5 w-5 text-gray-500"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                  </button>
                </dt>
                <dd
                  id={panelId}
                  role="region"
                  aria-labelledby={triggerId}
                  className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                    isExpanded ? 'max-h-96' : 'max-h-0'
                  }`}
                >
                  <p className="pt-3 text-base text-gray-600">{item.answer}</p>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

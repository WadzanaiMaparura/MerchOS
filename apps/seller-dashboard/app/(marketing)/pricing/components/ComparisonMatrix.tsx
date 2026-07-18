import { Fragment } from 'react';

import type { ComparisonCategory, PricingTier } from '@/app/config/pricing';

interface ComparisonMatrixProps {
  categories: ComparisonCategory[];
  tiers: PricingTier[];
}

function CheckIcon() {
  return (
    <>
      <svg
        aria-hidden="true"
        className="h-5 w-5 text-primary-600"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
      <span className="sr-only">Included</span>
    </>
  );
}

function CrossIcon() {
  return (
    <>
      <svg
        aria-hidden="true"
        className="h-5 w-5 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span className="sr-only">Not included</span>
    </>
  );
}

export function ComparisonMatrix({ categories, tiers }: ComparisonMatrixProps) {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="comparison-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="comparison-heading" className="text-3xl sm:text-4xl font-bold text-gray-900 text-center mb-12">
          Compare Plans
        </h2>

        {/* Horizontal scroll wrapper for mobile */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-sm font-semibold text-gray-900"
                >
                  <span className="sr-only">Feature</span>
                </th>
                {tiers.map((tier) => (
                  <th
                    key={tier.id}
                    scope="col"
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-900"
                  >
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <Fragment key={`category-${category.name}`}>
                  {/* Category heading row */}
                  <tr>
                    <th
                      scope="row"
                      colSpan={tiers.length + 1}
                      className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-sm font-bold text-gray-900"
                    >
                      {category.name}
                    </th>
                  </tr>

                  {/* Feature rows */}
                  {category.features.map((feature) => (
                    <tr key={`feature-${category.name}-${feature.name}`} className="border-t border-gray-100">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-sm font-normal text-gray-700 whitespace-nowrap"
                      >
                        {feature.name}
                      </th>
                      {tiers.map((tier) => {
                        const value = feature.tiers[tier.id];

                        return (
                          <td
                            key={`${feature.name}-${tier.id}`}
                            className="px-4 py-3 text-center text-sm text-gray-600"
                          >
                            {value === true ? (
                              <span className="inline-flex justify-center">
                                <CheckIcon />
                              </span>
                            ) : value === false ? (
                              <span className="inline-flex justify-center">
                                <CrossIcon />
                              </span>
                            ) : (
                              <span>{value}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default ComparisonMatrix;

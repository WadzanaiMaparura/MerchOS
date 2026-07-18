import Link from 'next/link';

import { type PricingTier, formatPrice } from '@/app/config/pricing';

interface PricingCardProps {
  tier: PricingTier;
}

export function PricingCard({ tier }: PricingCardProps) {
  const isHighlighted = tier.highlighted;

  const cardClasses = isHighlighted
    ? 'relative border-2 border-primary-600 bg-primary-50 shadow-lg scale-105 rounded-xl p-6 flex flex-col transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-md'
    : 'relative border border-gray-200 bg-white shadow-sm rounded-xl p-6 flex flex-col transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-md';

  const ctaClasses = isHighlighted
    ? 'mt-auto block w-full rounded-lg py-3 px-4 text-center text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600'
    : 'mt-auto block w-full rounded-lg py-3 px-4 text-center text-sm font-semibold border border-primary-600 text-primary-600 bg-transparent hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';

  return (
    <div className={cardClasses}>
      {tier.badge && (
        <span className="inline-block self-start rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white mb-3">
          {tier.badge}
        </span>
      )}

      <h3 className="text-lg font-bold text-gray-900">{tier.name}</h3>

      <p className="mt-1 text-sm text-gray-600">{tier.description}</p>

      <div className="mt-4 mb-6">
        {tier.priceMonthly !== null ? (
          <p className="text-3xl font-bold text-gray-900">
            {formatPrice(tier.priceMonthly)}
            <span className="text-base font-normal text-gray-600">/mo</span>
          </p>
        ) : (
          <p className="text-3xl font-bold text-gray-900">Contact Us</p>
        )}
      </div>

      <ul className="mb-8 flex-1 space-y-3" role="list">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
            <span className="mt-0.5 flex-shrink-0 text-primary-600" aria-hidden="true">
              ✓
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <Link href={tier.ctaHref} className={ctaClasses}>
        {tier.ctaLabel}
      </Link>
    </div>
  );
}

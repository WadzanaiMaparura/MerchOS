import { type PricingTier } from '@/app/config/pricing';

import { PricingCard } from './PricingCard';

interface PricingCardsProps {
  tiers: PricingTier[];
}

export function PricingCards({ tiers }: PricingCardsProps) {
  return (
    <section className="py-16 sm:py-20" aria-labelledby="pricing-plans-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="pricing-plans-heading" className="sr-only">
          Subscription Plans
        </h2>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5 lg:items-center">
          {tiers.map((tier) => (
            <PricingCard key={tier.id} tier={tier} />
          ))}
        </div>
      </div>
    </section>
  );
}

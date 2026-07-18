import type { Metadata } from 'next';

import { pricingConfig } from '@/app/config/pricing';

import { PricingHero } from './components/PricingHero';
import { PricingCards } from './components/PricingCards';
import { ComparisonMatrix } from './components/ComparisonMatrix';
import { FAQSection } from './components/FAQSection';

export const metadata: Metadata = {
  title: 'Pricing — MerchOS',
  description:
    'Compare MerchOS subscription plans and find the right tier for your marketplace business. From Launch to Enterprise, scale your product listings with AI-powered tools.',
};

export default function PricingPage() {
  return (
    <>
      <PricingHero />
      <PricingCards tiers={pricingConfig.tiers} />
      <ComparisonMatrix
        categories={pricingConfig.comparison}
        tiers={pricingConfig.tiers}
      />
      <FAQSection items={pricingConfig.faq} />
    </>
  );
}

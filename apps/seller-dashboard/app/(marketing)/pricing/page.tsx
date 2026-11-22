import type { Metadata } from 'next';

import { pricingConfig } from '@/app/config/pricing';

import { PricingHero } from './components/PricingHero';
import { PricingCards } from './components/PricingCards';
import { ComparisonMatrix } from './components/ComparisonMatrix';
import { FAQSection } from './components/FAQSection';
import TrainingSection from '../components/TrainingSection';

export const metadata: Metadata = {
  title: 'Pricing — MerchOS',
  description:
    'MerchOS plans from R499 a month: ready-written marketplace listings, corrections included, export to every marketplace, unlimited team members and free training. Start free, no card.',
};

export default function PricingPage() {
  return (
    <>
      <PricingHero />
      <PricingCards tiers={pricingConfig.tiers} />
      <TrainingSection />
      <ComparisonMatrix
        categories={pricingConfig.comparison}
        tiers={pricingConfig.tiers}
      />
      <FAQSection items={pricingConfig.faq} />
    </>
  );
}

// Pricing page configuration — single source of truth for all pricing data.
// Prices stored as integers (ZAR cents) to avoid floating-point issues.

export interface PricingTier {
  /** Unique identifier for the tier (e.g., "launch", "growth") */
  id: string;
  /** Display name (e.g., "Launch", "Growth") */
  name: string;
  /** Monthly price in ZAR cents, or null for contact-based pricing */
  priceMonthly: number | null;
  /** Currency code */
  currency: 'ZAR';
  /** Optional badge text (e.g., "Most Popular") */
  badge: string | null;
  /** Whether this tier is visually highlighted as recommended */
  highlighted: boolean;
  /** Short description of who this tier is for */
  description: string;
  /** List of key features shown on the card */
  features: string[];
  /** CTA button label */
  ctaLabel: string;
  /** CTA button destination path */
  ctaHref: string;
}

export interface ComparisonFeature {
  /** Feature display name */
  name: string;
  /** Value per tier: true = included, false = excluded, string = specific value */
  tiers: Record<string, boolean | string>;
}

export interface ComparisonCategory {
  /** Category heading name */
  name: string;
  /** Features within this category */
  features: ComparisonFeature[];
}

export interface FAQItem {
  /** The question text */
  question: string;
  /** The answer text (supports plain text) */
  answer: string;
}

export interface PricingConfig {
  tiers: PricingTier[];
  comparison: ComparisonCategory[];
  faq: FAQItem[];
}

/**
 * Formats a price in ZAR cents to a display string.
 * Example: 49900 → "R499" | 129900 → "R1 299"
 */
export function formatPrice(priceInCents: number): string {
  return `R${(priceInCents / 100).toLocaleString('en-ZA')}`;
}

export const pricingConfig: PricingConfig = {
  tiers: [
    {
      id: 'professional',
      name: 'Professional',
      priceMonthly: 49900,
      currency: 'ZAR',
      badge: 'Recommended',
      highlighted: true,
      description: 'For independent sellers managing multi-channel e-commerce',
      features: [
        '10,000 products',
        '4 channels',
        '5 team members',
        '10,000 AI enrichment calls/mo',
        '5,000 image processing calls/mo',
        '100 CSV exports/mo',
        '99.9% SLA guarantee',
      ],
      ctaLabel: 'Start Free Trial',
      ctaHref: '/register?plan=professional',
    },
    {
      id: 'business',
      name: 'Business',
      priceMonthly: 99900,
      currency: 'ZAR',
      badge: null,
      highlighted: false,
      description: 'For teams, agencies, and high-volume sellers',
      features: [
        '50,000 products',
        '6 channels',
        '25 team members',
        '100,000 AI enrichment calls/mo',
        '50,000 image processing calls/mo',
        '500 CSV exports/mo',
        'Priority support',
        'SAML SSO',
        '99.9% SLA guarantee',
      ],
      ctaLabel: 'Start Free Trial',
      ctaHref: '/register?plan=business',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      priceMonthly: null,
      currency: 'ZAR',
      badge: null,
      highlighted: false,
      description: 'For large retailers, manufacturers, and distributors',
      features: [
        'Unlimited products',
        '6 channels',
        'Unlimited team members',
        'Custom AI enrichment limits',
        'Custom image processing limits',
        'Custom CSV export limits',
        'Dedicated account manager',
        'Custom integrations',
        'SAML SSO',
        'SLA up to 99.99%',
      ],
      ctaLabel: 'Contact Sales',
      ctaHref: '/contact?reason=enterprise',
    },
  ],

  comparison: [
    {
      name: 'Usage Limits',
      features: [
        {
          name: 'Products',
          tiers: { professional: '10,000', business: '50,000', enterprise: 'Unlimited' },
        },
        {
          name: 'Channels',
          tiers: { professional: '4', business: '6', enterprise: '6' },
        },
        {
          name: 'Team members',
          tiers: { professional: '5', business: '25', enterprise: 'Unlimited' },
        },
        {
          name: 'AI enrichment calls/mo',
          tiers: { professional: '10,000', business: '100,000', enterprise: 'Custom' },
        },
        {
          name: 'Image processing calls/mo',
          tiers: { professional: '5,000', business: '50,000', enterprise: 'Custom' },
        },
        {
          name: 'CSV exports/mo',
          tiers: { professional: '100', business: '500', enterprise: 'Custom' },
        },
      ],
    },
    {
      name: 'Platform Features',
      features: [
        {
          name: 'AI product enrichment',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Multi-channel publishing',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Bulk import/export',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Marketplace validation',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Inventory management',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Role-based access control',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Audit log',
          tiers: { professional: true, business: true, enterprise: true },
        },
      ],
    },
    {
      name: 'Support & Security',
      features: [
        {
          name: 'Email support',
          tiers: { professional: true, business: true, enterprise: true },
        },
        {
          name: 'Priority support',
          tiers: { professional: false, business: true, enterprise: true },
        },
        {
          name: 'Dedicated account manager',
          tiers: { professional: false, business: false, enterprise: true },
        },
        {
          name: 'SAML SSO',
          tiers: { professional: false, business: true, enterprise: true },
        },
        {
          name: 'Custom integrations',
          tiers: { professional: false, business: false, enterprise: true },
        },
        {
          name: 'SLA guarantee',
          tiers: { professional: '99.9%', business: '99.9%', enterprise: 'Up to 99.99%' },
        },
      ],
    },
  ],

  faq: [
    {
      question: 'Is there a free trial?',
      answer:
        'Yes! Every new account starts with a 14-day free trial that gives you access to all Professional plan features with reduced usage limits. No credit card required to start. When your trial ends, you can subscribe to continue or your access will be paused until you choose a plan.',
    },
    {
      question: 'Can I upgrade later?',
      answer:
        'Yes, you can upgrade your plan at any time. When you upgrade, your current billing period is prorated (credit for unused time) and the new plan entitlements unlock immediately.',
    },
    {
      question: 'Can I downgrade?',
      answer:
        'Yes, self-service downgrade between Professional and Business is available at any time. The downgrade takes effect at the end of your current billing period. Downgrading from Enterprise requires coordination with our sales team.',
    },
    {
      question: 'What happens if I exceed my usage limits?',
      answer:
        'You will receive alerts at 80% and 100% of your limits. Once you reach 100%, the relevant operation is paused until your next billing cycle or you upgrade to a higher plan with more capacity.',
    },
    {
      question: 'What happens when my free trial ends?',
      answer:
        'If you have a payment method on file, your account automatically converts to a paid Professional plan. If not, your access is paused until you add a payment method. No data is deleted during the pause.',
    },
    {
      question: 'Which marketplaces are supported?',
      answer:
        'MerchOS currently supports Takealot, Amazon South Africa, Makro Marketplace, Shopify, and WooCommerce. We are continuously adding new marketplace integrations based on seller demand.',
    },
    {
      question: 'Can I cancel anytime?',
      answer:
        'Yes, you can cancel your subscription at any time with no cancellation fees. Your account will remain active until the end of your current billing period.',
    },
  ],
};

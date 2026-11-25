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

/** Plans renew by card automatically (PayFast subscriptions). Build-time switch. */
export const CARD_BILLING = process.env.NEXT_PUBLIC_CARD_SUBSCRIPTIONS === 'true';

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
      id: 'trial',
      name: 'Free trial',
      priceMonthly: 0,
      currency: 'ZAR',
      badge: null,
      highlighted: false,
      description: 'Try MerchOS on your own products',
      features: [
        '15 products, listing writing included',
        'Corrections included',
        'Export to every marketplace',
        'Unlimited team members',
        'No credit card, no time limit',
        'Free training',
      ],
      ctaLabel: 'Start free',
      ctaHref: '/register',
    },
    {
      id: 'starter',
      name: 'Starter',
      priceMonthly: 49900,
      currency: 'ZAR',
      badge: null,
      highlighted: false,
      description: 'For new sellers',
      features: [
        '500 new products / month',
        'Ready-written listings, corrections included',
        'Export to every marketplace',
        'Unlimited team members',
        'Free training',
        'Email support',
      ],
      ctaLabel: 'Start free',
      ctaHref: '/register?plan=starter',
    },
    {
      id: 'growth',
      name: 'Growth',
      priceMonthly: 89900,
      currency: 'ZAR',
      badge: 'Most popular',
      highlighted: true,
      description: 'For growing businesses',
      features: [
        '1,000 new products / month',
        'Ready-written listings, corrections included',
        'Export to every marketplace',
        'Unlimited team members',
        'Free training',
        'Priority email support',
      ],
      ctaLabel: 'Start free',
      ctaHref: '/register?plan=growth',
    },
    {
      id: 'pro',
      name: 'Pro',
      priceMonthly: 179000,
      currency: 'ZAR',
      badge: null,
      highlighted: false,
      description: 'For high-volume sellers and agencies',
      features: [
        '2,000 new products / month',
        'Ready-written listings, corrections included',
        'Export to every marketplace',
        'Unlimited team members',
        'Free training + a dedicated session',
        'Priority email support',
      ],
      ctaLabel: 'Start free',
      ctaHref: '/register?plan=pro',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      priceMonthly: null,
      currency: 'ZAR',
      badge: null,
      highlighted: false,
      description: 'For large catalogues',
      features: [
        'Custom product volume',
        'Everything in Pro',
        'Dedicated onboarding',
        'Account manager',
      ],
      ctaLabel: 'Contact us',
      ctaHref: '/contact?reason=enterprise',
    },
  ],

  comparison: [
    {
      name: 'What you get',
      features: [
        {
          name: 'New products per month',
          tiers: { trial: '15 (once)', starter: '500', growth: '1,000', pro: '2,000', enterprise: 'Custom' },
        },
        {
          name: 'Ready-written listings',
          tiers: { trial: true, starter: true, growth: true, pro: true, enterprise: true },
        },
        {
          name: 'Corrections',
          tiers: { trial: 'Included', starter: 'Included', growth: 'Included', pro: 'Included', enterprise: 'Included' },
        },
        {
          name: 'Products kept in your catalogue',
          tiers: { trial: '15', starter: 'All', growth: 'All', pro: 'All', enterprise: 'All' },
        },
        {
          name: 'Team members',
          tiers: { trial: 'Unlimited', starter: 'Unlimited', growth: 'Unlimited', pro: 'Unlimited', enterprise: 'Unlimited' },
        },
      ],
    },
    {
      name: 'Import and export',
      features: [
        {
          name: 'Import from CSV, Excel, PDF or product photos',
          tiers: { trial: true, starter: true, growth: true, pro: true, enterprise: true },
        },
        {
          name: 'Export to every marketplace',
          tiers: { trial: true, starter: true, growth: true, pro: true, enterprise: true },
        },
        {
          name: 'Duplicate detection on import',
          tiers: { trial: true, starter: true, growth: true, pro: true, enterprise: true },
        },
      ],
    },
    {
      name: 'Training and support',
      features: [
        {
          name: 'Free training',
          tiers: { trial: true, starter: true, growth: true, pro: true, enterprise: true },
        },
        {
          name: 'Dedicated training session',
          tiers: { trial: false, starter: false, growth: false, pro: true, enterprise: true },
        },
        {
          name: 'Support',
          tiers: { trial: 'Email', starter: 'Email', growth: 'Priority email', pro: 'Priority email', enterprise: 'Account manager' },
        },
      ],
    },
  ],

  faq: [
    {
      question: 'Is there a free trial?',
      answer:
        'Yes. Create your first 15 products free, including listing writing and corrections. No credit card is needed, and there is no time limit.',
    },
    {
      question: 'What happens when my 15 free products are used?',
      answer: CARD_BILLING
        ? 'You keep them, and you can still edit and correct them. To add new products or generate new content, choose a plan. Nothing is charged until you subscribe.'
        : 'You keep them, and you can still edit and correct them. To add new products or generate new content, choose a plan. We never charge you automatically.',
    },
    ...(CARD_BILLING
      ? [
          {
            question: 'How do I pay?',
            answer:
              'By card, through PayFast. Your plan renews automatically each month and your card is charged on the same date. We email you a week before. You can change your plan or stop automatic billing at any time from Billing. If a card payment does not go through, you can update your card or pay that month by EFT.',
          },
        ]
      : []),
    {
      question: 'What counts as a new product?',
      answer:
        'Each product you add in a month, whether from a photo, a spreadsheet row or typed in. Its ready-written listing and the corrections you need are included. You can add them any day: one today, twenty tomorrow, until your monthly number is reached.',
    },
    {
      question: 'Do I pay extra to export to more marketplaces?',
      answer:
        'No. Once a product is finished, MerchOS fills in the upload file for every marketplace you sell on at no extra cost.',
    },
    {
      question: 'What happens at the end of the month?',
      answer:
        'Your count of new products resets for the next month. Products you have already created stay in your catalogue.',
    },
    {
      question: 'Do you limit team members?',
      answer: 'No. Invite your whole team on any plan, free.',
    },
    {
      question: 'Is there a setup fee?',
      answer: 'No. Setup and training are free, even before you subscribe.',
    },
    {
      question: 'Is training really free?',
      answer:
        'Yes. Join a weekly online session, or book a one-on-one session online or in person, arranged with you on a call. We show you how to upload your products to every platform you sell on.',
    },
    {
      question: 'Can I change or cancel my plan?',
      answer:
        CARD_BILLING
          ? 'Yes. Upgrade any time: the new limit applies straight away and you pay only the difference for the rest of the month. A downgrade starts on your next billing date. Cancel any time; you keep access until the end of the month you have paid for.'
          : 'Yes. Upgrade any time and the new limit applies straight away. Cancel any time; you keep access until the end of the month you have paid for.',
    },
    {
      question: 'Which marketplaces do you support?',
      answer:
        'Takealot first, with Makro, Amazon South Africa, Shopify and WooCommerce following.',
    },
    {
      question: 'Are prices in Rand?',
      answer: 'Yes. All prices are in South African Rand, with no hidden fees.',
    },
  ],
};

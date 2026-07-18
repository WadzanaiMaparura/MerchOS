const painPoints = [
  {
    title: 'Manual Product Listings',
    description: 'Uploading hundreds of products one by one wastes valuable selling time.',
    icon: '⏱️',
  },
  {
    title: 'Supplier Data Is Messy',
    description:
      'Product information arrives as PDFs, WhatsApp images, spreadsheets and inconsistent catalogues.',
    icon: '📋',
  },
  {
    title: 'Marketplace Requirements Keep Changing',
    description:
      'Each marketplace has different formatting, categories and CSV requirements.',
    icon: '🔄',
  },
  {
    title: 'Scaling Requires More People',
    description:
      'Growing your catalogue often means hiring more staff just to manage listings.',
    icon: '👥',
  },
];

const steps = [
  {
    number: '1',
    title: 'Import',
    description: 'Upload supplier catalogues from almost any format — PDFs, images, spreadsheets, WhatsApp.',
  },
  {
    number: '2',
    title: 'Processing',
    description: 'Extract product data, specifications, pricing and images automatically.',
  },
  {
    number: '3',
    title: 'Enrichment',
    description: 'Generate optimised titles, descriptions, attributes and keywords.',
  },
  {
    number: '4',
    title: 'Marketplace Validation',
    description: 'Validate every listing against marketplace rules before publishing.',
  },
  {
    number: '5',
    title: 'Export',
    description: 'Download marketplace-ready CSV files or publish directly to your channels.',
  },
];

const metrics = [
  { value: '80–90%', label: 'Reduction in product listing time' },
  { value: '2,000+', label: 'Products published monthly using the same team' },
  { value: '60–75%', label: 'Lower listing administration costs' },
  { value: '70%', label: 'Fewer upload errors and rejected listings' },
  { value: '~R0.35', label: 'Estimated processing cost per product' },
];

const pricingTiers = [
  {
    name: 'Professional',
    price: 'R499',
    period: '/mo',
    idealFor: 'Independent sellers',
    features: ['10,000 products', '4 channels', '5 team members', '10,000 AI enrichment calls/mo', '5,000 image processing calls/mo', '99.9% SLA'],
    highlighted: true,
    cta: 'Start Free Trial',
    ctaHref: '/register?plan=professional',
  },
  {
    name: 'Business',
    price: 'R999',
    period: '/mo',
    idealFor: 'Teams & agencies',
    features: ['50,000 products', '6 channels', '25 team members', '100,000 AI enrichment calls/mo', '50,000 image processing calls/mo', 'Priority support', 'SAML SSO'],
    highlighted: false,
    cta: 'Start Free Trial',
    ctaHref: '/register?plan=business',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    idealFor: 'Large retailers & distributors',
    features: ['Unlimited products', '6 channels', 'Unlimited team members', 'Custom AI & processing limits', 'Dedicated account manager', 'Custom integrations', 'SLA up to 99.99%'],
    highlighted: false,
    cta: 'Contact Sales',
    ctaHref: '/contact?reason=enterprise',
  },
];

const earlyAccessBenefits = [
  'Founding customer pricing',
  'Priority onboarding',
  'Shape future features',
  'Direct access to the founders',
];

export default function MarketingPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-50 via-white to-primary-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-tight">
              List Multiple Products in a Few Clicks
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              Your suppliers send WhatsApp photos, PDFs, Excel files and messy catalogues.
              MerchOS extracts, enriches information then generates marketplace-ready listings
              and CSV files for Takealot, Amazon, Makro and more.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="#early-access"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Join Early Access
              </a>
              <a
                href="#how-it-works"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Watch Demo
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Transformation Visual */}
      <section className="py-16 sm:py-20 border-y border-gray-100 bg-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-8 items-center">
            {/* Input: Messy supplier data */}
            <div className="text-center md:text-left">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">What you receive</p>
              <div className="flex flex-wrap justify-center md:justify-start gap-2">
                {['Supplier PDFs', 'WhatsApp Images', 'Excel Files', 'Messy Catalogues'].map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm font-medium text-red-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Arrow / transformation */}
            <div className="flex flex-col items-center gap-2 py-4">
              <svg className="w-8 h-8 text-primary-600 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <svg className="w-8 h-8 text-primary-600 md:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            {/* Output: Marketplace-ready */}
            <div className="text-center md:text-right">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">What you get</p>
              <div className="flex flex-wrap justify-center md:justify-end gap-2">
                {['Takealot CSV', 'Amazon Listing', 'Makro Upload', 'Shopify Product', 'WooCommerce'].map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm font-medium text-green-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="py-20 sm:py-28 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              The Problem Every Marketplace Seller Knows
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {painPoints.map((point) => (
              <div
                key={point.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="text-3xl mb-4" aria-hidden="true">
                  {point.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{point.title}</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  {point.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How MerchOS Solves It */}
      <section id="how-it-works" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              How MerchOS Solves It
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              From messy supplier data to marketplace-ready product listings in five steps.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {steps.map((step, idx) => (
              <div key={step.number} className="relative text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary-600 text-white flex items-center justify-center text-lg font-bold mb-4">
                  {step.number}
                </div>
                <h3 className="text-base font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  {step.description}
                </p>
                {/* Connector removed */}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Sellers Choose MerchOS — Quantified Impact */}
      <section className="py-20 sm:py-28 bg-gray-900 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">
              Why Sellers Choose MerchOS
            </h2>
            <p className="mt-4 text-lg text-gray-300">
              We transform messy supplier data into marketplace-ready product data.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8">
            {metrics.map((metric) => (
              <div key={metric.label} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary-400">
                  {metric.value}
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              Professional tools, professional pricing
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Start with a 14-day free trial. No credit card required.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl border p-6 flex flex-col ${
                  tier.highlighted
                    ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-600 shadow-lg'
                    : 'border-gray-200 bg-white shadow-sm'
                }`}
              >
                {tier.highlighted && (
                  <span className="inline-block self-start rounded-full bg-primary-600 px-3 py-0.5 text-xs font-semibold text-white mb-4">
                    Recommended
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{tier.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{tier.idealFor}</p>
                <div className="mt-4 flex items-baseline">
                  <span className="text-3xl font-bold text-gray-900">{tier.price}</span>
                  <span className="text-sm text-gray-500 ml-1">{tier.period}</span>
                </div>
                <ul className="mt-6 space-y-3 flex-1" role="list">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
                      <svg
                        className="w-4 h-4 mt-0.5 text-primary-600 shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href={tier.ctaHref}
                  className={`mt-8 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                    tier.highlighted
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'border border-primary-600 text-primary-600 hover:bg-primary-50'
                  }`}
                >
                  {tier.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Early Access CTA */}
      <section id="early-access" className="py-20 sm:py-28 bg-primary-600">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Join the Early Access Programme
          </h2>
          <p className="mt-4 text-lg text-primary-100">
            Be among the first sellers to transform how you manage marketplace listings.
          </p>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-primary-100">
            {earlyAccessBenefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-primary-200" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {benefit}
              </li>
            ))}
          </ul>
          <a
            href="/register"
            className="mt-10 inline-flex items-center justify-center rounded-lg bg-white px-8 py-3.5 text-base font-semibold text-primary-600 shadow-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-600"
          >
            Get Early Access
          </a>
        </div>
      </section>
    </>
  );
}

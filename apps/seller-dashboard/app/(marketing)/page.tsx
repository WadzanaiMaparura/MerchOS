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
      <section className="py-16 sm:py-24 border-y border-gray-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* 3-column flow: Import → Engine → Publish */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr] gap-6 lg:gap-4 items-start">

            {/* Column 1: Import Your Data */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-primary-700 uppercase tracking-wide">Import Your Data</h3>
                  <p className="text-xs text-gray-500">From any source</p>
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { title: 'Supplier PDFs', desc: 'Catalogues, brochures, product sheets' },
                  { title: 'WhatsApp Images', desc: 'Product photos and information' },
                  { title: 'Excel & CSV Files', desc: 'Spreadsheets and data exports' },
                  { title: 'Product Catalogues', desc: 'Digital or scanned catalogues' },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3 rounded-lg bg-white border border-gray-100 p-3">
                    <div className="w-8 h-8 rounded bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Arrow 1 */}
            <div className="hidden lg:flex items-center justify-center self-center">
              <div className="flex items-center gap-1 text-primary-400">
                <div className="w-8 border-t-2 border-dashed border-primary-300"></div>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            <div className="lg:hidden flex justify-center py-2">
              <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            {/* Column 2: MerchOS Engine */}
            <div className="rounded-2xl border-2 border-primary-200 bg-primary-50/50 p-6">
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-full bg-primary-600 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900">MerchOS Engine</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Reads & extracts data',
                  'Cleans & validates',
                  'Matches categories',
                  'Generates descriptions',
                  'Optimises images',
                  'Formats for marketplaces',
                ].map((step) => (
                  <li key={step} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700 font-medium">{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Arrow 2 */}
            <div className="hidden lg:flex items-center justify-center self-center">
              <div className="flex items-center gap-1 text-primary-400">
                <div className="w-8 border-t-2 border-dashed border-primary-300"></div>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            <div className="lg:hidden flex justify-center py-2">
              <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            {/* Column 3: Ready to Publish */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-green-700 uppercase tracking-wide">Ready to Publish</h3>
                  <p className="text-xs text-gray-500">Export to marketplaces</p>
                </div>
              </div>
              <div className="space-y-3">
                {['Takealot', 'Amazon', 'Makro Marketplace', 'Shopify', 'WooCommerce'].map((marketplace) => (
                  <div
                    key={marketplace}
                    className="flex items-center gap-3 rounded-lg bg-white border border-green-100 px-4 py-3"
                  >
                    <div className="w-8 h-8 rounded bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{marketplace}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Benefits row */}
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-6 border-t border-gray-100 pt-10">
            {[
              { icon: '⏱️', title: 'Save Time', desc: 'Automate hours of manual work' },
              { icon: '✓', title: 'Reduce Errors', desc: 'Clean, accurate product data' },
              { icon: '🌐', title: 'List Everywhere', desc: 'Multiple marketplaces, one click' },
              { icon: '🚀', title: 'Scale Faster', desc: 'More products. More sales.' },
            ].map((benefit) => (
              <div key={benefit.title} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary-50 border border-primary-100 flex items-center justify-center mx-auto mb-3">
                  <span className="text-lg" aria-hidden="true">{benefit.icon}</span>
                </div>
                <h4 className="text-sm font-bold text-gray-900">{benefit.title}</h4>
                <p className="text-xs text-gray-500 mt-1">{benefit.desc}</p>
              </div>
            ))}
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

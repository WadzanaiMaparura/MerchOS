const channels = ['Takealot', 'Amazon', 'Makro', 'Shopify', 'WooCommerce'];

const features = [
  {
    title: 'Product Lifecycle Management',
    description: 'Track products from draft to published across all channels.',
    icon: '📦',
  },
  {
    title: 'AI-Powered Enrichment',
    description: 'Automatically generate titles, descriptions, and attributes.',
    icon: '✨',
  },
  {
    title: 'Multi-Channel Publishing',
    description: 'Publish to Takealot, Amazon, Shopify, and more simultaneously.',
    icon: '🚀',
  },
  {
    title: 'Inventory Sync',
    description: 'Real-time stock levels across all warehouses and channels.',
    icon: '🔄',
  },
  {
    title: 'Compliance Automation',
    description: "Auto-validate against each marketplace's rules before publishing.",
    icon: '✅',
  },
  {
    title: 'Team Collaboration',
    description: 'Role-based access for your whole team (viewer, editor, admin, owner).',
    icon: '👥',
  },
];

const steps = [
  {
    number: '1',
    title: 'Upload your products',
    description: 'Import via CSV or add products manually. We handle the heavy lifting.',
  },
  {
    number: '2',
    title: 'AI enriches and validates',
    description:
      'Our AI generates optimised titles, descriptions, and attributes — then validates against marketplace rules.',
  },
  {
    number: '3',
    title: 'Publish everywhere in one click',
    description:
      'Push your enriched listings to all connected channels simultaneously. Done.',
  },
];

const pricingTiers = [
  {
    name: 'Starter',
    price: 'R499',
    period: '/mo',
    description: 'For sellers getting started with multi-channel.',
    features: ['100 products', '2 channels', '1 user', 'Email support'],
    highlighted: false,
  },
  {
    name: 'Growth',
    price: 'R999',
    period: '/mo',
    description: 'For growing businesses scaling their reach.',
    features: ['1,000 products', '4 channels', '5 users', 'Priority support'],
    highlighted: false,
  },
  {
    name: 'Professional',
    price: 'R2,499',
    period: '/mo',
    description: 'For established sellers managing large catalogues.',
    features: ['10,000 products', 'All channels', '15 users', 'Dedicated account manager'],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large operations with bespoke requirements.',
    features: ['Unlimited products', 'All channels', 'Unlimited users', 'Dedicated support & SLA'],
    highlighted: false,
  },
];

export default function MarketingPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-50 via-white to-primary-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-tight">
              Manage your products across every marketplace —{' '}
              <span className="text-primary-600">from one dashboard</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              MerchOS helps South African sellers list, enrich, and publish products to Takealot,
              Amazon, Shopify, and more. AI-powered enrichment. Automated compliance. Zero
              spreadsheets.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/register"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Start Free Trial
              </a>
              <a
                href="#how-it-works"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                See How It Works
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By / Channels Section */}
      <section className="border-y border-gray-100 bg-gray-50/50 py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-medium text-gray-500 uppercase tracking-wider mb-6">
            Publish to all major marketplaces
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            {channels.map((channel) => (
              <span
                key={channel}
                className="inline-flex items-center rounded-full bg-white border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 shadow-sm"
              >
                {channel}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              Everything you need to sell everywhere
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              From product creation to multi-channel publishing — MerchOS handles it all.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-3xl mb-4" aria-hidden="true">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 sm:py-28 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              How it works
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Go from spreadsheet chaos to multi-channel selling in three simple steps.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {steps.map((step) => (
              <div key={step.number} className="text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-primary-600 text-white flex items-center justify-center text-xl font-bold mb-6">
                  {step.number}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-3 text-sm text-gray-600 leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Start free for 14 days. No credit card required.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                    Most Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{tier.name}</h3>
                <div className="mt-3 flex items-baseline">
                  <span className="text-3xl font-bold text-gray-900">{tier.price}</span>
                  <span className="text-sm text-gray-500 ml-1">{tier.period}</span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{tier.description}</p>
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
                  href="/register"
                  className={`mt-8 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                    tier.highlighted
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'border border-primary-600 text-primary-600 hover:bg-primary-50'
                  }`}
                >
                  Start Free Trial
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial / Social Proof */}
      <section className="py-16 sm:py-20 bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <blockquote>
            <p className="text-xl sm:text-2xl font-medium text-gray-900 italic leading-relaxed">
              &ldquo;MerchOS saved us 20 hours a week managing listings across Takealot and
              Shopify. The AI enrichment is a game-changer for our catalogue.&rdquo;
            </p>
            <footer className="mt-6">
              <p className="text-base font-semibold text-gray-900">Sarah M.</p>
              <p className="text-sm text-gray-500">E-commerce Manager, Cape Town</p>
            </footer>
          </blockquote>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-28 bg-primary-600">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Ready to streamline your marketplace operations?
          </h2>
          <p className="mt-4 text-lg text-primary-100">
            Join hundreds of South African sellers managing products smarter with MerchOS.
          </p>
          <a
            href="/register"
            className="mt-8 inline-flex items-center justify-center rounded-lg bg-white px-8 py-3.5 text-base font-semibold text-primary-600 shadow-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-600"
          >
            Start Free Trial
          </a>
        </div>
      </section>
    </>
  );
}

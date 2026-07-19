const plans = [
  {
    name: 'Starter',
    description: 'Perfect for new sellers',
    price: 'R499',
    period: '/month',
    cta: 'Start Free Trial',
    ctaHref: '/register?plan=starter',
    highlighted: false,
  },
  {
    name: 'Growth',
    description: 'For growing businesses',
    price: 'R999',
    period: '/month',
    cta: 'Start Free Trial',
    ctaHref: '/register?plan=growth',
    highlighted: true,
    badge: 'Most Popular',
  },
  {
    name: 'Pro',
    description: 'For serious sellers',
    price: 'R1,999',
    period: '/month',
    cta: 'Start Free Trial',
    ctaHref: '/register?plan=pro',
    highlighted: false,
  },
  {
    name: 'Enterprise',
    description: 'For large businesses',
    price: 'Custom',
    period: '',
    cta: 'Contact Sales',
    ctaHref: '/contact?reason=enterprise',
    highlighted: false,
  },
];

const includedFeatures = [
  'Product Studio',
  'Marketplace Validation',
  'Exports & Integrations',
  'Email & Chat Support',
];

export default function PricingSection() {
  return (
    <section id="pricing" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
            Simple, Transparent Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Choose the plan that grows with you
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 items-start">
          {/* Plan cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-6 flex flex-col transition-transform duration-250 hover:-translate-y-1 ${
                  plan.highlighted
                    ? 'border-2 border-blue-600 bg-white shadow-lg shadow-blue-100/50 ring-1 ring-blue-600/10'
                    : 'border border-gray-200 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)]'
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-block rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white whitespace-nowrap">
                    {plan.badge}
                  </span>
                )}

                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{plan.description}</p>

                <div className="mt-5 flex items-baseline">
                  <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                  {plan.period && (
                    <span className="text-sm text-gray-500 ml-1">{plan.period}</span>
                  )}
                </div>

                <a
                  href={plan.ctaHref}
                  className={`mt-6 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-all hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    plan.highlighted
                      ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>

          {/* All plans include */}
          <div className="lg:max-w-xs">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">All plans include:</h3>
            <ul className="space-y-3">
              {includedFeatures.map((feature) => (
                <li key={feature} className="flex items-center gap-2.5 text-sm text-gray-600">
                  <svg
                    className="w-4 h-4 text-green-500 shrink-0"
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
          </div>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useState } from 'react';

// ─── Data ────────────────────────────────────────────────────────────────────

const manualProcess = [
  'Supplier PDFs, WhatsApp images, Excel files',
  'Hours spent cleaning and formatting data',
  'Inconsistent product descriptions and titles',
  'High listing rejection rates',
  'Manual CSV creation and uploads',
  'Lost sales and wasted time',
];

const automatedProcess = [
  'Automated import from any supplier format',
  'Data processed and structured in seconds',
  'MerchOS Enhancement for clean, consistent data',
  'Marketplace Validation to ensure compliance',
  'Export ready listings for any marketplace',
  'More sales, less effort, business growth',
];

const features = [
  {
    title: 'Product Studio',
    description: 'Create stunning titles, descriptions and images in minutes.',
  },
  {
    title: 'Bulk Listing Creation',
    description: 'Generate hundreds of listings in just a few clicks.',
  },
  {
    title: 'Marketplace Ready',
    description: 'Compliant listings that pass validation every time.',
  },
];

const testimonials = [
  {
    name: 'Lerato M.',
    category: 'Electronics Seller',
    quote: 'MerchOS has saved me more than 40 hours every week. What used to take days now takes minutes.',
    initials: 'LM',
    color: 'bg-blue-500',
  },
  {
    name: 'Sipho D.',
    category: 'Home & Kitchen Seller',
    quote: 'The descriptions and images are amazing! My listings look professional and sell better.',
    initials: 'SD',
    color: 'bg-green-500',
  },
  {
    name: 'Nicole R.',
    category: 'Beauty Seller',
    quote: 'Fewer rejections, more sales. MerchOS is now our secret weapon.',
    initials: 'NR',
    color: 'bg-purple-500',
  },
  {
    name: 'Jason R.',
    category: 'Sports & Outdoors Seller',
    quote: 'Finally, a tool built for Takealot sellers. The support is incredible too!',
    initials: 'JR',
    color: 'bg-orange-500',
  },
];

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

// ─── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon({ className = 'w-4 h-4 text-green-500' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="ml-2 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="mr-2 w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ─── Feature Icons ───────────────────────────────────────────────────────────

function ProductStudioIcon() {
  return (
    <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function BulkListingIcon() {
  return (
    <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  );
}

function MarketplaceReadyIcon() {
  return (
    <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

const featureIcons = [ProductStudioIcon, BulkListingIcon, MarketplaceReadyIcon];

// ─── Page Component ──────────────────────────────────────────────────────────

export default function MarketingPage() {
  return (
    <>
      <HeroSection />
      <WorkflowSection />
      <FeaturesSection />
      <TestimonialsSection />
      <PricingSection />
    </>
  );
}

// ─── Hero Section ────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left column */}
          <div className="animate-fadeIn">
            <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
              Built for Marketplace Sellers
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-[1.1]">
              Marketplace Automation,{'\n'}
              Engineered for{'\n'}
              <span className="text-blue-600">Accuracy &amp; Speed.</span>
            </h1>

            <p className="mt-6 text-lg text-gray-600 leading-relaxed max-w-xl">
              Transform supplier catalogues into marketplace-ready listings
              through an intelligent automated workflow.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row items-start gap-4">
              <a
                href="/register"
                className="inline-flex items-center rounded-full bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Start Free Trial
                <ArrowRightIcon />
              </a>
              <a
                href="#demo"
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <PlayIcon />
                Watch Demo
              </a>
            </div>

            {/* Trust indicators */}
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
              {['Save 40+ hours every week', 'Reduce listing rejections', 'Scale your business faster'].map((text) => (
                <span key={text} className="flex items-center gap-1.5">
                  <CheckIcon />
                  {text}
                </span>
              ))}
            </div>

            {/* Social proof */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2">
                {[
                  { color: 'bg-blue-500', initials: 'LM' },
                  { color: 'bg-green-500', initials: 'SD' },
                  { color: 'bg-purple-500', initials: 'NR' },
                  { color: 'bg-orange-500', initials: 'JR' },
                ].map((avatar) => (
                  <div
                    key={avatar.initials}
                    className={`w-8 h-8 rounded-full ${avatar.color} border-2 border-white flex items-center justify-center`}
                  >
                    <span className="text-[10px] font-bold text-white">{avatar.initials}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <StarIcon key={i} />
                ))}
              </div>
              <span className="text-sm text-gray-500">Trusted by marketplace sellers across South Africa</span>
            </div>

            {/* Works with */}
            <div className="mt-8 pt-6 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-3">Works with</p>
              <div className="flex flex-wrap items-center gap-4">
                {['Takealot', 'Amazon', 'Makro', 'Shopify', 'WooCommerce'].map((name) => (
                  <span
                    key={name}
                    className="text-sm font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right column - Dashboard mockup */}
          <div className="relative hidden lg:block">
            {/* Blue glow */}
            <div className="absolute inset-0 bg-blue-400/20 rounded-full blur-[80px] scale-75" aria-hidden="true" />

            {/* Dashboard card with float animation */}
            <div className="relative animate-float">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Dashboard Mockup ────────────────────────────────────────────────────────

function DashboardMockup() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="w-3 h-3 rounded-full bg-red-400" />
        <div className="w-3 h-3 rounded-full bg-yellow-400" />
        <div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-3 text-xs text-gray-400 font-medium">MerchOS Dashboard</span>
      </div>

      {/* Dashboard body */}
      <div className="flex">
        {/* Sidebar */}
        <div className="w-14 bg-gray-900 p-2 space-y-3 hidden sm:block">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-xs">M</span>
          </div>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-8 h-8 rounded-lg bg-gray-700/50 mx-auto" />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 p-4 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Products</p>
              <p className="text-lg font-bold text-gray-900">2,847</p>
              <p className="text-[10px] text-green-600 font-medium">+12% this week</p>
            </div>
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Published</p>
              <p className="text-lg font-bold text-gray-900">2,651</p>
              <p className="text-[10px] text-green-600 font-medium">93% success</p>
            </div>
            <div className="rounded-xl bg-purple-50 p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Time Saved</p>
              <p className="text-lg font-bold text-gray-900">42hrs</p>
              <p className="text-[10px] text-green-600 font-medium">this week</p>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-semibold text-gray-700 mb-2">Recent Imports</p>
            <div className="space-y-2">
              {[
                { name: 'Samsung_Catalogue.pdf', status: 'Processed', color: 'bg-green-100 text-green-700' },
                { name: 'Supplier_Pricing.xlsx', status: 'Enriching', color: 'bg-blue-100 text-blue-700' },
                { name: 'WhatsApp_Products.zip', status: 'Validating', color: 'bg-yellow-100 text-yellow-700' },
              ].map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 truncate">{item.name}</span>
                  <span className={`px-2 py-0.5 rounded-full font-medium ${item.color}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Mini chart */}
          <div className="rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-semibold text-gray-700 mb-2">Listings This Month</p>
            <div className="flex items-end gap-1 h-12">
              {[40, 55, 35, 70, 60, 85, 75, 90, 80, 95, 88, 100].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-blue-200 rounded-t"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Workflow Section ────────────────────────────────────────────────────────

function WorkflowSection() {
  return (
    <section id="how-it-works" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
            Workflow Transformation
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Manual Process <span className="text-gray-400">→</span> Automated Process
          </h2>
        </div>

        {/* Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-12 items-start">
          {/* Manual Process */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Manual Process</h3>
            <ul className="space-y-4">
              {manualProcess.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <XIcon />
                  <span className="text-sm text-gray-600">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Center divider with logo */}
          <div className="hidden lg:flex flex-col items-center justify-center self-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">M</span>
            </div>
            <div className="flex items-center gap-1 text-blue-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeDasharray="4 3" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </div>

          {/* Mobile arrow */}
          <div className="lg:hidden flex justify-center">
            <div className="flex items-center gap-2 text-blue-400">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>

          {/* MerchOS Workflow */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <h3 className="text-lg font-bold text-gray-900 mb-6">MerchOS Workflow</h3>
            <ul className="space-y-4">
              {automatedProcess.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckIcon className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Features Section ────────────────────────────────────────────────────────

function FeaturesSection() {
  return (
    <section className="py-24 sm:py-32 bg-gray-50/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-12 lg:gap-16 items-center">
          {/* Left text */}
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">
              Everything you need to scale your Takealot business
            </h2>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {features.map((feature, idx) => {
              const Icon = featureIcons[idx]!;
              return (
                <div
                  key={feature.title}
                  className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 hover:-translate-y-1 hover:shadow-md transition-all duration-[250ms]"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                    <Icon />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Testimonials Section ────────────────────────────────────────────────────

function TestimonialsSection() {
  const [activeIndex, setActiveIndex] = useState(0);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev === 0 ? testimonials.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev === testimonials.length - 1 ? 0 : prev + 1));
  };

  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
            Trusted by Sellers
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Real results from real sellers
          </h2>
        </div>

        {/* Testimonial cards */}
        <div className="relative">
          {/* Desktop grid */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {testimonials.map((testimonial) => (
              <TestimonialCard key={testimonial.name} testimonial={testimonial} />
            ))}
          </div>

          {/* Mobile carousel */}
          <div className="md:hidden">
            <TestimonialCard testimonial={testimonials[activeIndex]!} />
          </div>

          {/* Navigation arrows */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={handlePrev}
              className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors"
              aria-label="Previous testimonial"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {/* Mobile dots */}
            <div className="flex md:hidden gap-2">
              {testimonials.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === activeIndex ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={handleNext}
              className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors"
              aria-label="Next testimonial"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ testimonial }: { testimonial: (typeof testimonials)[number] }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 hover:-translate-y-1 hover:shadow-md transition-all duration-[250ms]">
      {/* Stars */}
      <div className="flex gap-0.5 mb-4">
        {[...Array(5)].map((_, i) => (
          <StarIcon key={i} />
        ))}
      </div>

      {/* Quote */}
      <p className="text-sm text-gray-600 leading-relaxed mb-6">
        &ldquo;{testimonial.quote}&rdquo;
      </p>

      {/* Author */}
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-full ${testimonial.color} flex items-center justify-center`}>
          <span className="text-[11px] font-bold text-white">{testimonial.initials}</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{testimonial.name}</p>
          <p className="text-xs text-gray-500">{testimonial.category}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Pricing Section ─────────────────────────────────────────────────────────

function PricingSection() {
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
                className={`relative rounded-2xl p-6 flex flex-col hover:-translate-y-1 hover:shadow-md transition-all duration-[250ms] ${
                  plan.highlighted
                    ? 'border-2 border-blue-600 bg-white/80 backdrop-blur-sm shadow-lg shadow-blue-100/50 ring-1 ring-blue-600/10'
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
                  <CheckIcon />
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

'use client';

import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

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
    category: 'Electronics',
    quote: 'MerchOS has saved me more than 40 hours every week. What used to take days now takes minutes.',
    imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=64&h=64&fit=crop&crop=face',
  },
  {
    name: 'Sipho D.',
    category: 'Home & Kitchen',
    quote: 'The descriptions and images are amazing! My listings look professional and sell better.',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=64&h=64&fit=crop&crop=face',
  },
  {
    name: 'Nicole B.',
    category: 'Beauty',
    quote: 'Fewer rejections, more sales. MerchOS is now our secret weapon.',
    imageUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=64&h=64&fit=crop&crop=face',
  },
  {
    name: 'Jason R.',
    category: 'Sports & Outdoors',
    quote: 'Finally, a tool built for Takealot sellers. The support is incredible too!',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=64&h=64&fit=crop&crop=face',
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

// ─── Customer Review Stack (data-driven, future backend integration) ─────────

interface CustomerReview {
  id: string;
  name: string;
  company?: string;
  imageUrl: string;
  rating: number;
}

const customerReviews: CustomerReview[] = [
  { id: '1', name: 'Thandi K.', company: 'TK Electronics', imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face', rating: 5 },
  { id: '2', name: 'Michael N.', company: 'MN Traders', imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face', rating: 5 },
  { id: '3', name: 'Lerato M.', company: 'LM Store', imageUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=face', rating: 5 },
  { id: '4', name: 'David P.', company: 'DP Solutions', imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&crop=face', rating: 5 },
  { id: '5', name: 'Sarah J.', company: 'SJ Lifestyle', imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face', rating: 5 },
];

function CustomerReviewStack({ reviews }: { reviews: CustomerReview[] }) {
  return (
    <div className="flex items-center gap-4">
      {/* Overlapping avatars */}
      <div className="flex -space-x-2.5">
        {reviews.slice(0, 5).map((review) => (
          <img
            key={review.id}
            src={review.imageUrl}
            alt={review.name}
            className="w-9 h-9 rounded-full border-2 border-white object-cover shadow-sm"
          />
        ))}
      </div>

      {/* Rating and trust text */}
      <div>
        <div className="flex items-center gap-1">
          {[...Array(5)].map((_, i) => (
            <StarIcon key={i} />
          ))}
          <span className="text-sm font-semibold text-gray-700 ml-1.5">5.0</span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Trusted by marketplace sellers across South Africa</p>
      </div>
    </div>
  );
}

// ─── Hero Section ────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative overflow-x-clip pt-12 pb-10 sm:pt-16 sm:pb-14 lg:pt-16 lg:pb-16 bg-white">
      {/* Subtle background glow on right side */}
      <div className="absolute top-0 right-0 w-[60%] h-full bg-gradient-to-bl from-[#eef5ff]/60 via-[#f4f8ff]/30 to-transparent pointer-events-none" aria-hidden="true" />

      <div className="relative mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16">
        <div className="grid grid-cols-1 lg:grid-cols-[48%_52%] gap-8 lg:gap-0 items-start">
          {/* Left column */}
          <div className="animate-fadeIn">
            <span className="inline-block text-[13px] uppercase tracking-[0.16em] text-[#2563EB] font-bold mb-4">
              Built for Marketplace Sellers
            </span>

            <h1 className="text-[28px] sm:text-[34px] lg:text-[40px] xl:text-[46px] font-extrabold tracking-[-1px] text-[#111827] leading-[1.05]">
              Marketplace Automation,<br />
              Engineered for<br />
              <span className="text-[#2563EB]">Accuracy &amp; Speed.</span>
            </h1>

            <p className="mt-6 text-[15px] sm:text-[17px] font-normal text-[#4B5563] leading-[1.7] max-w-[520px]">
              Transform supplier catalogues into marketplace-ready listings
              through an intelligent automated workflow.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row items-start gap-4">
              <a
                href="/register"
                className="inline-flex items-center rounded-xl bg-[#2563EB] px-6 py-3.5 text-[15px] font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Start Free Trial
                <ArrowRightIcon />
              </a>
              <a
                href="#demo"
                className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-6 py-3.5 text-[15px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Watch Demo
                <svg className="ml-2 w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </a>
            </div>

            {/* Trust indicators */}
            <div className="mt-8 flex items-center gap-x-6 text-[13px] font-normal text-[#4B5563]">
              {['Save 40+ hours every week', 'Reduce listing rejections', 'Scale your business faster'].map((text) => (
                <span key={text} className="flex items-center gap-1.5 whitespace-nowrap">
                  <svg className="w-[18px] h-[18px] text-[#2563EB] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {text}
                </span>
              ))}
            </div>

            {/* Customer trust section */}
            <div className="mt-10">
              <CustomerReviewStack reviews={customerReviews} />
            </div>

            {/* Works with */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-[9px] text-gray-400 uppercase tracking-[0.15em] font-medium mb-2">Works with</p>
              <div className="flex items-center gap-4 sm:gap-5">
                {/* Takealot */}
                <span className="flex items-center gap-0.5 text-[13px] font-bold text-[#0b2239] tracking-tight">
                  takealot
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#0b79bf] text-[5px] font-bold text-white leading-none">.com</span>
                </span>
                {/* Amazon */}
                <span className="relative text-[13px] font-bold text-[#232f3e] tracking-tight">
                  amazon
                  <svg className="absolute -bottom-0.5 left-1 w-8 h-2" viewBox="0 0 60 12" fill="none" aria-hidden="true">
                    <path d="M2 8 Q30 12 58 4" stroke="#FF9900" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                    <path d="M52 2 L58 4 L54 7" fill="#FF9900" />
                  </svg>
                </span>
                {/* Makro */}
                <span className="flex items-center text-[13px] font-bold text-[#1a1a1a] tracking-tight">
                  makro
                  <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M4 10 L8 14 L16 6" stroke="#e21b1b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {/* Shopify */}
                <span className="flex items-center gap-0.5 text-[13px] font-bold text-[#5c8a3c] tracking-tight">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="2" width="16" height="20" rx="4" fill="#95bf47" />
                    <text x="12" y="16" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="sans-serif">S</text>
                  </svg>
                  shopify
                </span>
                {/* WooCommerce */}
                <span className="flex items-center gap-0.5 text-[11px] font-bold text-[#7f54b3] tracking-wide uppercase">
                  <svg className="w-4 h-4" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                    <rect x="2" y="6" width="24" height="16" rx="4" fill="#7f54b3" />
                    <text x="14" y="17" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">Woo</text>
                  </svg>
                  Commerce
                </span>
              </div>
            </div>
          </div>

          {/* Right column - Dashboard mockup */}
          <div className="relative hidden lg:block self-start -mt-4 -mr-12 xl:-mr-20" style={{ perspective: '1800px' }}>
            {/* Subtle blue ambient glow */}
            <div className="absolute -inset-8 bg-blue-400/8 rounded-[40px] blur-[80px]" aria-hidden="true" />

            {/* Dashboard with 3D perspective transform — CSS blend to hide background */}
            <div
              className="relative ml-auto w-full scale-110 xl:scale-115 animate-float"
              style={{
                transform: 'rotateY(-8deg) rotateX(3deg) translateX(20px) translateY(-10px)',
                transformStyle: 'preserve-3d',
                transformOrigin: 'center center',
              }}
            >
              <img
                src="/dashboard-hero.png"
                alt="MerchOS Dashboard — Products processed, listings created, success rate, listing performance chart, top categories, recent imports, processing overview"
                className="w-full h-auto drop-shadow-[0_20px_60px_rgba(37,99,235,0.12)]"
                width={900}
                height={620}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Workflow Section ────────────────────────────────────────────────────────

const listingPerfData = [
  { day: 'Tue', value: 30 },
  { day: 'Wed', value: 38 },
  { day: 'Thu', value: 25 },
  { day: 'Fri', value: 45 },
  { day: 'Sat', value: 52 },
  { day: 'Sun', value: 60 },
  { day: 'Mon', value: 72 },
];

const donutData = [
  { name: 'Completed', value: 98.6 },
  { name: 'Processing', value: 1.1 },
  { name: 'Failed', value: 0.3 },
];
const donutColors = ['#22c55e', '#3b82f6', '#ef4444'];

const navItems = [
  {
    label: 'Dashboard', active: true,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6" /></svg>,
  },
  {
    label: 'Products', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>,
  },
  {
    label: 'Suppliers', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg>,
  },
  {
    label: 'Imports', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>,
  },
  {
    label: 'Enhancement', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  },
  {
    label: 'Listings', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  },
  {
    label: 'Exports', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>,
  },
  {
    label: 'Reports', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  },
  {
    label: 'Settings', active: false,
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  },
];

function DashboardMockup() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden" style={{ fontSize: '12px' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-[11px] text-gray-500 font-medium">MerchOS Dashboard</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
          </div>
          <div className="w-7 h-7 rounded-full overflow-hidden border-2 border-white shadow-sm">
            <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=48&h=48&fit=crop&crop=face" alt="Wadzanai M." className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-800 leading-none">Wadzanai M.</p>
            <p className="text-[10px] text-gray-400 leading-none mt-0.5">Seller Plan ↓</p>
          </div>
        </div>
      </div>

      {/* Dashboard body */}
      <div className="flex">
        {/* Sidebar */}
        <div className="w-[180px] bg-[#1e293b] py-4 px-2.5 space-y-0.5 shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2 px-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-[13px]">M</span>
            </div>
            <span className="text-[13px] font-bold text-white">MerchOS</span>
          </div>
          {/* Nav items */}
          {navItems.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg ${
                item.active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <span className={item.active ? 'text-white' : 'text-gray-500'}>{item.icon}</span>
              <span className="text-[11px] font-medium">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-4 space-y-3 bg-white min-w-0">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Products Processed', value: '12,540', trend: '+24% vs last week', trendColor: 'text-green-600' },
              { label: 'Listings Created', value: '8,742', trend: '+18% vs last week', trendColor: 'text-green-600' },
              { label: 'Success Rate', value: '98.6%', trend: '+2.1% vs last week', trendColor: 'text-green-600' },
              { label: 'Hours Saved', value: '320+', trend: 'This Week', trendColor: 'text-gray-400' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white p-3 border border-gray-200 shadow-sm">
                <p className="text-[10px] text-gray-500 font-medium">{stat.label}</p>
                <p className="text-[18px] font-bold text-gray-900 mt-0.5 leading-tight">{stat.value}</p>
                <p className={`text-[10px] font-medium mt-1 ${stat.trendColor}`}>{stat.trend}</p>
              </div>
            ))}
          </div>

          {/* Row 2 — Chart + Categories */}
          <div className="grid gap-3" style={{ gridTemplateColumns: '65% 35%' }}>
            {/* Listing Performance Area Chart */}
            <div className="rounded-xl bg-white p-3 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-semibold text-gray-800">Listing Performance</p>
                <span className="flex items-center gap-0.5 text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                  Last 7 days
                  <svg className="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={listingPerfData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#9ca3af' }} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#9ca3af' }} width={28} />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fill="url(#areaGrad)" dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Top Categories */}
            <div className="rounded-xl bg-white p-3 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-semibold text-gray-800">Top Categories</p>
                <span className="text-[11px] text-blue-600 cursor-pointer font-medium">View all</span>
              </div>
              <div className="space-y-2.5">
                {[
                  { name: 'Electronics', count: '2,340' },
                  { name: 'Home & Kitchen', count: '1,670' },
                  { name: 'Beauty', count: '1,240' },
                  { name: 'Toys', count: '980' },
                  { name: 'Sports', count: '880' },
                ].map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-600">{cat.name}</span>
                    <span className="text-[11px] font-semibold text-gray-800">{cat.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 3 — Imports + Processing Overview */}
          <div className="grid gap-3" style={{ gridTemplateColumns: '65% 35%' }}>
            {/* Recent Imports */}
            <div className="rounded-xl bg-white p-3 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-[13px] font-semibold text-gray-800">Recent Imports</p>
                <span className="text-[11px] text-blue-600 cursor-pointer font-medium">View all imports →</span>
              </div>
              <div className="space-y-2">
                {[
                  {
                    name: 'Supplier_Catalog_Jun.pdf', count: '1,385', status: 'Completed', time: '2 min ago',
                    statusBg: 'bg-green-50 text-green-700',
                    icon: <svg className="w-5 h-5 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 17v-1h8v1H8zm0-3v-1h8v1H8zm0-3V9.5h3V11H8z" /></svg>,
                  },
                  {
                    name: 'WhatsApp_Images.zip', count: '842', status: 'Completed', time: '15 min ago',
                    statusBg: 'bg-green-50 text-green-700',
                    icon: <svg className="w-5 h-5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM7 13h2v2H7v-2zm0-3h10v1H7v-1zm0 6h10v1H7v-1z" /></svg>,
                  },
                  {
                    name: 'supplier_prices.xlsx', count: '—', status: 'Processing', time: '—',
                    statusBg: 'bg-blue-50 text-blue-700',
                    icon: <svg className="w-5 h-5 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 17v-1.5l3-1.5-3-1.5V11l5 2.5-5 2.5z" /></svg>,
                  },
                  {
                    name: 'supplier_product_list.csv', count: '1,902', status: 'Completed', time: '1 hr ago',
                    statusBg: 'bg-green-50 text-green-700',
                    icon: <svg className="w-5 h-5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM7 11h10v1H7v-1zm0 3h10v1H7v-1zm0 3h7v1H7v-1z" /></svg>,
                  },
                ].map((item) => (
                  <div key={item.name} className="flex items-center gap-2.5">
                    {item.icon}
                    <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0">{item.name}</span>
                    <span className="text-[11px] text-gray-500 w-10 text-right shrink-0">{item.count}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${item.statusBg}`}>{item.status}</span>
                    <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Processing Overview Donut */}
            <div className="rounded-xl bg-white p-3 border border-gray-200 shadow-sm flex flex-col">
              <p className="text-[13px] font-semibold text-gray-800 mb-2">Processing Overview</p>
              <div className="flex items-center justify-center flex-1">
                <div className="relative">
                  <ResponsiveContainer width={96} height={96}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={28}
                        outerRadius={40}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {donutData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={donutColors[index]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[12px] font-bold text-gray-900 leading-none">98.6%</span>
                    <span className="text-[9px] text-gray-400 leading-none mt-0.5">Success Rate</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-center gap-3 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span className="text-[9px] text-gray-500">Completed 98.6%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <span className="text-[9px] text-gray-500">Processing 1.1%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span className="text-[9px] text-gray-500">Failed 0.3%</span>
                </div>
              </div>
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
    <section id="how-it-works" className="py-8 sm:py-12">
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-16">
        {/* Header */}
        <div className="text-center mb-6">
          <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
            Workflow Transformation
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Manual Process <span className="text-blue-600">→</span> Automated Process
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

          {/* Center divider with logo and dashed arrows */}
          <div className="hidden lg:flex flex-col items-center justify-center self-center gap-3">
            <svg className="w-8 h-8 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeDasharray="3 3" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">M</span>
            </div>
            <svg className="w-8 h-8 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeDasharray="3 3" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
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
                  <CheckIcon className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
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
    <section className="py-8 sm:py-12 bg-gray-50/50">
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-16">
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
    <section className="py-8 sm:py-12">
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-16">
        {/* Header */}
        <div className="text-center mb-6">
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
      {/* Quote */}
      <p className="text-sm text-gray-600 leading-relaxed mb-4">
        &ldquo;{testimonial.quote}&rdquo;
      </p>

      {/* Stars */}
      <div className="flex gap-0.5 mb-4">
        {[...Array(5)].map((_, i) => (
          <StarIcon key={i} />
        ))}
      </div>

      {/* Author */}
      <div className="flex items-center gap-3">
        <img
          src={testimonial.imageUrl}
          alt={testimonial.name}
          className="w-9 h-9 rounded-full object-cover border border-gray-100"
        />
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
    <section id="pricing" className="py-8 sm:py-12">
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-16">
        {/* Header */}
        <div className="text-center mb-6">
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

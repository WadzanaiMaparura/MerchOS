'use client';

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

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
    initials: 'LM',
    color: 'bg-blue-500',
  },
  {
    name: 'Sipho D.',
    category: 'Home & Kitchen',
    quote: 'The descriptions and images are amazing! My listings look professional and sell better.',
    initials: 'SD',
    color: 'bg-green-500',
  },
  {
    name: 'Nicole B.',
    category: 'Beauty',
    quote: 'Fewer rejections, more sales. MerchOS is now our secret weapon.',
    initials: 'NB',
    color: 'bg-purple-500',
  },
  {
    name: 'Jason R.',
    category: 'Sports & Outdoors',
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
    <section className="relative overflow-x-clip pt-10 pb-24 sm:pt-14 sm:pb-32 lg:pt-16 lg:pb-40 bg-gradient-to-b from-white via-[#f0f6ff]/40 to-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left column */}
          <div className="animate-fadeIn">
            <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
              Built for Marketplace Sellers
            </span>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-extrabold tracking-tight text-[#0f172a] leading-[1.1]">
              Marketplace Automation,<br />
              Engineered for<br />
              <span className="text-blue-600">Accuracy &amp; Speed.</span>
            </h1>

            <p className="mt-8 text-lg sm:text-xl text-gray-600 leading-relaxed max-w-xl">
              Transform supplier catalogues into marketplace-ready listings
              through an intelligent automated workflow.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row items-start gap-5">
              <a
                href="/register"
                className="inline-flex items-center rounded-xl bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Start Free Trial
                <ArrowRightIcon />
              </a>
              <a
                href="#demo"
                className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-8 py-4 text-lg font-semibold text-gray-700 shadow-sm hover:bg-gray-50 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Watch Demo
                <svg className="ml-2 w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </a>
            </div>

            {/* Trust indicators */}
            <div className="mt-10 flex items-center gap-x-6 text-xs sm:text-sm text-gray-600">
              {['Save 40+ hours every week', 'Reduce listing rejections', 'Scale your business faster'].map((text) => (
                <span key={text} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                  {text}
                </span>
              ))}
            </div>

            {/* Customer trust section */}
            <div className="mt-10">
              <CustomerReviewStack reviews={customerReviews} />
            </div>

            {/* Works with */}
            <div className="mt-10 pt-8 border-t border-gray-100">
              <p className="text-[11px] text-gray-400 uppercase tracking-widest font-medium mb-4">Works with</p>
              <div className="flex flex-wrap items-center gap-8 sm:gap-10">
                {/* Takealot */}
                <span className="flex items-center gap-1 text-xl font-bold text-[#0b2239] tracking-tight">
                  takealot
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#0b79bf] text-[8px] font-bold text-white leading-none">.com</span>
                </span>
                {/* Amazon */}
                <span className="relative text-xl font-bold text-[#232f3e] tracking-tight">
                  amazon
                  <svg className="absolute -bottom-1 left-2 w-14 h-3" viewBox="0 0 60 12" fill="none" aria-hidden="true">
                    <path d="M2 8 Q30 12 58 4" stroke="#FF9900" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                    <path d="M52 2 L58 4 L54 7" fill="#FF9900" />
                  </svg>
                </span>
                {/* Makro */}
                <span className="flex items-center text-xl font-bold text-[#1a1a1a] tracking-tight">
                  makro
                  <svg className="w-5 h-5 ml-0.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M4 10 L8 14 L16 6" stroke="#e21b1b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {/* Shopify */}
                <span className="flex items-center gap-1.5 text-xl font-bold text-[#5c8a3c] tracking-tight">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="2" width="16" height="20" rx="4" fill="#95bf47" />
                    <text x="12" y="16" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="sans-serif">S</text>
                  </svg>
                  shopify
                </span>
                {/* WooCommerce */}
                <span className="flex items-center gap-1 text-lg font-bold text-[#7f54b3] tracking-wide uppercase">
                  <svg className="w-7 h-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                    <rect x="2" y="6" width="24" height="16" rx="4" fill="#7f54b3" />
                    <text x="14" y="17" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">Woo</text>
                  </svg>
                  Commerce
                </span>
              </div>
            </div>
          </div>

          {/* Right column - Dashboard mockup */}
          <div className="relative hidden lg:block">
            {/* Subtle blue ambient glow */}
            <div className="absolute -inset-4 bg-blue-500/10 rounded-3xl blur-[60px]" aria-hidden="true" />

            {/* Dashboard with premium positioning */}
            <div className="relative animate-float transform rotate-[1.5deg] scale-[0.92] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] rounded-2xl">
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
    <div className="rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden text-[11px]">
      {/* Top bar with user */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-[10px] text-gray-400 font-medium">MerchOS Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Notification bell */}
          <div className="relative">
            <svg className="w-[14px] h-[14px] text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
          </div>
          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
            <span className="text-[8px] font-bold text-white">WM</span>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold text-gray-700 leading-none">Wadzanai M.</p>
            <p className="text-[8px] text-gray-400 leading-none mt-0.5">Seller Plan</p>
          </div>
        </div>
      </div>

      {/* Dashboard body */}
      <div className="flex">
        {/* Sidebar */}
        <div className="w-[140px] bg-[#1e293b] py-3 px-2 space-y-1 shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2 px-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">M</span>
            </div>
            <span className="text-[10px] font-bold text-white">MerchOS</span>
          </div>
          {/* Nav items */}
          {[
            { label: 'Dashboard', active: true },
            { label: 'Products', active: false },
            { label: 'Suppliers', active: false },
            { label: 'Imports', active: false },
            { label: 'Enhancement', active: false },
            { label: 'Exports', active: false },
            { label: 'Reports', active: false },
            { label: 'Settings', active: false },
          ].map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${
                item.active ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded ${item.active ? 'bg-blue-400' : 'bg-gray-600'}`} />
              <span className="text-[9px] font-medium">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-3 space-y-3 bg-gray-50/50 min-w-0">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <p className="text-[8px] text-gray-500 font-medium">Products Processed</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">12,540</p>
              <p className="text-[8px] text-green-600 font-medium mt-0.5">+24% vs last week</p>
            </div>
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <p className="text-[8px] text-gray-500 font-medium">Listings Created</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">8,742</p>
              <p className="text-[8px] text-green-600 font-medium mt-0.5">+18% vs last week</p>
            </div>
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <p className="text-[8px] text-gray-500 font-medium">Success Rate</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">98.6%</p>
              <p className="text-[8px] text-green-600 font-medium mt-0.5">+2.1% vs last week</p>
            </div>
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <p className="text-[8px] text-gray-500 font-medium">Hours Saved</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">320+</p>
              <p className="text-[8px] text-gray-500 font-medium mt-0.5">This Week</p>
            </div>
          </div>

          {/* Middle section - chart + categories */}
          <div className="grid grid-cols-2 gap-2">
            {/* Listing Performance Chart */}
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-semibold text-gray-700">Listing Performance</p>
                <span className="flex items-center gap-0.5 text-[8px] text-gray-400">
                  Last 7 days
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </div>
              <ResponsiveContainer width="100%" height={60}>
                <LineChart data={[{day:'Mon',value:45},{day:'Tue',value:52},{day:'Wed',value:68},{day:'Thu',value:72},{day:'Fri',value:65},{day:'Sat',value:80},{day:'Sun',value:88}]}>
                  <XAxis dataKey="day" fontSize={7} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Top Categories */}
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-semibold text-gray-700">Top Categories</p>
                <span className="text-[8px] text-blue-600 cursor-pointer">View all</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { name: 'Electronics', count: '2,340' },
                  { name: 'Home & Kitchen', count: '1,670' },
                  { name: 'Beauty', count: '1,240' },
                  { name: 'Toys', count: '980' },
                  { name: 'Sports', count: '880' },
                ].map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between">
                    <span className="text-[8px] text-gray-600">{cat.name}</span>
                    <span className="text-[8px] font-semibold text-gray-800">{cat.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom section - imports + donut */}
          <div className="grid grid-cols-2 gap-2">
            {/* Recent Imports Table */}
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-semibold text-gray-700">Recent Imports</p>
                <span className="text-[8px] text-blue-600 cursor-pointer">View all imports →</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { name: 'Supplier_Catalog_June.pdf', count: '1,385', status: 'Completed', time: '2 min ago', color: 'text-green-600' },
                  { name: 'WhatsApp_images...', count: '842', status: 'Completed', time: '15 min ago', color: 'text-green-600' },
                  { name: 'supplier_prices.xlsx', count: '—', status: 'Processing', time: '—', color: 'text-blue-600' },
                  { name: 'supplier_products.pdf', count: '1,902', status: 'Completed', time: '1hr ago', color: 'text-green-600' },
                ].map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-[8px]">
                    <span className="text-gray-600 truncate flex-1">{item.name}</span>
                    <span className="text-gray-500 w-8 text-right">{item.count}</span>
                    <span className={`font-medium w-14 text-center ${item.color}`}>{item.status}</span>
                    <span className="text-gray-400 w-12 text-right">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Processing Overview Donut */}
            <div className="rounded-lg bg-white p-2.5 border border-gray-100 shadow-sm">
              <p className="text-[9px] font-semibold text-gray-700 mb-2">Processing Overview</p>
              <div className="flex items-center justify-center">
                <div className="relative">
                  <ResponsiveContainer width={80} height={80}>
                    <PieChart>
                      <Pie
                        data={[{name:'Completed',value:98.6,color:'#22c55e'},{name:'Processing',value:1.0,color:'#3b82f6'},{name:'Failed',value:0.4,color:'#ef4444'}]}
                        cx="50%"
                        cy="50%"
                        innerRadius={22}
                        outerRadius={32}
                        dataKey="value"
                      >
                        <Cell fill="#22c55e" />
                        <Cell fill="#3b82f6" />
                        <Cell fill="#ef4444" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center text */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-gray-900">98.6%</span>
                  </div>
                </div>
              </div>
              {/* Legend */}
              <div className="flex items-center justify-center gap-3 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-[7px] text-gray-500">Completed</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-[7px] text-gray-500">Processing</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-[7px] text-gray-500">Failed</span>
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
    <section id="how-it-works" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
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

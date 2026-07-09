import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MerchOS — Manage Products Across Every Marketplace',
  description:
    'MerchOS helps South African sellers list, enrich, and publish products to Takealot, Amazon, Shopify, and more from one dashboard.',
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
        <nav
          className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16"
          aria-label="Marketing navigation"
        >
          <div className="flex items-center gap-8">
            <a href="/" className="text-xl font-bold text-primary-600" aria-label="MerchOS home">
              MerchOS
            </a>
            <ul className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
              <li>
                <a href="#features" className="hover:text-primary-600 transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-primary-600 transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-primary-600 transition-colors">
                  How it Works
                </a>
              </li>
            </ul>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/login"
              className="hidden sm:inline-flex text-sm font-medium text-gray-700 hover:text-primary-600 transition-colors px-4 py-2"
            >
              Sign In
            </a>
            <a
              href="/register"
              className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              Get Started
            </a>
          </div>
        </nav>
      </header>

      {/* Page Content */}
      <main id="main-content" className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <span className="text-xl font-bold text-white">MerchOS</span>
              <p className="mt-3 text-sm text-gray-400 max-w-md">
                The multi-tenant marketplace product management platform built for South African sellers.
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
                <span aria-label="South African flag">🇿🇦</span>
                <span>Made in South Africa</span>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Product</h3>
              <ul className="mt-4 space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Legal</h3>
              <ul className="mt-4 space-y-2 text-sm">
                <li><a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="/contact" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-gray-800 text-sm text-gray-500 text-center">
            © 2024 MerchOS (Pty) Ltd. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

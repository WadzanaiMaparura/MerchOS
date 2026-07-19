'use client';

import { useState } from 'react';

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <nav
        className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex items-center gap-8">
          <a href="/" className="flex items-center gap-2" aria-label="MerchOS home">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-xl font-bold text-gray-900">MerchOS</span>
          </a>

          {/* Desktop links */}
          <ul className="hidden lg:flex items-center gap-6 text-sm font-medium text-gray-600">
            <li>
              <button className="hover:text-blue-600 transition-colors inline-flex items-center gap-1">
                Product
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </li>
            <li>
              <a href="#how-it-works" className="hover:text-blue-600 transition-colors">
                How It Works
              </a>
            </li>
            <li>
              <a href="#pricing" className="hover:text-blue-600 transition-colors">
                Pricing
              </a>
            </li>
            <li>
              <button className="hover:text-blue-600 transition-colors inline-flex items-center gap-1">
                Resources
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </li>
            <li>
              <a href="#about" className="hover:text-blue-600 transition-colors">
                About
              </a>
            </li>
          </ul>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <a
            href="/login"
            className="hidden sm:inline-flex text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors px-4 py-2"
          >
            Log in
          </a>
          <a
            href="/register"
            className="hidden sm:inline-flex items-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Start Free Trial
          </a>

          {/* Mobile menu button */}
          <button
            className="lg:hidden p-2 text-gray-600 hover:text-gray-900"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
          <a href="#how-it-works" className="block text-sm font-medium text-gray-700 hover:text-blue-600 py-2">
            How It Works
          </a>
          <a href="#pricing" className="block text-sm font-medium text-gray-700 hover:text-blue-600 py-2">
            Pricing
          </a>
          <a href="#about" className="block text-sm font-medium text-gray-700 hover:text-blue-600 py-2">
            About
          </a>
          <hr className="border-gray-100" />
          <a href="/login" className="block text-sm font-medium text-gray-700 py-2">
            Log in
          </a>
          <a
            href="/register"
            className="block text-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Start Free Trial
          </a>
        </div>
      )}
    </header>
  );
}

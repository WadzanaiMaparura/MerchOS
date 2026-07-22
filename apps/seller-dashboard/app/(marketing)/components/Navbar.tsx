'use client';

import { useState } from 'react';

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <nav
        className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-[72px]"
        aria-label="Main navigation"
      >
        {/* Logo — M circle mark + wordmark */}
        <div className="flex items-center gap-8">
          <a href="/" className="flex items-center gap-2 text-xl font-bold text-blue-600" aria-label="MerchOS home">
            <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="16" cy="16" r="16" fill="#2563EB"/>
              <path d="M8 23V9h2.4l5.6 9.2L21.6 9H24v14h-2.2V13.1L16.6 21h-1.2L10.2 13.1V23H8z" fill="white"/>
            </svg>
            MerchOS
          </a>

          {/* Desktop links */}
          <ul className="hidden lg:flex items-center gap-6 text-sm font-medium text-gray-700">
            <li>
              <a href="#how-it-works" className="hover:text-blue-600 transition-colors">
                How it Works
              </a>
            </li>
            <li>
              <a href="#pricing" className="hover:text-blue-600 transition-colors">
                Pricing
              </a>
            </li>
            <li>
              <a href="#early-access" className="hover:text-blue-600 transition-colors">
                Early Access
              </a>
            </li>
          </ul>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <a
            href="/login"
            className="hidden sm:inline-flex text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
          >
            Sign In
          </a>
          <a
            href="/register"
            className="hidden sm:inline-flex items-center rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Get Early Access
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
            How it Works
          </a>
          <a href="#pricing" className="block text-sm font-medium text-gray-700 hover:text-blue-600 py-2">
            Pricing
          </a>
          <a href="#early-access" className="block text-sm font-medium text-gray-700 hover:text-blue-600 py-2">
            Early Access
          </a>
          <hr className="border-gray-100" />
          <a href="/login" className="block text-sm font-medium text-gray-700 py-2">
            Sign In
          </a>
          <a
            href="/register"
            className="block text-center rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Get Early Access
          </a>
        </div>
      )}
    </header>
  );
}

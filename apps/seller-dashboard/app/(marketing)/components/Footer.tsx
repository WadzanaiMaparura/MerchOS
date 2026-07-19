export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        {/* CTA band */}
        <div className="rounded-2xl bg-blue-600 p-8 sm:p-12 text-center mb-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            Ready to automate your marketplace listings?
          </h2>
          <p className="mt-3 text-blue-100 text-base max-w-xl mx-auto">
            Join sellers across South Africa who are saving time and growing faster with MerchOS.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/register"
              className="inline-flex items-center rounded-full bg-white px-6 py-3 text-base font-semibold text-blue-600 shadow-sm hover:bg-gray-50 hover:scale-[1.02] transition-all"
            >
              Start Free Trial
              <svg className="ml-2 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
            <a
              href="#demo"
              className="inline-flex items-center rounded-full border border-white/30 px-6 py-3 text-base font-semibold text-white hover:bg-white/10 transition-all"
            >
              Watch Demo
            </a>
          </div>
        </div>

        {/* Footer grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">M</span>
              </div>
              <span className="text-lg font-bold text-white">MerchOS</span>
            </div>
            <p className="text-sm text-gray-400 max-w-xs">
              Marketplace Automation, Engineered for Accuracy &amp; Speed.
            </p>
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
              <span aria-label="South African flag">🇿🇦</span>
              <span>Made in South Africa</span>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Product</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              <li><a href="#demo" className="hover:text-white transition-colors">Watch Demo</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Resources</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><a href="/blog" className="hover:text-white transition-colors">Blog</a></li>
              <li><a href="/help" className="hover:text-white transition-colors">Help Centre</a></li>
              <li><a href="/changelog" className="hover:text-white transition-colors">Changelog</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Legal</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a></li>
              <li><a href="/terms" className="hover:text-white transition-colors">Terms of Service</a></li>
              <li><a href="/contact" className="hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800 text-sm text-gray-500 text-center">
          © {new Date().getFullYear()} MerchOS (Pty) Ltd. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left column */}
          <div>
            <span className="inline-block text-xs uppercase tracking-wider text-blue-600 font-semibold mb-4">
              Built for Marketplace Sellers
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-[1.1]">
              Marketplace Automation,{'\n'}
              Engineered for{'\n'}
              <span className="text-blue-600">Accuracy &amp; Speed.</span>
            </h1>

            <p className="mt-6 text-lg text-gray-600 leading-relaxed max-w-xl">
              Transform supplier catalogues into marketplace-ready listings through an
              intelligent automated workflow.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row items-start gap-4">
              <a
                href="/register"
                className="inline-flex items-center rounded-full bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Start Free Trial
                <svg className="ml-2 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </a>
              <a
                href="#demo"
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <svg className="mr-2 w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Watch Demo
              </a>
            </div>

            {/* Trust indicators */}
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Save 40+ hours every week
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Reduce listing rejections
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Scale your business faster
              </span>
            </div>

            {/* Social proof */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2">
                {['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500'].map((color, i) => (
                  <div
                    key={i}
                    className={`w-8 h-8 rounded-full ${color} border-2 border-white flex items-center justify-center`}
                  >
                    <span className="text-[10px] font-bold text-white">
                      {['LM', 'SD', 'NR', 'JR'][i]}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
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
              <div className="rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
                {/* Top bar */}
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  <span className="ml-3 text-xs text-gray-400 font-medium">MerchOS Dashboard</span>
                </div>

                {/* Dashboard body */}
                <div className="p-4 space-y-4">
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
          </div>
        </div>
      </div>
    </section>
  );
}

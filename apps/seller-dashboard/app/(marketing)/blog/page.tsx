import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog — MerchOS',
  description: 'Product updates, marketplace insights, automation best practices, and practical guides for online sellers.',
};

export default function BlogPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-16 sm:py-24">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-6">MerchOS Blog</h1>
      
      <p className="text-lg text-[#4B5563] leading-relaxed mb-8">
        Welcome to the MerchOS Blog. Here we share product updates, marketplace insights, 
        automation best practices, and practical guides for online sellers.
      </p>
      
      <p className="text-[#4B5563] leading-relaxed mb-12">
        Whether you're selling on Takealot, Amazon, Makro, Shopify, or WooCommerce, 
        our goal is to help you spend less time managing listings and more time growing your business.
      </p>

      <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-8">
        <h2 className="text-xl font-semibold text-[#111827] mb-4">Coming Soon</h2>
        <p className="text-[#4B5563] mb-6">Our first articles will cover:</p>
        <ul className="space-y-3">
          {[
            'Marketplace listing optimisation',
            'Reducing product listing rejections',
            'Supplier catalogue management',
            'Product data quality best practices',
            'Automation workflows for marketplace sellers',
            'MerchOS product updates',
          ].map((topic) => (
            <li key={topic} className="flex items-center gap-3 text-[#4B5563]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
              {topic}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12 pt-8 border-t border-gray-100">
        <p className="text-sm text-[#6B7280]">
          Need assistance? Visit our <a href="/help" className="text-blue-600 hover:text-blue-700 font-medium">Help Centre</a> or 
          <a href="/contact" className="text-blue-600 hover:text-blue-700 font-medium ml-1">contact our support team</a>.
        </p>
      </div>
    </div>
  );
}

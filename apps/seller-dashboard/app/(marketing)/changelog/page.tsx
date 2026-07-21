import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Changelog — MerchOS',
  description: 'Track the latest updates and improvements to the MerchOS platform.',
};

export default function ChangelogPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-16 sm:py-24">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-6">MerchOS Changelog</h1>
      
      <p className="text-lg text-[#4B5563] leading-relaxed mb-12">
        We continuously improve MerchOS to provide a faster, more reliable marketplace automation platform.
      </p>

      <div className="border-l-2 border-blue-200 pl-6 space-y-8">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-3 h-3 rounded-full bg-blue-600 -ml-[1.9rem]" />
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">July 2026</span>
          </div>
          <h2 className="text-xl font-semibold text-[#111827] mb-3">Version 1.0 — Initial Public Release</h2>
          <ul className="space-y-2">
            {[
              'Seller Dashboard',
              'Product Import',
              'Product Enhancement',
              'Marketplace Export',
              'Dashboard Analytics',
              'Secure Authentication',
              'Marketplace Ready Architecture',
            ].map((feature) => (
              <li key={feature} className="flex items-center gap-2.5 text-[#4B5563]">
                <svg className="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-12 text-sm text-[#6B7280]">Future updates will be published here.</p>
    </div>
  );
}

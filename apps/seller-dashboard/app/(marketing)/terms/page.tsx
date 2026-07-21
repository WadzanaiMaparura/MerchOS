import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — MerchOS',
  description: 'Terms and conditions for using the MerchOS platform.',
};

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-16 sm:py-24">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-6">Terms of Service</h1>

      <div className="prose prose-gray max-w-none space-y-6 text-[#4B5563] leading-relaxed">
        <p>
          Welcome to MerchOS. By using MerchOS, you agree to these Terms of Service.
        </p>

        <p>
          MerchOS provides software designed to automate marketplace listing preparation and publishing.
        </p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">User Responsibilities</h2>
        <p>Users remain responsible for:</p>
        <ul className="space-y-2">
          {['Marketplace compliance', 'Product accuracy', 'Intellectual property', 'Pricing', 'Inventory management'].map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">Service Availability</h2>
        <p>
          MerchOS is provided on an "as available" basis while we continue expanding the platform.
          These terms may be updated periodically.
        </p>
      </div>
    </div>
  );
}

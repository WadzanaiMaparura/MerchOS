import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — MerchOS',
  description: 'How MerchOS collects, uses, and protects your personal information.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-16 sm:py-24">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#6B7280] mb-10">Effective Date: July 2026</p>

      <div className="prose prose-gray max-w-none space-y-6 text-[#4B5563] leading-relaxed">
        <p>
          MerchOS respects your privacy and is committed to protecting your information.
          We collect only the information necessary to provide our marketplace automation services.
        </p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">Information We Collect</h2>
        <ul className="space-y-2">
          {['Name', 'Email Address', 'Company Name', 'Marketplace Account Information', 'Usage Analytics'].map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">How We Protect Your Data</h2>
        <p>We do not sell your personal information.</p>
        <p>Information is securely stored using cloud infrastructure and industry best practices.</p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">Contact</h2>
        <p>
          If you have any privacy concerns, please contact:{' '}
          <a href="mailto:privacy@merchos.co.za" className="text-blue-600 hover:text-blue-700 font-medium">privacy@merchos.co.za</a>
        </p>
      </div>
    </div>
  );
}

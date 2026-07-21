import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help Centre — MerchOS',
  description: 'Find answers to common questions about using MerchOS for marketplace automation.',
};

const topics = [
  { title: 'Getting Started', description: 'Create your account and connect your marketplace.' },
  { title: 'Importing Supplier Catalogues', description: 'Learn how MerchOS converts supplier catalogues into marketplace-ready listings.' },
  { title: 'Product Enhancement', description: 'Understand how MerchOS improves titles, descriptions, categories and images before export.' },
  { title: 'Marketplace Publishing', description: 'Publish products to supported marketplaces with confidence.' },
  { title: 'Account & Billing', description: 'Manage your subscription and account settings.' },
];

export default function HelpPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-16 sm:py-24">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-6">MerchOS Help Centre</h1>
      
      <p className="text-lg text-[#4B5563] leading-relaxed mb-12">
        Welcome to the MerchOS Help Centre. We're building a comprehensive knowledge base 
        designed to help marketplace sellers get started quickly and solve common questions independently.
      </p>

      <h2 className="text-xl font-semibold text-[#111827] mb-6">Popular Topics</h2>
      
      <div className="space-y-4 mb-12">
        {topics.map((topic) => (
          <div key={topic.title} className="rounded-xl border border-gray-200 bg-white p-6 hover:shadow-sm transition-shadow">
            <h3 className="text-base font-semibold text-[#111827] mb-1">{topic.title}</h3>
            <p className="text-sm text-[#4B5563]">{topic.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-8">
        <h2 className="text-lg font-semibold text-[#111827] mb-3">Need Additional Help?</h2>
        <p className="text-[#4B5563]">
          Email: <a href="mailto:support@merchos.co.za" className="text-blue-600 hover:text-blue-700 font-medium">support@merchos.co.za</a>
        </p>
        <p className="text-[#4B5563] mt-2">
          Or <a href="/contact" className="text-blue-600 hover:text-blue-700 font-medium">contact us</a> using the Contact page.
        </p>
      </div>
    </div>
  );
}

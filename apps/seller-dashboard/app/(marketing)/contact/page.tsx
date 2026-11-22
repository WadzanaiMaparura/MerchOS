import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact Us — MerchOS',
  description: 'Get in touch with the MerchOS team for general enquiries, support, or partnerships.',
};

const TRAINING_MAILTO =
  'mailto:info@merchos.co.za' +
  `?subject=${encodeURIComponent('Free training request')}` +
  `&body=${encodeURIComponent(
    'Hi MerchOS team,\n\nI would like free training.\n\nOnline or in person:\nMarketplaces I sell on:\nPhone number:\nBusiness name:\n\nThank you',
  )}`;

const contacts = [
  { label: 'General Enquiries', email: 'info@merchos.co.za' },
  { label: 'Support', email: 'support@merchos.co.za' },
  { label: 'Partnerships', email: 'partners@merchos.co.za' },
];

export default function ContactPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-10 sm:py-14">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-4">Contact Us</h1>
      <p className="text-lg text-[#4B5563] leading-relaxed mb-8">
        We'd love to hear from you.
      </p>

      <section
        id="training"
        aria-labelledby="training-booking-heading"
        className="scroll-mt-24 mb-8 rounded-2xl border-2 border-blue-600 bg-blue-50 p-8"
      >
        <h2 id="training-booking-heading" className="text-xl font-bold text-[#111827]">
          Book free training
        </h2>
        <p className="mt-2 text-[#4B5563]">
          Online, or in person at your business, arranged with you on a call. We&apos;ll show you how to load your
          products and upload them to every platform you sell on. You don&apos;t need a subscription.
        </p>
        <p className="mt-4 text-sm font-medium text-[#111827]">In your email, tell us:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#4B5563]">
          <li>Online or in person</li>
          <li>The marketplaces you sell on (Takealot, Makro, Amazon, Shopify, WooCommerce)</li>
          <li>A phone number so we can arrange a time</li>
        </ul>
        <a
          href={TRAINING_MAILTO}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Request a training session
        </a>
        <p className="mt-3 text-xs text-[#6B7280]">
          Opens your email app, addressed to info@merchos.co.za.
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        {contacts.map((contact) => (
          <div key={contact.label} className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-sm font-semibold text-[#111827] mb-2">{contact.label}</h3>
            <a href={`mailto:${contact.email}`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              {contact.email}
            </a>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-8">
        <h2 className="text-lg font-semibold text-[#111827] mb-3">Business Hours</h2>
        <p className="text-[#4B5563]">Monday – Friday</p>
        <p className="text-[#4B5563] font-medium">08:00 – 17:00 SAST</p>
        <p className="text-sm text-[#6B7280] mt-4">
          Or simply send us a message and our team will get back to you.
        </p>
      </div>
    </div>
  );
}

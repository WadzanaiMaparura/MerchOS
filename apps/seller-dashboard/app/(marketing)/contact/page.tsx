import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact Us — MerchOS',
  description: 'Get in touch with the MerchOS team for general enquiries, support, or partnerships.',
};

const contacts = [
  { label: 'General Enquiries', email: 'info@merchos.co.za' },
  { label: 'Support', email: 'support@merchos.co.za' },
  { label: 'Partnerships', email: 'partners@merchos.co.za' },
];

export default function ContactPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-16 sm:py-24">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-4">Contact Us</h1>
      <p className="text-lg text-[#4B5563] leading-relaxed mb-12">
        We'd love to hear from you.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
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

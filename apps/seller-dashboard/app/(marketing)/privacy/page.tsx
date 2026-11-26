import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | MerchOS',
  description: 'How MerchOS collects, uses, and protects your personal information.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-10 sm:py-14">
      <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium mb-8 inline-block">← Back to home</a>
      
      <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#6B7280] mb-10">Effective Date: November 2026</p>

      <div className="prose prose-gray max-w-none space-y-6 text-[#4B5563] leading-relaxed">
        <p>
          MerchOS respects your privacy and is committed to protecting your information.
          We collect only the information necessary to provide our marketplace automation services.
        </p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">Information We Collect</h2>
        <ul className="space-y-2">
          {['Name', 'Email Address', 'Company Name', 'Marketplace Account Information', 'Usage Analytics', 'Live chat messages'].map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">How We Protect Your Data</h2>
        <p>We do not sell your personal information.</p>
        <p>Information is securely stored using cloud infrastructure and industry best practices.</p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">Live Chat</h2>
        <p>
          When you use the chat on our website or dashboard, we keep what you type, the name and
          email address you choose to give, the page you were on and the time of each message. We
          use this only to answer you and to follow up by email if we could not reply in the chat.
        </p>
        <p>
          Chats are handled by the MerchOS support team and stored on our own systems on Amazon Web
          Services in the European Union (Ireland), encrypted at rest. No outside chat company
          receives your messages. To stop abuse, we briefly keep a one-way scrambled version of your
          IP address for rate limiting.
        </p>
        <p>
          Chats are deleted automatically 12 months after the last message. You can ask us to see or
          delete a chat sooner by emailing the address below.
        </p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">How Long We Keep Your Data</h2>
        <ul className="space-y-2">
          <li>
            <b>While you use MerchOS</b>, we keep your account, products, listings, photos and imports.
          </li>
          <li>
            <b>If your paid plan ends</b>, your account closes 37 days after your last paid day. We keep everything for
            12 months after that, so you can come back. Then we delete it.
          </li>
          <li>
            <b>If you never subscribed</b>, we delete your account 12 months after you last signed in.
          </li>
          <li>We email you 30 days before we delete anything, so you can sign in or reactivate to keep it.</li>
          <li>
            <b>Invoices and payment records</b> are kept for 6 years, because South African tax law requires it, even
            after your account is deleted.
          </li>
          <li>
            <b>Reviews</b> you agreed to publish on our website stay there, shown only with the name you chose. Ask us
            and we will remove yours.
          </li>
        </ul>
        <p>Deleted data is removed from our backups within 35 days.</p>

        <h2 className="text-lg font-semibold text-[#111827] !mt-10 !mb-4">Contact</h2>
        <p>
          If you have any privacy concerns, please contact:{' '}
          <a href="mailto:privacy@merchos.co.za" className="text-blue-600 hover:text-blue-700 font-medium">privacy@merchos.co.za</a>
        </p>
      </div>
    </div>
  );
}

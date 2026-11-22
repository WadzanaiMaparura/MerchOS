/**
 * Free training: a short strip (home page) or the full section (/pricing#training).
 * Every "Book free training" button goes to /contact?reason=training#training.
 */
export const TRAINING_HREF = '/contact?reason=training#training';

const points = [
  {
    title: 'Weekly online group sessions',
    body: 'Join live, see MerchOS in action and ask questions.',
  },
  {
    title: 'One-on-one sessions',
    body: 'Online, or in person, arranged with you on a call. Learn to upload your products to every platform you sell on.',
  },
  {
    title: 'Bring your own products',
    body: 'Work on your real catalogue with us and leave with listings ready to review.',
  },
];

export default function TrainingSection({ variant = 'full' }: { variant?: 'strip' | 'full' }) {
  if (variant === 'strip') {
    return (
      <section aria-labelledby="training-strip-heading" className="py-6 sm:py-8">
        <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-16">
          <div className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="training-strip-heading" className="text-lg font-bold text-gray-900">
                New to marketplaces? Training is free.
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                We&apos;ll help you load your first products on Takealot, Makro, Amazon, Shopify and WooCommerce,
                even before you subscribe.
              </p>
            </div>
            <a
              href={TRAINING_HREF}
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Book a session
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="training" aria-labelledby="training-heading" className="scroll-mt-24 py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-6 sm:px-10 lg:px-16">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8">
          <h2 id="training-heading" className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Free training, before and after you subscribe
          </h2>
          <p className="mt-3 max-w-3xl text-base text-gray-600">
            Not sure where to start? We&apos;ll show you, at no cost. Our team walks you through loading your
            catalogue, generating your listings and exporting files each marketplace accepts. You don&apos;t need
            a subscription to book.
          </p>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {points.map((p) => (
              <li key={p.title} className="rounded-xl border border-blue-100 bg-white p-5">
                <h3 className="text-sm font-semibold text-gray-900">{p.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{p.body}</p>
              </li>
            ))}
          </ul>
          <a
            href={TRAINING_HREF}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Book free training
          </a>
        </div>
      </div>
    </section>
  );
}

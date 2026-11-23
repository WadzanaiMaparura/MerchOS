import React from 'react';

/**
 * Sign-ups are closed while the site is being built. Shows a short message
 * instead of the form until NEXT_PUBLIC_SIGNUPS_OPEN=true (build-time).
 * This is the friendly layer only: the Auth API and Cognito refuse new
 * sign-ups on their own (SIGNUPS_OPEN on the Auth stacks).
 */
const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === 'true';

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  if (SIGNUPS_OPEN) return <>{children}</>;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm" role="status">
      <a href="/" className="text-2xl font-bold tracking-tight text-[#1e3a8a]">
        MerchOS
      </a>
      <h1 className="mt-6 text-xl font-semibold text-gray-900">We are opening soon</h1>
      <p className="mt-3 text-sm text-gray-600">
        MerchOS is not open for new sign-ups yet. Leave us your details and we will let you know as soon as your free
        trial is ready.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <a
          href="/contact"
          className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Contact us
        </a>
        <a href="mailto:info@merchos.co.za" className="text-sm font-semibold text-blue-700 underline">
          info@merchos.co.za
        </a>
      </div>
      <p className="mt-6 text-sm text-gray-600">
        Already have an account?{' '}
        <a href="/login" className="font-semibold text-blue-700 underline">
          Sign in
        </a>
      </p>
    </div>
  );
}

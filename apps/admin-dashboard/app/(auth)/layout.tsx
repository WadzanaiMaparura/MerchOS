import React from 'react';

/**
 * Minimal layout for admin authentication pages (login, MFA).
 * Centers content vertically and horizontally on a neutral background.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
}

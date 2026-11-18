'use client';

/**
 * Billing details: the company name (and optional registration / VAT number and
 * address) printed in the "Bill to" block of the seller's invoices.
 *
 * Changing these affects FUTURE invoices only; an invoice keeps the details it
 * was issued with.
 */
import React, { useEffect, useState } from 'react';
import { useBillingProfile, useUpdateBillingProfile } from '@merch-os/api-client';
import type { BillingProfileInput } from '@merch-os/api-client';
import { Card, Alert } from '@merch-os/ui';

const INPUT_CLASS =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/** Turns the form fields into the API payload, leaving blank optionals out. */
export function toProfileInput(f: {
  companyName: string;
  registrationNumber: string;
  vatNumber: string;
  email: string;
  address: string;
}): BillingProfileInput {
  const addressLines = f.address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    companyName: f.companyName.trim(),
    ...(f.registrationNumber.trim() ? { registrationNumber: f.registrationNumber.trim() } : {}),
    ...(f.vatNumber.trim() ? { vatNumber: f.vatNumber.trim() } : {}),
    ...(f.email.trim() ? { email: f.email.trim() } : {}),
    ...(addressLines.length > 0 ? { addressLines } : {}),
  };
}

export function BillingDetailsCard() {
  const { data: profile, isLoading, isError } = useBillingProfile();
  const save = useUpdateBillingProfile();

  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [saved, setSaved] = useState(false);

  // Fill the form once the saved profile arrives (and again if it is replaced).
  useEffect(() => {
    if (!profile) return;
    setCompanyName(profile.companyName);
    setRegistrationNumber(profile.registrationNumber ?? '');
    setVatNumber(profile.vatNumber ?? '');
    setEmail(profile.email ?? '');
    setAddress((profile.addressLines ?? []).join('\n'));
  }, [profile]);

  const canSave = companyName.trim().length > 0 && !save.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaved(false);
    save.mutate(
      toProfileInput({ companyName, registrationNumber, vatNumber, email, address }),
      { onSuccess: () => setSaved(true) }
    );
  };

  return (
    <Card title="Billing details">
      <p className="mb-4 text-sm text-gray-600">
        These appear in the &ldquo;Bill to&rdquo; section of your invoices. Invoices already issued
        are not changed, so set them before you pay.
      </p>

      {isError && (
        <Alert variant="warning" title="Couldn't load your billing details">
          Please refresh the page. You can still enter them below.
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4" aria-label="Billing details" noValidate>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="bd-company" className="mb-1 block text-sm font-medium text-gray-700">
              Company or business name <span aria-hidden="true">*</span>
            </label>
            <input
              id="bd-company"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={120}
              required
              disabled={isLoading}
              autoComplete="organization"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="bd-reg" className="mb-1 block text-sm font-medium text-gray-700">
              Registration number (optional)
            </label>
            <input
              id="bd-reg"
              type="text"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              maxLength={30}
              disabled={isLoading}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="bd-vat" className="mb-1 block text-sm font-medium text-gray-700">
              VAT number (optional)
            </label>
            <input
              id="bd-vat"
              type="text"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              maxLength={20}
              disabled={isLoading}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="bd-email" className="mb-1 block text-sm font-medium text-gray-700">
              Billing email (optional)
            </label>
            <input
              id="bd-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={120}
              disabled={isLoading}
              autoComplete="email"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label htmlFor="bd-address" className="mb-1 block text-sm font-medium text-gray-700">
            Address (optional, up to 5 lines)
          </label>
          <textarea
            id="bd-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={4}
            disabled={isLoading}
            className={INPUT_CLASS}
            aria-describedby="bd-address-help"
          />
          <p id="bd-address-help" className="mt-1 text-xs text-gray-500">
            One line per row.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {save.isPending ? 'Saving…' : 'Save billing details'}
          </button>
          {saved && !save.isPending && !save.isError && (
            <span className="text-sm text-green-700" role="status">
              Saved. Applies to your next invoice.
            </span>
          )}
          {save.isError && (
            <span className="text-sm text-red-600" role="alert">
              {save.error?.message || 'Could not save your billing details. Please try again.'}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

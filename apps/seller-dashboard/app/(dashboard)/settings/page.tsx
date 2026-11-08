'use client';

/**
 * Settings hub (frontend only, awaiting backend).
 *
 * Landing page for account settings with sections for Profile, Security, Team,
 * and Billing. Renders a complete interface with placeholder values so nothing
 * 404s or shows blank; fields and actions connect to the backend later.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@merch-os/ui';

type TabId = 'profile' | 'security' | 'team' | 'billing';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'team', label: 'Team' },
  { id: 'billing', label: 'Billing' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('profile');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage your company profile, security, team, and plan.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card padding="lg">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Company profile</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Company name" value="Trampoline Store" />
            <Field label="Contact name" value="Wadzanai Maparura" />
            <Field label="Business email" value="satrampolinestore@gmail.com" />
            <Field label="Phone number" value="+27 81 037 2480" />
            <Field label="Country" value="South Africa" />
            <Field label="VAT / Registration" value="Not set" />
          </div>
          <div className="mt-5">
            <button type="button" className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2">
              Save changes
            </button>
          </div>
        </Card>
      )}

      {tab === 'security' && (
        <Card padding="lg">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Security</h2>
          <div className="space-y-4 text-sm">
            <Row label="Password" value="Last changed recently" action="Change password" />
            <Row label="Multi-factor authentication" value="Email OTP enabled" action="Manage" />
            <Row label="Active sessions" value="1 device" action="Sign out others" />
          </div>
        </Card>
      )}

      {tab === 'team' && (
        <Card padding="lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Team members</h2>
            <button type="button" onClick={() => router.push('/settings/team')} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
              Invite member
            </button>
          </div>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            <li className="flex items-center justify-between px-4 py-3">
              <div><p className="font-medium text-gray-900">Wadzanai Maparura</p><p className="text-xs text-gray-500">satrampolinestore@gmail.com</p></div>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">Owner</span>
            </li>
          </ul>
        </Card>
      )}

      {tab === 'billing' && (
        <Card padding="lg">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Plan and billing</h2>
          <p className="mb-4 text-sm text-gray-500">You are on the Growth plan.</p>
          <button type="button" onClick={() => router.push('/billing')} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2">
            Go to billing
          </button>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</label>
      <input
        defaultValue={value}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      />
    </div>
  );
}

function Row({ label, value, action }: { label: string; value: string; action: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3">
      <div><p className="font-medium text-gray-900">{label}</p><p className="text-xs text-gray-500">{value}</p></div>
      <button type="button" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
        {action}
      </button>
    </div>
  );
}

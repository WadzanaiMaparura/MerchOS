'use client';

/**
 * The payment cycle in the dashboard (see services/shared/entitlements/billing-stage.ts):
 *
 *   BillingStageBanner  "payment due" (last 7 days), "overdue" (3-day grace) and
 *                       "paused" (day 3 to 37) across the top of every page
 *   ClosedAccountGate   from day 37 the whole dashboard is replaced by the
 *                       Welcome back page (Billing stays reachable, so the
 *                       payment can be confirmed after PayFast)
 *
 * Both render nothing until the payment cycle is switched on for the platform,
 * and nothing for trial, paid-up or free unlimited accounts.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBilling, usePlanChange, useProducts } from '@merch-os/api-client';
import { useAuth, useRole } from '@merch-os/auth';
import type { PlanId } from '@merch-os/types';

const CHECKOUT_ENABLED = process.env.NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED === 'true';
const PENDING_PLAN_KEY = 'merchos.billing.pendingPlan';

const longDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString('en-ZA', {
        timeZone: 'Africa/Johannesburg',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

/** 89900 -> "R899", 44950 -> "R449.50" */
export function formatRand(cents: number): string {
  const rands = Math.floor(cents / 100).toLocaleString('en-ZA').replace(/\u00a0|\s/g, ',');
  const c = cents % 100;
  return `R${rands}${c ? `.${String(c).padStart(2, '0')}` : ''}`;
}

const payLink =
  'inline-flex shrink-0 items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

export function BillingStageBanner() {
  const { data } = useBilling();
  const role = useRole();
  const a = data?.account;
  if (!data || !a?.lifecycleEnabled) return null;
  if (a.stage !== 'due_soon' && a.stage !== 'grace' && a.stage !== 'paused') return null;
  const owner = role === 'owner';

  const content =
    a.stage === 'due_soon'
      ? {
          tone: 'border-blue-200 bg-blue-50',
          title: `Your ${data.planName} plan is paid until ${longDate(a.paidUntil)}.`,
          text: 'Pay for your next month to carry on without a break. Paying early never costs you days.',
          cta: 'Pay for next month',
        }
      : a.stage === 'grace'
        ? {
            tone: 'border-amber-300 bg-amber-50',
            title: 'Your payment is overdue.',
            text: `Everything still works until ${longDate(a.graceEndsAt)}. After that your plan is paused until you pay.`,
            cta: 'Pay now',
          }
        : {
            tone: 'border-red-300 bg-red-50',
            title: 'Your plan is paused.',
            text: `Your products are safe and you can still edit and export them, but adding products and writing listings is paused. Pay before ${longDate(a.closesAt)} to keep your account open.`,
            cta: 'Pay now',
          };

  return (
    <section
      role={a.stage === 'due_soon' ? 'status' : 'alert'}
      aria-label="Payment"
      className={`mb-4 rounded-lg border p-4 ${content.tone}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{content.title}</p>
          <p className="mt-0.5 text-sm text-gray-700">
            {content.text}
            {!owner && ' Only the account owner can pay.'}
          </p>
        </div>
        {owner && CHECKOUT_ENABLED && (
          <Link href="/billing?renew=1" className={payLink}>
            {content.cta}
          </Link>
        )}
      </div>
    </section>
  );
}

export function ClosedAccountGate({ children }: { children: React.ReactNode }) {
  const { data } = useBilling();
  const pathname = usePathname() ?? '';
  const a = data?.account;
  if (!a?.lifecycleEnabled || a.stage !== 'closed' || pathname.startsWith('/billing')) return <>{children}</>;
  return <WelcomeBack />;
}

export function WelcomeBack() {
  const { data } = useBilling();
  const products = useProducts({ page: 1, pageSize: 1 });
  const plan = usePlanChange();
  const role = useRole();
  const { logout } = useAuth();
  const owner = role === 'owner';
  const a = data?.account;
  const plans = (data?.plans ?? []).filter((p) => p.priceZARCents !== null);
  const [planId, setPlanId] = useState<PlanId | ''>('');
  const [voucher, setVoucher] = useState('');

  useEffect(() => {
    if (!planId && plans.length) setPlanId((a?.lastPlanId ?? plans[0]!.planId) as PlanId);
  }, [planId, plans, a?.lastPlanId]);

  const count = products.data?.total;
  const chosen = plans.find((p) => p.planId === planId);
  const price = chosen?.priceZARCents ?? null;
  const discounted =
    price !== null && a?.comeback && !voucher.trim() ? Math.round((price * (100 - a.comeback.percentOff)) / 100) : null;

  const pay = () => {
    if (!planId) return;
    plan.mutate(
      {
        planId,
        ...(voucher.trim() ? { voucherCode: voucher.trim() } : {}),
        returnUrl: `${window.location.origin}/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/dashboard`,
      },
      {
        onSuccess: (result) => {
          try {
            sessionStorage.setItem(
              PENDING_PLAN_KEY,
              JSON.stringify({ planId, previousEnd: data?.currentPeriodEnd || null }),
            );
          } catch {
            /* ignore */
          }
          window.location.assign(result.redirectUrl);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-xl py-8">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
        <p className="mt-2 text-sm text-gray-700">
          {typeof count === 'number'
            ? `Your ${count.toLocaleString('en-ZA').replace(/\u00a0|\s/g, ',')} product${count === 1 ? ' is' : 's are'} safe, with their listings.`
            : 'Your products are safe, with their listings.'}{' '}
          Your account was closed because we did not receive a payment. Pay for a month and you carry on exactly where
          you left off.
        </p>
        {a?.dataKeptUntil && (
          <p className="mt-2 text-xs text-gray-500">We keep your products until {longDate(a.dataKeptUntil)}.</p>
        )}

        {!owner ? (
          <p className="mt-6 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Only the account owner can reactivate the account. Ask them to sign in and pay.
          </p>
        ) : !CHECKOUT_ENABLED ? (
          <p className="mt-6 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Online payments are not open right now. Reply to any of our emails and we will help you reactivate.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {a?.comeback && (
              <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900" role="status">
                <b>{a.comeback.percentOff}% off your first month back</b>, applied automatically until{' '}
                {longDate(a.comeback.endsAt)}.
              </p>
            )}
            <fieldset>
              <legend className="text-sm font-medium text-gray-900">Choose your plan</legend>
              <div className="mt-2 space-y-2">
                {plans.map((p) => (
                  <label
                    key={p.planId}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
                      planId === p.planId ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="plan"
                        value={p.planId}
                        checked={planId === p.planId}
                        onChange={() => setPlanId(p.planId)}
                        className="h-4 w-4"
                      />
                      <span>
                        <span className="font-semibold text-gray-900">{p.name}</span>
                        {p.planId === a?.lastPlanId && <span className="ml-2 text-xs text-gray-500">your last plan</span>}
                        <span className="block text-xs text-gray-600">
                          {p.monthlyProducts != null
                            ? `${p.monthlyProducts.toLocaleString('en-ZA').replace(/\u00a0|\s/g, ',')} new products a month`
                            : 'Custom'}
                        </span>
                      </span>
                    </span>
                    <span className="font-semibold text-gray-900">{formatRand(p.priceZARCents!)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm font-medium text-gray-700">
              Voucher code (optional)
              <input
                type="text"
                value={voucher}
                onChange={(e) => setVoucher(e.target.value)}
                maxLength={40}
                autoComplete="off"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </label>
            {plan.isError && (
              <p role="alert" className="text-sm text-red-700">
                {plan.error?.message || 'Something went wrong starting your payment. Please try again.'}
              </p>
            )}
            <button
              type="button"
              onClick={pay}
              disabled={!planId || plan.isPending}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {plan.isPending
                ? 'Opening PayFast…'
                : discounted !== null
                  ? `Reactivate and pay ${formatRand(discounted)}`
                  : price !== null
                    ? `Reactivate and pay ${formatRand(price)}`
                    : 'Reactivate'}
            </button>
            <p className="text-xs text-gray-500">You pay securely on PayFast. We never charge you automatically.</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-6 text-sm font-medium text-gray-600 underline hover:text-gray-900"
        >
          Not now, sign me out
        </button>
      </div>
    </div>
  );
}

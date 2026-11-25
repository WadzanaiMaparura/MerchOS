'use client';

import React, { useEffect, useState } from 'react';
import {
  useBilling,
  useCancelAutoBilling,
  useInvoices,
  usePlanChange,
  useInvoicePdf,
} from '@merch-os/api-client';
import {
  Card,
  DataTable,
  ProgressBar,
  Badge,
  Alert,
  ConfirmationModal,
} from '@merch-os/ui';
import type { ColumnDef } from '@merch-os/ui';
import { BillingDetailsCard } from './BillingDetailsCard';
import { useRole } from '@merch-os/auth';
import type {
  InvoiceSummary,
  InvoiceStatus,
  PlanId,
  PlanCatalogueEntry,
  CreditBalance,
} from '@merch-os/types';

// --- Checkout return handling ---------------------------------------------
//
// After paying on PayFast's hosted page the buyer is sent back here with
// ?checkout=success. The plan only changes when PayFast's server-to-server
// notification (ITN) is processed, which can land a few seconds AFTER the
// browser returns. So on return we poll the billing overview until the plan
// reflects the purchase, instead of showing a stale plan.

/** How often to re-check the plan while confirming a payment. */
const CONFIRM_POLL_MS = 3000;
/** Stop polling (and tell the user) if confirmation takes this long. */
const CONFIRM_TIMEOUT_MS = 120_000;
/** sessionStorage key remembering which plan the buyer was paying for (and the paid-until before). */
const PENDING_PLAN_KEY = 'merchos.billing.pendingPlan';

/** Reads the pending checkout: JSON { planId, previousEnd }, or a bare plan id (older tabs). */
function readPendingCheckout(raw: string | null): { planId: PlanId | null; previousEnd: string | null } {
  if (!raw) return { planId: null, previousEnd: null };
  try {
    const v = JSON.parse(raw) as { planId?: unknown; previousEnd?: unknown };
    return {
      planId: typeof v.planId === 'string' ? (v.planId as PlanId) : null,
      previousEnd: typeof v.previousEnd === 'string' && v.previousEnd ? v.previousEnd : null,
    };
  } catch {
    return { planId: raw as PlanId, previousEnd: null };
  }
}

/**
 * Launch gate. Purchase actions stay hidden until prices are final. Off unless
 * NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED is exactly 'true' (build-time). The API
 * enforces the same gate server-side (CHECKOUT_ENABLED), so this is UX only.
 */
const CHECKOUT_ENABLED = process.env.NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED === 'true';

// --- Formatting helpers -----------------------------------------------------

/** Integer ZAR cents -> "R999" / "R1,999.50". */
function formatZAR(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatLimit(n: number | null): string {
  return n === null ? 'Unlimited' : n.toLocaleString('en-ZA');
}

function formatDate(iso: string): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

// --- Invoice status badge variant mapping ---

function getInvoiceStatusVariant(status: InvoiceStatus) {
  switch (status) {
    case 'paid':
      return 'success' as const;
    case 'open':
      return 'warning' as const;
    case 'void':
      return 'default' as const;
    case 'uncollectible':
      return 'error' as const;
    default:
      return 'default' as const;
  }
}

// --- Subscription status badge variant mapping ---

function getSubscriptionStatusVariant(status: string) {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'success' as const;
    case 'past_due':
    case 'incomplete':
      return 'warning' as const;
    case 'canceled':
    case 'incomplete_expired':
    case 'unpaid':
      return 'error' as const;
    default:
      return 'default' as const;
  }
}

function formatSubscriptionStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// --- Billing Page ---

export default function BillingPage() {
  const role = useRole();

  // Non-owner users are denied access immediately (Requirement 8.7)
  if (role !== 'owner') {
    return <AccessDenied />;
  }

  return <BillingContent />;
}

function AccessDenied() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="max-w-md">
        <Alert variant="error" title="Access Denied">
          Billing management requires the owner role. Please contact your
          organisation owner for access.
        </Alert>
      </div>
    </div>
  );
}

// EMPTY PLACEHOLDER: the structure renders before the billing response arrives,
// but with no fabricated figures — blank values (em dash) and zero usage.
const EMPTY_BILLING = {
  planId: undefined as unknown as PlanId,
  planName: 'No plan',
  billingCycle: 'monthly' as const,
  subscriptionStatus: 'unknown',
  currentPeriodStart: '',
  currentPeriodEnd: '',
  usage: { aiCalls: 0, imageCalls: 0, csvExports: 0 },
  limits: { maxAiCallsPerMonth: 0, maxImageCallsPerMonth: 0, maxCsvExportsPerMonth: 0 },
  credits: undefined as CreditBalance | undefined,
  plans: [] as PlanCatalogueEntry[],
};

function BillingContent() {
  // --- Checkout return state (read after mount to avoid SSR hydration mismatch)
  const [checkout, setCheckout] = useState<'success' | 'cancelled' | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState<number | false>(false);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);

  // The paid-until before checkout: a renewal of the same plan is only confirmed once it moves.
  const [pendingEnd, setPendingEnd] = useState<string | null>(null);
  const [renewRequested, setRenewRequested] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get('checkout');
    if (param === 'success') {
      setCheckout('success');
      setPollIntervalMs(CONFIRM_POLL_MS);
      try {
        const pending = readPendingCheckout(sessionStorage.getItem(PENDING_PLAN_KEY));
        setPendingPlan(pending.planId);
        setPendingEnd(pending.previousEnd);
      } catch {
        /* sessionStorage unavailable — fall back to "any active plan" */
      }
    } else if (param === 'cancelled') {
      setCheckout('cancelled');
    }
    // From the reminder emails and banners: open the plans with the current one ready to pay.
    if (params.get('renew') === '1') setRenewRequested(true);
  }, []);

  const { data: billingData } = useBilling({ refetchIntervalMs: pollIntervalMs });

  // Confirmed = active AND (if we know what they were buying) on that plan AND,
  // for a renewal, the paid-until has moved on.
  const isConfirmed =
    billingData?.subscriptionStatus === 'active' &&
    (pendingPlan === null || billingData.planId === pendingPlan) &&
    (pendingEnd === null || billingData.currentPeriodEnd !== pendingEnd);

  useEffect(() => {
    if (checkout === 'success' && isConfirmed) {
      setPollIntervalMs(false);
      try {
        sessionStorage.removeItem(PENDING_PLAN_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [checkout, isConfirmed]);

  useEffect(() => {
    if (checkout !== 'success') return undefined;
    const timer = setTimeout(() => {
      setConfirmTimedOut(true);
      setPollIntervalMs(false);
    }, CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [checkout]);

  const confirming = checkout === 'success' && !isConfirmed && !confirmTimedOut;

  const [invoicePage, setInvoicePage] = useState(1);
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices({ page: invoicePage, pageSize: 20 });

  const [showPlanChange, setShowPlanChange] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The next checkout pays one month by EFT instead of saving a card.
  const [payOnceNext, setPayOnceNext] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const cancelAuto = useCancelAutoBilling();
  const [voucherCode, setVoucherCode] = useState('');
  const [pdfError, setPdfError] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const invoicePdf = useInvoicePdf();

  const planChangeMutation = usePlanChange();

  // Use live billing when available; otherwise render the structure with empty
  // placeholder values (no fabricated figures) until the response arrives.
  const billing = (billingData ?? EMPTY_BILLING) as NonNullable<typeof billingData> | typeof EMPTY_BILLING;
  const plans: PlanCatalogueEntry[] = billing.plans ?? [];
  const credits = billing.credits;
  const selectedPlanEntry = plans.find((p) => p.planId === selectedPlan);
  const account = billingData?.account;
  const lapsed = account?.stage === 'grace' || account?.stage === 'paused' || account?.stage === 'closed';
  const renewing = !!selectedPlan && selectedPlan === billing.planId && billing.subscriptionStatus === 'active';
  // Card subscriptions switched on for the platform (the server decides; the switch is shared).
  const cardMode = account?.cardBillingEnabled === true;
  const currentPlanPrice = plans.find((p) => p.planId === billing.planId)?.priceZARCents ?? null;

  // ?renew=1 (emails, banners): open the plans once they have loaded.
  useEffect(() => {
    if (renewRequested && billingData) {
      setShowPlanChange(true);
      setRenewRequested(false);
    }
  }, [renewRequested, billingData]);

  const handlePdfDownload = async (invoice: InvoiceSummary) => {
    setPdfError((prev) => ({ ...prev, [invoice.invoiceId]: false }));
    setDownloadingId(invoice.invoiceId);
    try {
      // The API issues the PDF if needed and returns a link valid for ~5 minutes.
      const { url } = await invoicePdf.mutateAsync(invoice.invoiceId);
      // The response is an attachment, so navigating starts the download without
      // leaving this page (and, unlike window.open after an await, is not
      // treated as a popup by browsers).
      window.location.assign(url);
    } catch {
      // Requirement 8.5: surface a per-invoice error, allow retry.
      setPdfError((prev) => ({ ...prev, [invoice.invoiceId]: true }));
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePlanChangeConfirm = () => {
    if (!selectedPlan) return;
    const chosen = selectedPlan;
    const once = payOnceNext;
    setPayOnceNext(false);
    planChangeMutation.mutate(
      {
        planId: chosen,
        ...(voucherCode.trim() ? { voucherCode: voucherCode.trim() } : {}),
        ...(once ? { payOnce: true } : {}),
        // Return to whichever origin the seller is on (not a server-side default),
        // so dev/staging/prod and custom domains all land back on their own app.
        returnUrl: `${window.location.origin}/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/billing?checkout=cancelled`,
      },
      {
        onSuccess: (result) => {
          setConfirmOpen(false);
          // A downgrade on automatic billing: no payment now, the plan changes at the next charge.
          if (result.scheduled) {
            const name = plans.find((p) => p.planId === result.planId)?.name ?? 'new';
            setNotice(
              `Done. Your plan changes to ${name} on ${formatDate(result.effectiveAt ?? '')}, and your card will be charged ${formatZAR(result.nextChargeCents ?? 0)} from then. You keep your current plan until then.`,
            );
            return;
          }
          // Remember what they are buying so the return trip can confirm THAT plan,
          // then hand the browser to PayFast's hosted payment page.
          try {
            sessionStorage.setItem(
              PENDING_PLAN_KEY,
              JSON.stringify({ planId: chosen, previousEnd: billing.currentPeriodEnd || null }),
            );
          } catch {
            /* ignore */
          }
          if (result.redirectUrl) window.location.assign(result.redirectUrl);
        },
      }
    );
  };

  const invoiceColumns: ColumnDef<InvoiceSummary>[] = [
    {
      id: 'invoiceNumber',
      header: 'Invoice no.',
      cell: (row) => row.invoiceNumber ?? '\u2014',
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (row) => `${row.currency} ${(row.amount / 100).toFixed(2)}`,
    },
    {
      id: 'currency',
      header: 'Currency',
      cell: (row) => row.currency,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={getInvoiceStatusVariant(row.status)}>
          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
        </Badge>
      ),
    },
    {
      id: 'billingPeriod',
      header: 'Billing Period',
      cell: (row) => `${formatDate(row.billingPeriodStart)} to ${formatDate(row.billingPeriodEnd)}`,
    },
    {
      id: 'pdf',
      header: 'PDF',
      cell: (row) => {
        const hasError = pdfError[row.invoiceId];
        const busy = downloadingId === row.invoiceId;
        const downloadable = row.status === 'paid';
        return (
          <div className="flex flex-col">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePdfDownload(row);
              }}
              disabled={!downloadable || busy}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-gray-400"
              aria-label={`Download PDF for invoice ${row.invoiceNumber ?? row.invoiceId}`}
            >
              {busy ? 'Preparing\u2026' : hasError ? 'Try again' : downloadable ? 'Download' : 'Unavailable'}
            </button>
            {hasError && (
              <span className="text-xs text-red-600" role="alert">
                Invoice PDF couldn&apos;t be prepared
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Billing</h1>
        <button
          onClick={() => setShowPlanChange(!showPlanChange)}
          className="rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Change Plan
        </button>
      </div>

      {/* Checkout return banners */}
      {confirming && (
        <Alert variant="info" title="Confirming your payment…">
          Thanks, we&apos;re waiting for PayFast to confirm your payment. This usually takes a few
          seconds. You don&apos;t need to do anything or pay again.
        </Alert>
      )}
      {checkout === 'success' && isConfirmed && (
        <Alert variant="success" title="Payment confirmed">
          You&apos;re now on the {billing.planName} plan.
        </Alert>
      )}
      {checkout === 'success' && !isConfirmed && confirmTimedOut && (
        <Alert variant="warning" title="Still confirming your payment">
          This is taking longer than usual. Your payment is safe: refresh this page in a minute. If
          your plan hasn&apos;t updated after that, contact support and quote this page.
        </Alert>
      )}
      {checkout === 'cancelled' && (
        <Alert variant="info" title="Payment not completed">
          You left the payment page before paying, so you haven&apos;t been charged and your plan is
          unchanged.
        </Alert>
      )}
      {planChangeMutation.isError && (
        <Alert variant="error" title="Couldn't start checkout">
          {planChangeMutation.error?.message || 'Something went wrong starting your payment. Please try again.'}
        </Alert>
      )}

      {notice && (
        <Alert variant="success" title="Plan change scheduled">
          {notice}
        </Alert>
      )}
      {cancelAuto.isSuccess && (
        <Alert variant="info" title="Automatic billing stopped">
          Your card will not be charged again. Your plan stays active until {formatDate(cancelAuto.data?.paidUntil ?? '')}.
          You can pay again at any time.
        </Alert>
      )}

      {/* Automatic card billing (PayFast subscription) */}
      {account?.cardBillingEnabled && CHECKOUT_ENABLED && (account.autoRenew || account.chargeFailed) && (
        <Card title="Automatic billing">
          {account.chargeFailed && lapsed ? (
            <div className="space-y-3">
              <Alert variant="warning" title="We could not charge your card">
                Update your card and we will try again, or pay this month by EFT now.
              </Alert>
              <div className="flex flex-wrap gap-2">
                {account.cardUpdateUrl && (
                  <a
                    href={account.cardUpdateUrl}
                    className="rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                  >
                    Update my card
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPayOnceNext(true);
                    setSelectedPlan((account.lastPlanId ?? billing.planId) as PlanId);
                    setConfirmOpen(true);
                  }}
                  className="rounded-md border border-gray-300 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Pay this month by EFT
                </button>
              </div>
            </div>
          ) : account.autoRenew ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-700">
                Your card is charged automatically each month.
                {account.nextCharge && (
                  <>
                    {' '}
                    Next charge: <b>{formatZAR(account.nextCharge.amountCents)}</b> on{' '}
                    <b>{formatDate(account.nextCharge.at)}</b>
                    {account.nextCharge.planId !== billing.planId &&
                      ` (${plans.find((p) => p.planId === account.nextCharge!.planId)?.name ?? ''} plan from then)`}
                    .
                  </>
                )}
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                {account.cardUpdateUrl && (
                  <a
                    href={account.cardUpdateUrl}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    Update card
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setStopOpen(true)}
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  Stop automatic billing
                </button>
              </div>
            </div>
          ) : null}
          {cancelAuto.isError && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {cancelAuto.error?.message || 'Could not stop automatic billing. Please try again.'}
            </p>
          )}
        </Card>
      )}

      {/* Subscription Overview (Requirement 8.1) — compact summary row */}
      <Card title="Subscription Overview">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Current Plan</dt>
            <dd className="mt-0.5 text-sm font-semibold text-gray-900">{billing.planName}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Billing Cycle</dt>
            <dd className="mt-0.5 text-sm font-semibold text-gray-900">
              {billing.billingCycle === 'annual' ? 'Annual' : 'Monthly'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Status</dt>
            <dd className="mt-0.5">
              <Badge variant={getSubscriptionStatusVariant(billing.subscriptionStatus)}>
                {formatSubscriptionStatus(billing.subscriptionStatus)}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Current Period</dt>
            <dd className="mt-0.5 text-sm font-semibold text-gray-900">
              {formatDate(billing.currentPeriodStart)} &ndash; {formatDate(billing.currentPeriodEnd)}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Credits (Requirement 8.2) — the credit model replaces per-feature counters */}
      {credits ? (
        <Card title="Credits This Billing Period">
          {credits.granted === null ? (
            <p className="text-sm text-gray-600">
              Your plan includes unlimited credits. {credits.consumed.toLocaleString('en-ZA')} used
              this period.
            </p>
          ) : (
            <div className="space-y-3">
              <ProgressBar
                label="Credits used"
                value={credits.consumed}
                max={Math.max(credits.granted, 1)}
              />
              <p className="text-sm text-gray-600">
                {(credits.remaining ?? 0).toLocaleString('en-ZA')} of{' '}
                {credits.granted.toLocaleString('en-ZA')} credits remaining
                {credits.overage > 0
                  ? ` · ${credits.overage.toLocaleString('en-ZA')} extra credits used beyond your plan`
                  : ''}
                .
              </p>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Usage This Billing Period">
          <div className="space-y-4">
            <ProgressBar
              label="Enrichment Calls"
              value={billing.usage.aiCalls}
              max={billing.limits.maxAiCallsPerMonth ?? 999999}
            />
            <ProgressBar
              label="Image Calls"
              value={billing.usage.imageCalls}
              max={billing.limits.maxImageCallsPerMonth ?? 999999}
            />
            <ProgressBar
              label="CSV Exports"
              value={billing.usage.csvExports}
              max={billing.limits.maxCsvExportsPerMonth ?? 999999}
            />
          </div>
        </Card>
      )}

      {/* Plan Change Flow (Requirement 8.6) */}
      {showPlanChange && (
        <Card title="Available Plans">
          <p className="mb-4 text-sm text-gray-600">
            Choose a plan. You&apos;ll be taken to PayFast to pay securely, and your plan changes as
            soon as the payment is confirmed. Prices are in South African Rand.
          </p>
          {CHECKOUT_ENABLED && account?.comeback && (
            <div className="mb-4">
              <Alert variant="success" title={`${account.comeback.percentOff}% off your first month back`}>
                The discount is applied automatically when you continue to PayFast, until{' '}
                {formatDate(account.comeback.endsAt)}. No code needed.
              </Alert>
            </div>
          )}
          {!CHECKOUT_ENABLED && (
            <Alert variant="info" title="Online payments are opening soon">
              Plan pricing is being finalised, so subscribing isn&apos;t available yet. You can
              compare plans below.
            </Alert>
          )}
          {CHECKOUT_ENABLED && (
          <div className="mb-4 max-w-sm">
            <label htmlFor="voucher-code" className="mb-1 block text-sm font-medium text-gray-700">
              Voucher code (optional)
            </label>
            <input
              id="voucher-code"
              type="text"
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value)}
              autoComplete="off"
              maxLength={40}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-describedby="voucher-help"
            />
            <p id="voucher-help" className="mt-1 text-xs text-gray-500">
              Applied when you continue to PayFast. The final amount is shown on the PayFast page.
            </p>
          </div>
          )}
          {plans.length === 0 ? (
            <p className="text-sm text-gray-500">Loading plans…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan, index) => {
                const isCurrent = plan.planId === billing.planId && billing.subscriptionStatus === 'active';
                const currentIndex = plans.findIndex((p) => p.planId === billing.planId);
                const selfService = plan.priceZARCents !== null;
                return (
                  <div
                    key={plan.planId}
                    className={`rounded-lg border p-4 ${
                      isCurrent ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                    <p className="text-2xl font-bold text-gray-900">
                      {plan.priceZARCents === null ? (
                        'Custom'
                      ) : (
                        <>
                          {formatZAR(plan.priceZARCents)}
                          <span className="text-sm font-normal text-gray-500"> /month</span>
                        </>
                      )}
                    </p>
                    <ul className="mt-3 space-y-1 text-sm text-gray-600">
                      <li>
                        New products:{' '}
                        {plan.monthlyProducts == null
                          ? 'Custom'
                          : `${plan.monthlyProducts.toLocaleString('en-ZA')}/month`}
                      </li>
                      <li>Listing writing + corrections included</li>
                      <li>Export to every marketplace</li>
                      <li>Unlimited team members</li>
                    </ul>
                    {isCurrent && (
                      <p className="mt-4 text-center text-sm font-medium text-blue-700">Current Plan</p>
                    )}
                    {isCurrent && selfService && CHECKOUT_ENABLED && !(account?.autoRenew && !lapsed) && (
                      <button
                        onClick={() => {
                          setSelectedPlan(plan.planId);
                          setConfirmOpen(true);
                        }}
                        className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                      >
                        {lapsed ? 'Pay now' : 'Pay for next month'}
                      </button>
                    )}
                    {!isCurrent && selfService && !CHECKOUT_ENABLED && (
                      <p className="mt-4 text-center text-sm text-gray-500">Available soon</p>
                    )}
                    {!isCurrent && selfService && CHECKOUT_ENABLED && (
                      <button
                        onClick={() => {
                          setSelectedPlan(plan.planId);
                          setConfirmOpen(true);
                        }}
                        className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                      >
                        {billing.subscriptionStatus !== 'active'
                          ? 'Subscribe'
                          : index > currentIndex
                            ? 'Upgrade'
                            : 'Downgrade'}
                      </button>
                    )}
                    {!isCurrent && !selfService && (
                      <p className="mt-4 text-center text-sm text-gray-500">Contact us for pricing</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <BillingDetailsCard />

      {/* Invoices (Requirement 8.3) */}
      <Card title="Invoices">
        <DataTable
          columns={invoiceColumns}
          data={invoicesData?.items ?? []}
          getRowKey={(row) => row.invoiceId}
          isLoading={invoicesLoading}
          page={invoicePage}
          pageSize={20}
          totalItems={invoicesData?.total ?? 0}
          onPageChange={setInvoicePage}
          emptyMessage="No invoices found."
          caption="Invoice history"
        />
      </Card>

      {/* Plan Change Confirmation Modal (Requirement 8.6) */}
      <ConfirmationModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Continue to payment"
        description={
          payOnceNext
            ? `You're about to pay one month of the ${selectedPlanEntry?.name ?? ''} plan${
                selectedPlanEntry?.priceZARCents != null ? ` (${formatZAR(selectedPlanEntry.priceZARCents)})` : ''
              } by EFT or card on PayFast, without saving a card. You can turn automatic billing back on later.`
            : cardMode && account?.autoRenew && !lapsed && selectedPlanEntry?.priceZARCents != null && currentPlanPrice !== null
              ? selectedPlanEntry.priceZARCents > currentPlanPrice
                ? `You're upgrading to ${selectedPlanEntry.name}. It starts straight away. Today you pay ${formatZAR(selectedPlanEntry.priceZARCents)} minus the unused part of your current month (the exact amount is shown on PayFast), and from then ${formatZAR(selectedPlanEntry.priceZARCents)} a month. Your card is saved for the monthly charge.`
                : `You're moving to ${selectedPlanEntry.name}. Nothing is charged now: you keep your current plan until ${formatDate(billing.currentPeriodEnd)}, then your card is charged ${formatZAR(selectedPlanEntry.priceZARCents)} a month.`
            : cardMode
              ? `You're about to subscribe to the ${selectedPlanEntry?.name ?? ''} plan${
                  selectedPlanEntry?.priceZARCents != null ? ` for ${formatZAR(selectedPlanEntry.priceZARCents)} a month` : ''
                }. You pay the first month now on PayFast and your card is charged automatically each month after that. You can stop automatic billing at any time.`
            : renewing
            ? `You're about to pay for ${lapsed ? 'a new month' : 'your next month'} of the ${selectedPlanEntry?.name ?? ''} plan${
                selectedPlanEntry?.priceZARCents != null ? ` (${formatZAR(selectedPlanEntry.priceZARCents)})` : ''
              }. ${
                lapsed
                  ? 'It starts as soon as the payment is confirmed.'
                  : 'It starts when your current month ends, so paying early never costs you days.'
              } You'll be redirected to PayFast to pay securely.`
            : `You're about to subscribe to the ${selectedPlanEntry?.name ?? ''} plan${
                selectedPlanEntry?.priceZARCents != null
                  ? ` for ${formatZAR(selectedPlanEntry.priceZARCents)} per month`
                  : ''
              }. You'll be redirected to PayFast to complete payment securely. Your plan changes as soon as the payment is confirmed.`
        }
        confirmLabel={
          cardMode && account?.autoRenew && !lapsed && !payOnceNext && selectedPlanEntry?.priceZARCents != null &&
          currentPlanPrice !== null && selectedPlanEntry.priceZARCents < currentPlanPrice
            ? 'Change my plan'
            : 'Continue to PayFast'
        }
        cancelLabel="Cancel"
        onConfirm={handlePlanChangeConfirm}
        onCancel={() => {
          setSelectedPlan(null);
          setPayOnceNext(false);
          setConfirmOpen(false);
        }}
        variant="info"
        isLoading={planChangeMutation.isPending}
      />

      {/* Stop automatic billing */}
      <ConfirmationModal
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Stop automatic billing?"
        description={`Your card will not be charged again. You keep your ${billing.planName} plan until ${formatDate(
          billing.currentPeriodEnd,
        )}; after that your plan pauses until you pay again.`}
        confirmLabel="Stop automatic billing"
        cancelLabel="Keep it on"
        onConfirm={() => cancelAuto.mutate(undefined, { onSettled: () => setStopOpen(false) })}
        onCancel={() => setStopOpen(false)}
        variant="danger"
        isLoading={cancelAuto.isPending}
      />
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import {
  useBilling,
  useInvoices,
  usePlanChange,
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
import { useRole } from '@merch-os/auth';
import type { InvoiceSummary, InvoiceStatus, PlanId } from '@merch-os/types';

// --- Plan definitions for plan change flow ---

interface PlanOption {
  planId: PlanId;
  name: string;
  price: string;
  billingNote: string;
  limits: {
    enrichmentCalls: number | null;
    imageCalls: number | null;
    csvExports: number | null;
  };
}

const AVAILABLE_PLANS: PlanOption[] = [
  {
    planId: 'starter',
    name: 'Starter',
    price: '$29/mo',
    billingNote: 'Best for small catalogues',
    limits: { enrichmentCalls: 500, imageCalls: 200, csvExports: 10 },
  },
  {
    planId: 'growth',
    name: 'Growth',
    price: '$79/mo',
    billingNote: 'For growing businesses',
    limits: { enrichmentCalls: 2000, imageCalls: 1000, csvExports: 50 },
  },
  {
    planId: 'professional',
    name: 'Professional',
    price: '$199/mo',
    billingNote: 'High-volume sellers',
    limits: { enrichmentCalls: 10000, imageCalls: 5000, csvExports: 200 },
  },
  {
    planId: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    billingNote: 'Unlimited usage, dedicated support',
    limits: { enrichmentCalls: null, imageCalls: null, csvExports: null },
  },
];

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

// EMPTY PLACEHOLDER: the structure renders before the billing backend is
// connected, but with no fabricated figures — blank values (em dash) and zero
// usage. Replaced field-for-field once useBilling() returns real data.
const EMPTY_BILLING = {
  planId: undefined as unknown as PlanId,
  planName: '—',
  billingCycle: 'monthly' as const,
  subscriptionStatus: 'unknown',
  currentPeriodStart: '—',
  currentPeriodEnd: '—',
  usage: { aiCalls: 0, imageCalls: 0, csvExports: 0 },
  limits: { maxAiCallsPerMonth: 0, maxImageCallsPerMonth: 0, maxCsvExportsPerMonth: 0 },
};

function BillingContent() {
  const { data: billingData } = useBilling();

  const [invoicePage, setInvoicePage] = useState(1);
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices({ page: invoicePage, pageSize: 20 });

  const [showPlanChange, setShowPlanChange] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pdfError, setPdfError] = useState<Record<string, boolean>>({});

  const planChangeMutation = usePlanChange();

  // Use live billing when available; otherwise render the structure with empty
  // placeholder values (no fabricated figures) until the backend is connected.
  const billing = (billingData ?? EMPTY_BILLING) as NonNullable<typeof billingData> | typeof EMPTY_BILLING;

  const handlePdfDownload = async (invoice: InvoiceSummary) => {
    if (!invoice.downloadUrl) {
      // Mark this invoice as having a PDF error (Requirement 8.5)
      setPdfError((prev) => ({ ...prev, [invoice.invoiceId]: true }));
      return;
    }
    try {
      // Presigned URL download — opens in new tab (valid for 5 minutes) (Requirement 8.4)
      window.open(invoice.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setPdfError((prev) => ({ ...prev, [invoice.invoiceId]: true }));
    }
  };

  const handlePlanChangeConfirm = () => {
    if (!selectedPlan) return;
    planChangeMutation.mutate(
      { planId: selectedPlan },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setShowPlanChange(false);
          setSelectedPlan(null);
        },
      }
    );
  };

  const invoiceColumns: ColumnDef<InvoiceSummary>[] = [
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
      cell: (row) => `${row.billingPeriodStart} — ${row.billingPeriodEnd}`,
    },
    {
      id: 'pdf',
      header: 'PDF',
      cell: (row) => {
        const hasError = pdfError[row.invoiceId];
        return (
          <div className="flex flex-col">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePdfDownload(row);
              }}
              disabled={!row.downloadUrl || hasError}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-gray-400"
              aria-label={`Download PDF for invoice ${row.invoiceId}`}
            >
              {hasError ? 'Unavailable' : row.downloadUrl ? 'Download' : 'Unavailable'}
            </button>
            {hasError && (
              <span className="text-xs text-red-600" role="alert">
                Invoice PDF is unavailable
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
              {billing.currentPeriodStart} &ndash; {billing.currentPeriodEnd}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Usage Meters (Requirement 8.2) */}
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

      {/* Plan Change Flow (Requirement 8.6) */}
      {showPlanChange && (
        <Card title="Available Plans">
          <p className="mb-4 text-sm text-gray-600">
            Select a plan to upgrade or downgrade. Changes take effect at the start of your next billing cycle.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {AVAILABLE_PLANS.map((plan) => (
              <div
                key={plan.planId}
                className={`rounded-lg border p-4 ${
                  plan.planId === billing.planId
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <h3 className="text-lg font-semibold text-gray-900">
                  {plan.name}
                </h3>
                <p className="text-2xl font-bold text-gray-900">{plan.price}</p>
                <p className="text-sm text-gray-500">{plan.billingNote}</p>
                <ul className="mt-3 space-y-1 text-sm text-gray-600">
                  <li>
                    Enrichment:{' '}
                    {plan.limits.enrichmentCalls
                      ? `${plan.limits.enrichmentCalls.toLocaleString()}/mo`
                      : 'Unlimited'}
                  </li>
                  <li>
                    Image Calls:{' '}
                    {plan.limits.imageCalls
                      ? `${plan.limits.imageCalls.toLocaleString()}/mo`
                      : 'Unlimited'}
                  </li>
                  <li>
                    CSV Exports:{' '}
                    {plan.limits.csvExports
                      ? `${plan.limits.csvExports.toLocaleString()}/mo`
                      : 'Unlimited'}
                  </li>
                </ul>
                {plan.planId !== billing.planId && (
                  <button
                    onClick={() => {
                      setSelectedPlan(plan.planId);
                      setConfirmOpen(true);
                    }}
                    className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                  >
                    {AVAILABLE_PLANS.findIndex((p) => p.planId === plan.planId) >
                    AVAILABLE_PLANS.findIndex((p) => p.planId === billing.planId)
                      ? 'Upgrade'
                      : 'Downgrade'}
                  </button>
                )}
                {plan.planId === billing.planId && (
                  <p className="mt-4 text-center text-sm font-medium text-blue-700">
                    Current Plan
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

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
        title="Confirm Plan Change"
        description={`Are you sure you want to switch to the ${
          AVAILABLE_PLANS.find((p) => p.planId === selectedPlan)?.name ?? ''
        } plan? The change will take effect at the start of your next billing cycle.`}
        confirmLabel="Confirm Change"
        cancelLabel="Cancel"
        onConfirm={handlePlanChangeConfirm}
        onCancel={() => {
          setSelectedPlan(null);
          setConfirmOpen(false);
        }}
        variant="info"
        isLoading={planChangeMutation.isPending}
      />
    </div>
  );
}

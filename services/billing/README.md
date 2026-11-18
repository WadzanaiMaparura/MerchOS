# @merch-os/billing

Subscription, credit-ledger, and payment (PayFast) service for MerchOS.

Built behind a provider-neutral `PaymentProvider` interface so the payment
gateway is swappable (PayFast today; Stripe/Paystack later) without touching
the handlers, credit ledger, plan catalogue, or the seller-dashboard UI.

> **Status: NOT YET DEPLOYED.** The CDK stack (`infrastructure/lib/billing-api-stack.ts`)
> is not written yet. This package is code + unit tests only.

## Routes

| Method | Path | Auth | Handler | RBAC |
|---|---|---|---|---|
| GET  | `/billing` | JWT | `api/handlers/get-billing.ts` | `subscription:read` |
| GET  | `/billing/invoices` | JWT | `api/handlers/list-invoices.ts` | `subscription:read` |
| POST | `/billing/plan` | JWT | `api/handlers/change-plan.ts` | `subscription:update` |
| POST | `/billing/payfast/itn` | **none** (PayFast signature verified in-handler) | `api/handlers/payfast-itn.ts` | — |

`GET /billing` returns a `BillingOverview` (@merch-os/types) so the existing
seller-dashboard `useBilling` hook works unchanged, plus a `credits` block.

## Payment flow (PayFast)

1. Seller picks a plan → `POST /billing/plan` → we build a signed PayFast
   checkout payload and return a `redirectUrl`. A PENDING subscription intent is
   stored with the **expected price** (for server-side amount verification).
2. Seller pays on PayFast's hosted page.
3. PayFast POSTs an **ITN** to `/billing/payfast/itn`. The handler verifies the
   signature, requires `payment_status=COMPLETE`, re-checks the amount against
   the stored intent, applies idempotency (first-write-wins on `m_payment_id`),
   then activates the subscription and grants the plan's monthly credits.
4. `custom_str1` carries the tenantId through the round-trip so the (JWT-less)
   ITN can locate the tenant.

## Environment variables the CDK stack must provide

| Var | Purpose |
|---|---|
| `BILLING_TABLE` | DynamoDB table (single-table, `TENANT#<id>` partition) |
| `COGNITO_ISSUER` | JWT issuer for rbacMiddleware (as other services) |
| `PAYFAST_MERCHANT_ID` | PayFast merchant id |
| `PAYFAST_MERCHANT_KEY` | PayFast merchant key (**secret** — Secrets Manager) |
| `PAYFAST_PASSPHRASE` | PayFast passphrase (**secret** — Secrets Manager) |
| `PAYFAST_MODE` | `sandbox` or `live` |
| `PAYFAST_NOTIFY_URL` | Absolute URL of the deployed `/billing/payfast/itn` route |
| `APP_BASE_URL` | Seller-dashboard origin (for return/cancel URLs) |

The merchant key + passphrase MUST come from Secrets Manager, never committed.

## DynamoDB items (all under PK `TENANT#<tenantId>`)

| SK | Meaning |
|---|---|
| `SUBSCRIPTION#current` | the tenant's current subscription |
| `CREDITS#<yyyyMM>` | monthly credit ledger (granted/consumed/overage) |
| `PAYMENT#<mPaymentId>` | payment idempotency record |
| `INVOICE#<invoiceId>` | invoice records |

## Credit model

A credit = one AI listing-action. `consumeCredit()` (in
`services/credit-ledger.ts`) is dependency-light so the product-intelligence and
image services can import it to meter their own usage. Policy: `hard_cap` blocks
past the allowance (throws `CreditLimitError`, 402); `soft_cap`/`overage` allow
and track overage.

## ⚠️ PLACEHOLDER decisions awaiting confirmation

Everything below is provisional and MUST be confirmed/refined before launch
(see `config/plans.ts`):

- **Plan prices (ZAR):** Starter R499, Growth R999, Professional R1999,
  Enterprise custom. (From the pricing screenshot — confirm.)
- **Monthly credits:** 150 / 400 / 1000 / unmetered. (Not yet validated against
  real COGS — needs real Bedrock token measurements, currently quota-blocked.)
- **Overage price:** R3.50/credit. **COGS reference:** ~R1.25/credit.
- **Default credit policy:** `soft_cap` (allow + track overage).
- **Billing cycle:** monthly only (no annual yet).
- **Trial:** not implemented (the pricing page shows "Start Free Trial" — trial
  length + trial credits are undecided).
- **Invoices:** no invoice *generation* yet — `list-invoices` reads records but
  nothing writes them (PDF/invoice creation is a follow-up).

## Invoices (PDF)

After a payment is applied the webhook issues an **invoice document**: a sequential
number (`MOS-010000`, gap-free; see `invoices/invoice-number.ts`) and a PDF stored in
the private invoices bucket under `invoices/<tenantId>/<number>.pdf`. If the webhook
could not finish (S3 hiccup etc.) the seller's first download issues it on demand;
every step is idempotent. Routes: `GET /billing/invoices/{invoiceId}/pdf` (returns a
5-minute presigned URL), `GET|PUT /billing/profile` (the seller's company details for
the "Bill to" block; each invoice keeps a snapshot, so later edits never rewrite it).

**MerchOS is not VAT registered**, so the document is a plain **"Invoice"**: no VAT is
charged or shown, and it must never be titled "Tax Invoice" (only a VAT vendor may
issue one). Issuer details live in `config/invoice-issuer.ts` and can be overridden at
deploy time with `--context invoiceIssuerLegalName=... invoiceIssuerRegNo=...`.

**If the business registers for VAT** (compulsory above R1m turnover in 12 months),
invoices must change: title "Tax Invoice", the supplier's VAT number, the VAT amount
and rate, and either VAT-inclusive prices with the VAT portion shown or VAT-exclusive
prices. That needs `config/invoice-issuer.ts`, `invoices/invoice-pdf.ts` and the plan
pricing reviewed together - get an accountant's sign-off first.

Records must be kept for 5 years, so the bucket is versioned, retained on stack
deletion and has no expiry rule. Do not add one.

/**
 * Who issues MerchOS invoices.
 *
 * MerchOS is NOT registered for VAT, so documents are plain "Invoice"s with no
 * VAT charged or shown, and must never be titled "Tax Invoice" (only a VAT
 * vendor may issue one). If the business registers for VAT this module and the
 * renderer need extending (tax-invoice wording, VAT number, VAT breakdown) -
 * see services/billing/README.md.
 *
 * Values can be overridden per deployment through environment variables so the
 * legal details can be corrected without a code change.
 */
export interface InvoiceIssuer {
  /** Registered legal name as it must appear on the invoice. */
  legalName: string;
  /** Trading name, shown if different from the legal name. */
  tradingName?: string;
  /** Company / CIPC registration number, if the supplier is a registered company. */
  registrationNumber?: string;
  addressLines: string[];
  email: string;
  website?: string;
}

/**
 * PLACEHOLDER legal name: replace with the registered business name (and add the
 * registration number) via INVOICE_ISSUER_LEGAL_NAME / INVOICE_ISSUER_REG_NO
 * before real invoices are issued.
 */
export const DEFAULT_ISSUER: InvoiceIssuer = {
  legalName: 'MerchOS',
  addressLines: ['424 Pretorius Road', 'Henley On Klip', 'Meyerton, 1961', 'South Africa'],
  email: 'admin@merchos.co.za',
  website: 'merchos.co.za',
};

export function loadInvoiceIssuer(env: NodeJS.ProcessEnv = process.env): InvoiceIssuer {
  const legalName = env['INVOICE_ISSUER_LEGAL_NAME']?.trim();
  const tradingName = env['INVOICE_ISSUER_TRADING_NAME']?.trim();
  const registrationNumber = env['INVOICE_ISSUER_REG_NO']?.trim();
  const email = env['INVOICE_ISSUER_EMAIL']?.trim();
  return {
    ...DEFAULT_ISSUER,
    ...(legalName ? { legalName } : {}),
    ...(tradingName ? { tradingName } : {}),
    ...(registrationNumber ? { registrationNumber } : {}),
    ...(email ? { email } : {}),
  };
}

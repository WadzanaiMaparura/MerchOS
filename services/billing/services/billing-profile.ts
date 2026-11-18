/**
 * The seller's invoicing details (company name, optional registration / VAT
 * numbers, address). Stored under the tenant's own partition:
 *   PK = TENANT#<tenantId>, SK = PROFILE#billing
 *
 * These print in the "Bill to" block of future invoices. A snapshot is copied
 * onto each invoice when it is issued, so editing the profile later never
 * rewrites a past invoice.
 */
import {
  BILLING_TABLE,
  createTenantDynamoClient,
  tenantPK,
} from '../../shared/utils/dynamo-client';

export const BILLING_PROFILE_SK = 'PROFILE#billing';

export interface BillingProfile {
  companyName: string;
  registrationNumber?: string;
  /** The SELLER's own VAT number, if they have one. Informational on our invoice. */
  vatNumber?: string;
  email?: string;
  addressLines?: string[];
  updatedAt: string;
}

export type BillingProfileInput = Omit<BillingProfile, 'updatedAt'>;

export async function getBillingProfile(tenantId: string): Promise<BillingProfile | null> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: BILLING_PROFILE_SK },
  });
  const item = res.Item;
  if (!item) return null;
  return {
    companyName: String(item['companyName'] ?? ''),
    ...(item['registrationNumber'] ? { registrationNumber: String(item['registrationNumber']) } : {}),
    ...(item['vatNumber'] ? { vatNumber: String(item['vatNumber']) } : {}),
    ...(item['email'] ? { email: String(item['email']) } : {}),
    ...(Array.isArray(item['addressLines']) ? { addressLines: (item['addressLines'] as unknown[]).map(String) } : {}),
    updatedAt: String(item['updatedAt'] ?? ''),
  };
}

/** Replaces the whole profile (PUT semantics): omitted optional fields are cleared. */
export async function putBillingProfile(
  tenantId: string,
  input: BillingProfileInput
): Promise<BillingProfile> {
  const updatedAt = new Date().toISOString();
  const client = createTenantDynamoClient(tenantId);
  await client.put({
    TableName: BILLING_TABLE,
    Item: {
      PK: tenantPK(tenantId),
      SK: BILLING_PROFILE_SK,
      tenantId,
      companyName: input.companyName,
      ...(input.registrationNumber ? { registrationNumber: input.registrationNumber } : {}),
      ...(input.vatNumber ? { vatNumber: input.vatNumber } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.addressLines && input.addressLines.length > 0 ? { addressLines: input.addressLines } : {}),
      updatedAt,
    },
  });
  return { ...input, updatedAt };
}

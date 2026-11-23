/** Runtime configuration (Lambda environment). */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export const config = {
  get userPoolId(): string {
    return required('USER_POOL_ID');
  },
  /** Seller dashboard app client: used to resend sign-up verification codes. */
  get sellerClientId(): string {
    return required('SELLER_CLIENT_ID');
  },
  /** This service's own table: audit log and account state. */
  get adminTable(): string {
    return required('ADMIN_TABLE');
  },
  get tenantsTable(): string {
    return required('TENANTS_TABLE');
  },
  get productsTable(): string {
    return required('PRODUCTS_TABLE');
  },
  get billingTable(): string {
    return required('BILLING_TABLE');
  },
  get engagementTable(): string {
    return required('ENGAGEMENT_TABLE');
  },
};

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
  /** Live chat table (read only): resolved chats count towards a team goal. */
  get chatTable(): string {
    return required('CHAT_TABLE');
  },
};

/** Data retention job only: every place a seller's data is kept. */
export const retentionConfig = {
  get tables() {
    return {
      inventory: required('INVENTORY_TABLE'),
      inventoryTransactions: required('INVENTORY_TRANSACTIONS_TABLE'),
      suppliers: required('SUPPLIERS_TABLE'),
      importJobs: required('IMPORT_JOBS_TABLE'),
      imageJobs: required('IMAGE_JOBS_TABLE'),
      intelligence: required('INTELLIGENCE_TABLE'),
      invitations: required('INVITATIONS_TABLE'),
    };
  },
  get buckets() {
    return {
      rawUploads: required('RAW_UPLOADS_BUCKET'),
      assets: required('ASSETS_BUCKET'),
      exports: required('EXPORTS_BUCKET'),
    };
  },
  /** off | dryrun | on. Anything else is off. */
  get mode(): 'off' | 'dryrun' | 'on' {
    const m = process.env['DATA_RETENTION'];
    return m === 'on' || m === 'dryrun' ? m : 'off';
  },
};

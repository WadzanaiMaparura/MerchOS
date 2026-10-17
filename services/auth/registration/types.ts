/**
 * Pending-registration types for the MerchOS registration lifecycle.
 *
 * A "pending registration" captures the business-profile details collected by
 * the seller registration form BEFORE the Cognito account is verified. It is a
 * short-lived, server-owned record keyed by an opaque, server-generated
 * registrationId. It intentionally never stores the password, password
 * confirmation, or the email verification code.
 *
 * The record also carries the server-generated tenantId that becomes the
 * authoritative tenant identity for the resulting self-signup account. The
 * PostConfirmation trigger reads this record (matched by verified email) to
 * assign trusted custom:tenantId / custom:role attributes.
 */

/** Marketing-consent capture (optional, defaults to not consented). */
export interface PendingMarketingConsent {
  /** Whether the user opted in to marketing communications. */
  granted: boolean;
  /** ISO-8601 timestamp when consent was captured. */
  capturedAt: string;
}

/**
 * The pending-registration record as persisted in DynamoDB.
 *
 * Storage: the existing tenants table (merch-os-tenants-<env>, resolved via the
 * TENANTS_TABLE env var). NOT the invitations table.
 *   PK = `PENDINGREG#<registrationId>`
 *   SK = `METADATA`
 *   expiresAt — Unix epoch seconds, drives DynamoDB TTL expiry
 *
 * Records are resolved by the exact registrationId (GetItem on PK). The email
 * is stored for correlation against the verified Cognito identity in
 * PostConfirmation — it is NOT a lookup key (the tenants table has no
 * email-index GSI), so a record can never be mis-selected by email.
 *
 * SECURITY: no password, passwordConfirmation or verification code is ever
 * stored on this record.
 */
export interface PendingRegistrationRecord {
  PK: string;
  SK: 'METADATA';
  /** Opaque, server-generated registration identifier. */
  registrationId: string;
  /** Server-generated tenant identifier reserved for this registration. */
  tenantId: string;
  /**
   * Business email, normalised (trimmed + lowercased). Stored for correlation
   * against the verified Cognito identity, NOT used as a lookup key.
   */
  email: string;
  /** Full name supplied on the registration form. */
  fullName: string;
  /** International phone number (E.164-style, explicit country code). */
  phoneNumber: string;
  /** Organisation / business name. */
  organisationName: string;
  /** Optional marketing consent capture. */
  marketingConsent: PendingMarketingConsent;
  /** Record status — always 'pending' while awaiting verification. */
  status: 'pending';
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Unix epoch seconds for DynamoDB TTL. */
  expiresAt: number;
}

/** Fields accepted from the registration form to create a pending record. */
export interface CreatePendingRegistrationInput {
  email: string;
  fullName: string;
  phoneNumber: string;
  organisationName: string;
  marketingConsent: boolean;
}

/** Result returned to the caller after creating a pending registration. */
export interface CreatePendingRegistrationResult {
  registrationId: string;
}

// ---------------------------------------------------------------------------
// Durable registration records
// ---------------------------------------------------------------------------
//
// When a self-signup registration completes (email verified + identity
// assigned), the short-lived pending record is promoted into THREE permanent,
// tenant-scoped records in the same tenants table, following the platform's
// single-table conventions (PK = `TENANT#<tenantId>`):
//   SK = `METADATA`            -> tenant metadata
//   SK = `PROFILE#<userId>`    -> owner profile
//   SK = `CONSENT#<userId>`    -> marketing-consent record
// None of these carry `expiresAt`, so they are never TTL-expired.

/** Durable tenant-metadata record (PK=TENANT#<tenantId>, SK=METADATA). */
export interface TenantMetadataRecord {
  PK: string;
  SK: 'METADATA';
  /** Server-generated tenant identifier (authoritative). */
  tenantId: string;
  /** Organisation / business name supplied at registration. */
  organisationName: string;
  /** Tenant lifecycle status. */
  status: 'active';
  /** The Cognito user id of the owner who created the tenant. */
  ownerId: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /**
   * The registrationId that produced this tenant. Stored so completion is
   * idempotent and auditable — a retry with the same registrationId is a no-op.
   */
  registrationId: string;
}

/** Durable owner-profile record (PK=TENANT#<tenantId>, SK=PROFILE#<userId>). */
export interface OwnerProfileRecord {
  PK: string;
  SK: string;
  tenantId: string;
  /** Cognito user id (sub / username). */
  userId: string;
  /** Verified business email (normalised). */
  email: string;
  /** Full name supplied at registration. */
  fullName: string;
  /** International phone number (E.164). */
  phoneNumber: string;
  /** Tenant-scoped role — always 'owner' for a self-signup registrant. */
  role: 'owner';
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/** Durable marketing-consent record (PK=TENANT#<tenantId>, SK=CONSENT#<userId>). */
export interface ConsentRecord {
  PK: string;
  SK: string;
  tenantId: string;
  userId: string;
  /** Consent category — marketing communications. */
  type: 'marketing';
  /** Whether the user opted in. */
  granted: boolean;
  /** ISO-8601 timestamp when consent was originally captured. */
  capturedAt: string;
}

/**
 * Everything the durable completion needs: the verified Cognito identity plus
 * the server-trusted details recovered from the pending record.
 */
export interface CompleteRegistrationInput {
  /** Server-generated tenant id recovered from the pending record. */
  tenantId: string;
  /** Verified Cognito user id. */
  userId: string;
  /** Verified, normalised email. */
  email: string;
  fullName: string;
  phoneNumber: string;
  organisationName: string;
  marketingConsent: PendingMarketingConsent;
  /** The registrationId being completed (idempotency key). */
  registrationId: string;
}

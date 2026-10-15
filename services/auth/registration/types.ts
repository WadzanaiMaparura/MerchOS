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
 * Single-table layout (reuses the invitations table):
 *   PK = `PENDINGREG#<registrationId>`
 *   SK = `METADATA`
 *   email (GSI `email-index` partition key) — enables lookup by verified email
 *   expiresAt — Unix epoch seconds, drives DynamoDB TTL expiry
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
  /** Business email, normalised (trimmed + lowercased). Also the GSI key. */
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

/**
 * Registration-lifecycle types for the MerchOS platform.
 *
 * These describe the durable records written when a confirmed Cognito user
 * completes (or recovers) their tenant/owner profile, plus the short-lived
 * pending-registration record that a later stage will populate.
 *
 * Single-table design on the tenants table (merch-os-tenants-<env>):
 *   - Tenant metadata   : PK=TENANT#<tenantId>, SK=METADATA
 *   - Owner profile      : PK=TENANT#<tenantId>, SK=USER#<cognitoSub>
 *   - Consent history    : PK=TENANT#<tenantId>, SK=USER#<cognitoSub>#CONSENT#<registrationId>
 *   - Pending reg (later): PK=PENDINGREG#<registrationId>, SK=META  (has expiresAt TTL)
 *
 * Requirements: registration lifecycle (Stage 1 — profile-completion recovery).
 */

/** Lifecycle status for a tenant metadata record created via registration. */
export type RegistrationTenantStatus = 'active';

/**
 * Tenant metadata record written at profile completion.
 * DynamoDB: PK=TENANT#<tenantId>, SK=METADATA
 */
export interface TenantMetadataRecord {
  PK: string;
  SK: 'METADATA';
  /** The server-assigned tenant id (from the Cognito custom:tenantId claim). */
  tenantId: string;
  /** Organisation display name supplied by the owner. */
  organisationName: string;
  /** Cognito sub of the owner who created the tenant. */
  ownerUserId: string;
  /** Correlation id tying this tenant to the completion/registration flow. */
  registrationId: string;
  status: RegistrationTenantStatus;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * Owner/account-holder profile record.
 * DynamoDB: PK=TENANT#<tenantId>, SK=USER#<cognitoSub>
 */
export interface OwnerProfileRecord {
  PK: string;
  SK: string;
  tenantId: string;
  /** Cognito sub. */
  userId: string;
  /** Verified email (from trusted JWT claims, never request body). */
  email: string;
  fullName: string;
  phone: string;
  /** Seller role (owner for self-registration). */
  role: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Explicit marketing-consent decision. */
export type ConsentStatus = 'granted' | 'declined';

/** Marketing communication channel the user may opt into. */
export type ConsentChannel = 'email' | 'sms';

/**
 * Append-only marketing-consent record. The stable SK (keyed on registrationId)
 * guarantees that a replay of the same completion cannot create a duplicate
 * consent event.
 * DynamoDB: PK=TENANT#<tenantId>, SK=USER#<cognitoSub>#CONSENT#<registrationId>
 */
export interface ConsentRecord {
  PK: string;
  SK: string;
  tenantId: string;
  userId: string;
  status: ConsentStatus;
  /** Identifier of the consent copy/version shown to the user. */
  consentTextVersion: string;
  /** Channels the user EXPLICITLY selected. Empty when status is 'declined'. */
  channels: ConsentChannel[];
  /** Where the consent decision originated. */
  source: 'profile-completion';
  /** Correlation id (stable per registration/completion). */
  registrationId: string;
  /** ISO 8601 timestamp. */
  grantedAt: string;
}

/**
 * Short-lived pending-registration record. Populated by a LATER stage
 * (register-pending endpoint); included here so the type contract is defined
 * once. Carries an `expiresAt` epoch-seconds TTL attribute.
 * DynamoDB: PK=PENDINGREG#<registrationId>, SK=META
 */
export interface PendingRegistrationRecord {
  PK: string;
  SK: 'META';
  registrationId: string;
  /** Email the pending registration was created for (matched against the
   *  verified Cognito email before any commit). */
  email: string;
  fullName: string;
  phone: string;
  organisationName: string;
  consentStatus: ConsentStatus;
  consentChannels: ConsentChannel[];
  consentTextVersion: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** TTL attribute — epoch SECONDS. Expiry is also enforced in application
   *  logic (never relying solely on DynamoDB's asynchronous TTL deletion). */
  expiresAt: number;
}

/**
 * Documented profile-status response states returned by GET /auth/profile-status.
 * - complete                 : tenant metadata + owner profile both exist for this subject.
 * - needs_profile_completion : genuine self-registration owner, records missing.
 * - invited                  : account is tied to an invitation (joins an existing tenant);
 *                              must NOT enter the self-registration owner-creation flow.
 * - not_verified             : Cognito email not verified.
 * - conflict                 : tenant/owner records exist but belong to a different subject,
 *                              or state is otherwise inconsistent.
 */
export type ProfileStatusState =
  | 'complete'
  | 'needs_profile_completion'
  | 'invited'
  | 'not_verified'
  | 'conflict';

export interface ProfileStatusResponse {
  status: ProfileStatusState;
}

/**
 * Reconciliation message enqueued when a registration confirmation could not be
 * persisted synchronously (e.g. PostConfirmation-time persistence failed), so a
 * durable, retryable worker can complete it later.
 *
 * PRIVACY: this payload is written to SQS and may surface in queue metrics /
 * operational tooling. It therefore carries ONLY the minimum non-PII correlation
 * fields needed to locate and reconcile the registration. It MUST NOT contain
 * passwords, verification codes, email addresses, names, phone numbers,
 * organisation names, consent details, access tokens, or ID tokens. The worker
 * re-derives the authoritative identity from Cognito and the business details
 * from the durable pending-registration record.
 */
export interface RegistrationReconciliationMessage {
  /** Schema version so the worker can reject unknown payload shapes safely. */
  schemaVersion: 1;
  /** Server-issued correlation id; also the pending-registration record key. */
  registrationId: string;
  /**
   * Cognito username (the immutable user identifier used with AdminGetUser).
   * This is an opaque account handle, not an email address. Carried so the
   * worker can fetch authoritative attributes without a table scan.
   */
  cognitoUsername: string;
}

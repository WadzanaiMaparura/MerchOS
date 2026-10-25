/**
 * Zod validation schemas for all auth service request/response payloads.
 *
 * Each schema validates incoming request bodies or query parameters
 * for auth Lambda handlers. TypeScript types are inferred from schemas
 * using z.infer for full type-safety without duplication.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Common Validators (reusable building blocks)
// ---------------------------------------------------------------------------

/**
 * Email validator — standard email format, trimmed and lowercased.
 */
export const emailValidator = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address');

/**
 * Seller role enum — matches the SellerRole type from @merch-os/types.
 */
export const sellerRoleSchema = z.enum(['viewer', 'editor', 'admin', 'owner']);

// ---------------------------------------------------------------------------
// Category 2 — privileged / admin operations (ADR-005).
//
// Identity operations (login, refresh, logout, password reset, email verify,
// change-password, MFA setup) are handled client-side via the aws-amplify
// library and have no server-side schema here. See
// docs/architecture/adr/ADR-005-auth-operation-placement.md.
// ---------------------------------------------------------------------------

// NOTE (ADR-005): login/refresh/logout/forgot-password/reset-password/
// verify-email/change-password/mfa schemas were removed with their server-side
// endpoints. Those identity operations run client-side via the aws-amplify
// library. The registration-lifecycle + privileged/admin schemas remain below.

/**
 * International phone validator — requires an explicit leading `+` and country
 * code (E.164-style). No default country is assumed.
 */
export const internationalPhoneValidator = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{6,14}$/,
    'Phone number must be in international format with a country code, e.g. +27831234567'
  );

/**
 * POST /auth/register-pending
 *
 * Validates the approved registration fields. The password, password
 * confirmation and verification code are intentionally NOT part of this schema
 * — they must never reach the pending-registration store.
 */
export const registerPendingSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: emailValidator,
  phoneNumber: internationalPhoneValidator,
  organisationName: z
    .string()
    .trim()
    .min(2, 'Organisation name must be at least 2 characters')
    .max(100),
  marketingConsent: z.boolean().optional().default(false),
});
export type RegisterPendingInput = z.infer<typeof registerPendingSchema>;

/**
 * POST /auth/complete-profile
 *
 * Authenticated owner profile-completion recovery. The server derives sub,
 * tenantId, role and verified email from trusted JWT claims — the body MUST
 * NOT carry identity, tenantId, role, or a second contact email.
 *
 * Marketing consent is optional and defaults to NOT granted. `consentChannels`
 * may only be non-empty when `consentGranted` is true; a cross-field refine
 * enforces this so channels can never be inferred without an explicit opt-in.
 */
export const consentChannelSchema = z.enum(['email', 'sms']);

export const completeProfileSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, 'Full name is required')
      .max(100, 'Full name must be at most 100 characters'),
    phone: z
      .string()
      .trim()
      .min(5, 'Phone number is too short')
      .max(20, 'Phone number is too long')
      .regex(/^[+()\-\s0-9]+$/, 'Phone number contains invalid characters'),
    organisationName: z
      .string()
      .trim()
      .min(2, 'Organisation name must be at least 2 characters')
      .max(100, 'Organisation name must be at most 100 characters'),
    /** Optional marketing consent — defaults to false (unchecked). */
    consentGranted: z.boolean().optional().default(false),
    /** Channels explicitly selected; only permitted when consentGranted. */
    consentChannels: z.array(consentChannelSchema).max(2).optional().default([]),
  })
  .strict()
  .refine(
    (data) => data.consentGranted || data.consentChannels.length === 0,
    {
      message: 'Channels may only be selected when marketing consent is granted',
      path: ['consentChannels'],
    },
  );
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;

/**
 * POST /auth/invite
 */
export const inviteUserSchema = z.object({
  email: emailValidator,
  role: sellerRoleSchema,
  tenantId: z.string().min(1, 'Tenant ID is required'),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/**
 * PUT /auth/users/:id/role
 */
export const updateRoleSchema = z.object({
  role: sellerRoleSchema,
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/**
 * GET /auth/users — query parameters
 */
export const listUsersQuerySchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .pipe(z.number().int().min(1).max(100)),
  nextToken: z.string().optional(),
});
export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>;

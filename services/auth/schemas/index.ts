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
 * Password validator — enforces MerchOS password policy:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one symbol
 */
export const passwordValidator = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(
    /[^A-Za-z0-9]/,
    'Password must contain at least one symbol'
  );

/**
 * Seller role enum — matches the SellerRole type from @merch-os/types.
 */
export const sellerRoleSchema = z.enum(['viewer', 'editor', 'admin', 'owner']);

// ---------------------------------------------------------------------------
// Auth Request Schemas
// ---------------------------------------------------------------------------

// NOTE: loginSchema and refreshSchema were removed with the server-side
// POST /auth/login and POST /auth/refresh endpoints (seller frontend uses
// Amplify SRP + session refresh directly against Cognito).

/**
 * POST /auth/logout
 */
export const logoutSchema = z.object({
  global: z.boolean().optional(),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

/**
 * POST /auth/forgot-password
 */
export const forgotPasswordSchema = z.object({
  email: emailValidator,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * POST /auth/reset-password
 */
export const resetPasswordSchema = z.object({
  email: emailValidator,
  code: z.string().min(1, 'Verification code is required'),
  newPassword: passwordValidator,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * POST /auth/verify-email
 */
export const verifyEmailSchema = z.object({
  email: emailValidator,
  code: z.string().min(1, 'Verification code is required'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

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
 * POST /auth/change-password
 */
export const changePasswordSchema = z.object({
  previousPassword: z.string().min(1, 'Previous password is required'),
  proposedPassword: passwordValidator,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * POST /auth/mfa/setup (verify step)
 */
export const mfaVerifySchema = z.object({
  verificationCode: z.string().min(1, 'Verification code is required'),
  session: z.string().min(1, 'Session is required'),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

/**
 * PUT /auth/users/:id/role
 */
export const updateRoleSchema = z.object({
  role: sellerRoleSchema,
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

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

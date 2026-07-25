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

/**
 * POST /auth/login
 */
export const loginSchema = z.object({
  email: emailValidator,
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * POST /auth/refresh
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

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

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

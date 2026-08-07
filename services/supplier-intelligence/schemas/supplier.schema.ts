import { z } from 'zod';

/**
 * Schema for creating a new supplier profile.
 * Validates: Requirements 1.6, 12.4
 */
export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required').max(200, 'Supplier name must not exceed 200 characters'),
  contactEmail: z.string().email('Invalid email format').optional(),
  contactPhone: z.string().max(30, 'Phone number must not exceed 30 characters').optional(),
  website: z.string().url('Invalid URL format').optional(),
  notes: z.string().max(2000, 'Notes must not exceed 2000 characters').optional(),
  duplicateStrategy: z.enum(['SKIP', 'MERGE', 'CREATE_FLAGGED']).default('CREATE_FLAGGED'),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/**
 * Schema for updating an existing supplier profile.
 * All fields are optional since partial updates are allowed.
 * Validates: Requirements 1.6, 12.4
 */
export const updateSupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required').max(200, 'Supplier name must not exceed 200 characters').optional(),
  contactEmail: z.string().email('Invalid email format').optional(),
  contactPhone: z.string().max(30, 'Phone number must not exceed 30 characters').optional(),
  website: z.string().url('Invalid URL format').optional(),
  notes: z.string().max(2000, 'Notes must not exceed 2000 characters').optional(),
  duplicateStrategy: z.enum(['SKIP', 'MERGE', 'CREATE_FLAGGED']).optional(),
});

export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/**
 * Schema for the list suppliers query string parameters.
 * Supports pagination via limit and lastEvaluatedKey cursor.
 * Validates: Requirements 1.4
 */
export const listSuppliersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  lastEvaluatedKey: z.string().optional(),
}).default({});

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

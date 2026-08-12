import { z } from 'zod';

export const createProductSchema = z.object({
  title: z.string().min(1, 'title is required'),
  sku: z.string().min(1, 'sku is required'),
  brand: z.string().min(1, 'brand is required'),
  shortDescription: z.string().optional(),
  longDescription: z.string().optional(),
  bulletPoints: z.array(z.string()).optional(),
  manufacturer: z.string().optional(),
  barcode: z.string().optional(),
  mpn: z.string().optional(),
  weight: z.number().optional(),
  weightUnit: z.enum(['g', 'kg', 'lb', 'oz']).optional(),
  length: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  dimensionUnit: z.enum(['cm', 'in', 'mm']).optional(),
  materials: z.array(z.string()).optional(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  stockQuantity: z.number().int().min(0).optional(),
  fulfilmentMethod: z.string().optional(),
  leadtimeDays: z.number().int().min(0).optional(),
}).strict(); // reject unknown fields

export const updateProductSchema = z.object({
  title: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  shortDescription: z.string().nullable().optional(),
  longDescription: z.string().nullable().optional(),
  bulletPoints: z.array(z.string()).optional(),
  manufacturer: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  mpn: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
  weightUnit: z.enum(['g', 'kg', 'lb', 'oz']).nullable().optional(),
  length: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  dimensionUnit: z.enum(['cm', 'in', 'mm']).nullable().optional(),
  materials: z.array(z.string()).optional(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  stockQuantity: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).nullable().optional(),
  fulfilmentMethod: z.string().nullable().optional(),
  leadtimeDays: z.number().int().min(0).nullable().optional(),
  handlingTimeDays: z.number().int().min(0).nullable().optional(),
  listingStatus: z.enum(['active', 'draft']).optional(), // 'archived' excluded — use DELETE endpoint
}).strict(); // reject unknown fields (including pricing and system fields)

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

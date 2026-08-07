import { z } from 'zod';

/**
 * Enum values for all supported generation types.
 */
export const generationTypeEnum = z.enum([
  'title',
  'description',
  'bullets',
  'seo',
  'category',
  'brand',
  'attributes',
  'keywords',
  'compliance',
]);

/**
 * Enum values for all supported marketplace identifiers.
 */
export const marketplaceIdEnum = z.enum(['amazon', 'shopify', 'ebay']);

/**
 * Schema for product price data.
 */
export const priceSchema = z.object({
  amount: z.number({ required_error: 'Price amount is required' }).nonnegative('Price amount must be non-negative'),
  currency: z.string({ required_error: 'Price currency is required' }).min(1, 'Price currency is required'),
});

/**
 * Schema for product data submitted with a generation request.
 * All fields are optional to support partial product data input.
 */
export const productDataSchema = z.object({
  name: z.string().min(1, 'Product name must not be empty').max(500, 'Product name must not exceed 500 characters').optional(),
  description: z.string().max(10000, 'Product description must not exceed 10000 characters').optional(),
  category: z.string().max(500, 'Category must not exceed 500 characters').optional(),
  brand: z.string().max(200, 'Brand must not exceed 200 characters').optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  images: z.array(z.string().url('Each image must be a valid URL')).optional(),
  price: priceSchema.optional(),
  existingContent: z.string().max(50000, 'Existing content must not exceed 50000 characters').optional(),
});

/**
 * Schema for validating a generation request body.
 * Validates: Requirements 16.3, 16.6
 */
export const generateRequestSchema = z.object({
  type: generationTypeEnum,
  productData: productDataSchema,
  marketplace: marketplaceIdEnum.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;
export type ProductDataInput = z.infer<typeof productDataSchema>;
export type GenerationType = z.infer<typeof generationTypeEnum>;
export type MarketplaceId = z.infer<typeof marketplaceIdEnum>;

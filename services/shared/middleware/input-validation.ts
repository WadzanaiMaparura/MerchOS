/**
 * Input Validation middleware for MerchOS Lambda handlers.
 *
 * Generic middy middleware that validates request body or query string parameters
 * against a Zod schema. On success, replaces the raw input with the parsed/validated
 * data. On failure, short-circuits with HTTP 400 and structured error details.
 *
 * Requirements: FR-15.4
 */

import middy from '@middy/core';
import type { ZodSchema, ZodError } from 'zod';
import { logger } from './powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InputValidationOptions {
  /** The Zod schema to validate against */
  schema: ZodSchema;
  /** Where to read input from — defaults to 'body' */
  source?: 'body' | 'queryStringParameters';
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middy middleware that validates request input against a Zod schema.
 *
 * Configuration:
 *   - schema: A Zod schema instance to validate against
 *   - source: 'body' (default) or 'queryStringParameters'
 *
 * Behavior:
 *   - For 'body': parses event.body (handles both string JSON and pre-parsed objects)
 *   - For 'queryStringParameters': validates event.queryStringParameters
 *   - On success: replaces event.body (or queryStringParameters) with parsed data
 *   - On failure: returns HTTP 400 with structured validation error
 *
 * @param options - Validation configuration
 */
export function inputValidationMiddleware(options: InputValidationOptions): middy.MiddlewareObj {
  const { schema, source = 'body' } = options;

  const before: middy.MiddlewareFn = async (request) => {
    const event = request.event as Record<string, unknown>;

    let rawInput: unknown;

    if (source === 'body') {
      rawInput = event['body'];

      // Handle string JSON body (API Gateway sends body as a string)
      if (typeof rawInput === 'string') {
        try {
          rawInput = JSON.parse(rawInput);
        } catch {
          logger.warn('Invalid JSON in request body');

          const response = {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Request body is not valid JSON',
                details: [],
              },
            }),
          };

          request.response = response as unknown as typeof request.response;
          return response;
        }
      }
    } else {
      rawInput = event['queryStringParameters'];
    }

    // If no input is provided, pass null/undefined through to Zod for validation
    const result = schema.safeParse(rawInput ?? undefined);

    if (!result.success) {
      const zodError = result.error as ZodError;

      logger.warn('Input validation failed', {
        source,
        issueCount: zodError.issues.length,
        issues: zodError.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });

      const response = {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Input validation failed',
            details: zodError.issues,
          },
        }),
      };

      request.response = response as unknown as typeof request.response;
      return response;
    }

    // Replace raw input with parsed/validated data
    if (source === 'body') {
      event['body'] = result.data;
    } else {
      event['queryStringParameters'] = result.data;
    }

    return;
  };

  return { before };
}

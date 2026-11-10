/**
 * Generate Export Lambda handler — POST /export
 *
 * Body: { products: [{ product, topCategory?, category?, offer? }], mode,
 *         templateId?, partial? }
 * Returns the generated export file (CSV content + metadata). Returns 409 when
 * the batch is blocked by validation failures (and not a partial export), with
 * the blocking validation results in the error payload.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ExportService,
  ExportBlockedError,
  ExportSchemaNotFoundError,
  type ExportRequest,
} from '../export-service.js';

let service: ExportService | undefined;

/** Test seam: inject an ExportService. */
export function setExportService(s: ExportService): void {
  service = s;
}

function resolveService(): ExportService {
  return (service ??= new ExportService());
}

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify({ error: { code, message, ...extra } }) };
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  let body: Partial<ExportRequest>;
  try {
    body = event.body ? (JSON.parse(event.body) as Partial<ExportRequest>) : {};
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
  }

  if (!Array.isArray(body.products) || body.products.length === 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'A non-empty "products" array is required.');
  }
  if (!body.mode) {
    return errorResponse(400, 'VALIDATION_ERROR', 'An export "mode" is required.');
  }

  try {
    const req: ExportRequest = { products: body.products, mode: body.mode };
    if (body.templateId !== undefined) req.templateId = body.templateId;
    if (body.partial !== undefined) req.partial = body.partial;

    const { output, validated, excluded } = resolveService().export(req);
    return {
      statusCode: 200,
      body: JSON.stringify({
        export: {
          format: output.format,
          filename: output.filename,
          content: output.content,
          rowCount: output.rowCount,
          columns: output.columns,
        },
        validatedCount: validated.length,
        excludedCount: excluded.length,
        excluded,
      }),
    };
  } catch (err) {
    if (err instanceof ExportSchemaNotFoundError) {
      return errorResponse(422, 'SCHEMA_NOT_FOUND', err.message);
    }
    if (err instanceof ExportBlockedError) {
      return errorResponse(409, 'EXPORT_BLOCKED', err.message, {
        validationResults: err.validationResults,
      });
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'Export generation failed unexpectedly.');
  }
}

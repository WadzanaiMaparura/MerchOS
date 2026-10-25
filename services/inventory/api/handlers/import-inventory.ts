/**
 * Import Inventory Lambda handler — POST /inventory/import
 *
 * Accepts a CSV body (header `sku,warehouseId,onHand`) and applies absolute
 * stock updates with partial-success semantics: valid rows commit independently
 * (each with its own ledger entry), invalid rows are reported without aborting
 * the others. Whole-file contract violations (bad header, >1,000 rows, >1 MB)
 * return a 4xx and process no rows.
 *
 * RBAC: inventory:update. tenantId and actor come only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../../shared/middleware/tenant-context';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { InventoryService, getInventoryService } from '../../service';
import type { CsvImportRowResult } from '../../service';
import {
  parseInventoryCsv,
  CsvContractError,
  CSV_MAX_BYTES,
} from '../csv-parser';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

let injected: InventoryService | undefined;

export function setInventoryService(service: InventoryService): void {
  injected = service;
}

function resolveService(): InventoryService {
  return injected ?? getInventoryService();
}

/** Read the trusted actor (JWT sub) from the authorizer claims. */
function extractActor(event: APIGatewayProxyEventV2): string {
  const authorizer = (event.requestContext as unknown as Record<string, unknown>)?.['authorizer'] as
    | Record<string, unknown>
    | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as Record<string, unknown> | undefined;
  const sub = claims?.['sub'] as string | undefined;
  return sub ?? 'unknown';
}

function decodeBody(event: APIGatewayProxyEventV2): string {
  const raw = event.body ?? '';
  if (event.isBase64Encoded) {
    return Buffer.from(raw, 'base64').toString('utf-8');
  }
  return raw;
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }

  const csv = decodeBody(event);

  // Fast whole-file size guard before parsing.
  if (Buffer.byteLength(csv, 'utf-8') > CSV_MAX_BYTES) {
    return ApiErrors.payloadTooLarge('CSV body exceeds 1 MB') as APIGatewayProxyResultV2;
  }

  // Parse — whole-file contract violations throw and short-circuit with 4xx.
  let parsed;
  try {
    parsed = parseInventoryCsv(csv);
  } catch (error) {
    if (error instanceof CsvContractError) {
      if (error.code === 'PAYLOAD_TOO_LARGE') {
        return ApiErrors.payloadTooLarge(error.message) as APIGatewayProxyResultV2;
      }
      if (error.code === 'CSV_TOO_MANY_ROWS') {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: { code: 'CSV_TOO_MANY_ROWS', message: error.message } }),
        };
      }
      return ApiErrors.csvInvalidHeader(error.message) as APIGatewayProxyResultV2;
    }
    logger.error('CSV parse failed unexpectedly', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }

  const actor = extractActor(event);

  try {
    // Apply the valid parsed rows through the service (per-row atomic writes).
    const serviceResult = await resolveService().importCsvRows(
      tenantContext.tenantId,
      parsed.rows,
      actor
    );

    // Merge parse-level row errors (bad field count / non-integer / negative)
    // with the service results, preserving file order by rowNumber.
    const parseErrorResults: CsvImportRowResult[] = parsed.rowErrors.map((e) => ({
      rowNumber: e.rowNumber,
      sku: e.sku,
      warehouseId: e.warehouseId,
      status: 'rejected' as const,
      error: e.error,
    }));

    const allResults = [...serviceResult.results, ...parseErrorResults].sort(
      (a, b) => a.rowNumber - b.rowNumber
    );

    const totalRows = serviceResult.summary.totalRows + parsed.rowErrors.length;
    const rejected = serviceResult.summary.rejected + parsed.rowErrors.length;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: {
          totalRows,
          accepted: serviceResult.summary.accepted,
          rejected,
        },
        results: allResults,
      }),
    };
  } catch (error) {
    logger.error('CSV import failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'inventory', action: 'update' }))
  .use(tenantContextMiddleware());

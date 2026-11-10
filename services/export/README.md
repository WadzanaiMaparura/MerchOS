# @merch-os/export

The **Export Engine** — the final stage of the export pipeline. It generates a
platform-specific export file from canonical products that have passed
validation. For Takealot this is a loadsheet-shaped CSV whose columns follow the
schema's exact `columnOrder`.

See [docs/architecture/schema-validation-architecture.md](../../docs/architecture/schema-validation-architecture.md) §6.

## Pipeline order (hard gate)

```
Schema Lookup → Validation (ExportService) → Export Generation
```

The `ExportService` validates **every** product first (via `@merch-os/validation`)
and only exports those that pass. A batch is **blocked** if any product fails,
unless the caller opts into a **partial** export (export the passing products,
return the failing ones in `excluded`).

## Layers

```
engine/   pure, deterministic generation (no I/O)
  csv.ts              RFC-4180 CSV serialization (CRLF, correct escaping)
  xlsx.ts             deterministic XLSX workbook (pinned metadata)
  export-engine.ts    canonical products + schema + mode -> CSV or XLSX
delivery/ persistence (injectable; only this layer touches AWS)
  delivery.ts         pure deliverExport() against an ObjectStoragePort
  s3-storage.ts       S3 adapter: PutObject (SSE-KMS) + presigned download URL
api/      service boundary
  export-service.ts        schema lookup + validation gate + generation + delivery
  handlers/generate-export.ts   POST /export Lambda handler
```

## Output formats

- **CSV** (default) — comma-separated, used for offers and general export.
- **XLSX** — native Takealot product-creation loadsheet. Request with
  `format: 'XLSX'`. Workbook metadata is pinned so output is byte-identical for
  identical inputs. In the handler response, XLSX `content` is base64-encoded
  (`encoding: 'base64'`); CSV is plain UTF-8.

## Delivery (stage 7)

When a `delivery: { tenantId, exportId }` is supplied and the service has an
`ObjectStoragePort`, the export is written to the exports bucket at
`tenants/{tenantId}/exports/{exportId}/{filename}` and a time-limited signed
download URL is returned in `artifact`. The engine stays pure — S3 access lives
only in `delivery/s3-storage.ts`, injected at the service boundary. In the
deployed Lambda the handler builds an `S3ObjectStorage` from `EXPORTS_BUCKET` /
`PLATFORM_KMS_KEY_ARN` env vars.

## Infrastructure

`infrastructure/lib/export-api-stack.ts` provisions an HTTP API (Cognito JWT) with
`POST /validate` and `POST /export`, ESM-bundled Lambdas, and least-privilege IAM
(the export Lambda may write `tenants/*/exports/*` in the exports bucket and use
the platform KMS key; the validate Lambda needs no data-store access).

## Export modes (architecture §6.2)

| Mode | Columns |
| --- | --- |
| `full-create` | the schema's full `columnOrder` (product creation) |
| `offer-update` | barcode, sku, stock, selling price, rrp, leadtime |
| `inventory-sync` | barcode, sku, stock |
| `price-update` | barcode, sku, selling price, rrp |

## Determinism (architecture §6.5)

Same products + schema + mode ⇒ **byte-identical** output (CRLF line endings,
stable column order, no locale/time nondeterminism). This enables snapshot
testing and audit-trail verification.

## Invariants

- Never invents or truncates data — cells reflect mapped values exactly.
- Reads canonical data; never writes back.
- Images are resolved to public URLs via an injected `imageUrlResolver`
  (signed S3 / CDN URL); the engine does not hardcode AWS.

## Usage

```ts
import { ExportService } from '@merch-os/export';

const { output, excluded } = new ExportService().export({
  products: [{ product, topCategory: 'Women (29434)' }],
  mode: 'full-create',
  imageUrlResolver: (s3Key) => signCloudFrontUrl(s3Key),
});
// output.content is the CSV; `excluded` holds any products blocked by validation
```

## Test

```bash
npm test
```

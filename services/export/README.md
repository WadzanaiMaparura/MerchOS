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
  export-engine.ts    canonical products + schema + mode -> CSV document
api/      service boundary
  export-service.ts        schema lookup + validation gate + generation
  handlers/generate-export.ts   POST /export Lambda handler
```

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

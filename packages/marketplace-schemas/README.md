# @merch-os/marketplace-schemas

Marketplace content-file **Schema Registry** for MerchOS. Data-only; no AWS
dependencies. Schemas are extracted from authoritative platform templates into
JSON, then exposed through the canonical `MarketplaceSchema` contract from
`@merch-os/types`.

See [docs/architecture/schema-validation-architecture.md](../../docs/architecture/schema-validation-architecture.md).

## Takealot (ZA)

### Sources

`sources/takealot-za/*.xlsm` — Takealot's official content loadsheets (34
category templates), committed as the source of truth so the registry is fully
re-generatable.

### Generated schemas

`generated/takealot-za/*.json` — one schema per loadsheet, plus `_index.json`.
**Do not hand-edit these** — regenerate from the `.xlsm` sources.

Each loadsheet schema is extracted directly from the workbook:

| Signal | Source in the `.xlsm` |
| --- | --- |
| Field order + metadata | `Loadsheet` sheet header rows (1, 3, 4, 5, 6) |
| Allowed values (enums) | `LOOKUP_*` defined names → referenced cells |
| Per-category required attrs | `LOOKUP_NODEREQ_{nodeId}` defined names |
| Per-category recommended attrs | `LOOKUP_NODEREC_{nodeId}` defined names |
| Core required flags | `REQUIRE_*` defined names |
| Category tree | `Category Tree Lookup` sheet |

**Requiredness is a hybrid signal** (not `allowBlank`, which Takealot sets on
every validated cell):

- **Core fields** (`title`, `Category`, `Brand`, `ProductID.Value`, ...):
  required when the cell's data-validation `allowBlank` is `false` or a matching
  `REQUIRE_*` flag is set.
- **Category attributes** (`Attribute.*`, `color.*`, `Variant.attribute.*`,
  `Images.*`): required/recommended per leaf category node via NODEREQ/NODEREC.

Dynamic (category-dependent) dropdowns such as `Category`
(`INDIRECT(VLOOKUP(...))`) are recorded as
`allowedValuesSource: { kind: "dynamic", formula }` rather than materialised, so
no invented values ever enter a schema.

### Regenerate

```bash
npm run extract:takealot            # all loadsheets
npm run extract:takealot loadsheet-99   # a single one
```

The extractor uses `exceljs`. Some loadsheets store cell comments at a
non-standard zip path that `exceljs` fails to reconcile; the extractor strips
those (lossless) comment parts via `adm-zip` and retries automatically.

## API

```ts
import {
  listTakealotSchemas,
  getSchema,            // -> canonical MarketplaceSchema
  getRawSchema,         // -> lossless raw extraction
  getCategoryRule,      // per-leaf-node required/recommended
  findTemplateForCategoryNode,
} from '@merch-os/marketplace-schemas';
```

## Test

```bash
npm test
```

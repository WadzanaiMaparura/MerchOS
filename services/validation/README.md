# @merch-os/validation

The **Validation Engine** — the deterministic gatekeeper for marketplace
exports. Given a `CanonicalProduct` and a target marketplace schema, it produces
a typed `ValidationResult`. Export is allowed only when there are zero ERROR
findings (a hard gate).

See [docs/architecture/schema-validation-architecture.md](../../docs/architecture/schema-validation-architecture.md) §4.

## Layers

```
engine/   pure, deterministic validation logic (no I/O, no schema lookup)
  canonical-to-takealot.ts   CanonicalProduct -> flat Takealot field-map (§5 mapping)
  validation-engine.ts       field-map + schema -> ValidationResult (§4 rules)
api/      service boundary
  validation-service.ts      Schema Registry lookup + delegate to the engine
  handlers/validate-product.ts   POST /validate Lambda handler
```

The engine is **pure**: it receives a schema and never loads one itself. The
`ValidationService` owns the Schema Registry lookup (resolving a Takealot
loadsheet template from the product's category), which keeps the engine fully
unit-testable and side-effect free.

## Rule coverage

Schema-driven (from `@merch-os/marketplace-schemas`), per leaf category node:
- **Presence** — required (all categories) and conditionally-required (NODEREQ) fields
- **Enumeration** — value must be in the field's allowed list (tolerant of
  `Label (id)` forms and Yes/No ↔ True/False)
- **Length** — max character length
- **Range** — numeric min/max bounds

Canonical-level (not expressible on the raw field-map):
- **Barcode** — GTIN check-digit (barcode is optional; invalid when present is an ERROR)
- **Commercial** — selling price > 0 (ERROR), selling price > RRP (WARNING), stock ≥ 0 (ERROR)
- **Images** — at least one image reference (WARNING)

It intentionally does **not** make content/review judgements (e.g. "attribute &
description mismatch"), which Takealot decides subjectively and reports
separately from system validation.

## Module system

This service is **ESM** (`"type": "module"`, `NodeNext`), because it depends on
the ESM `@merch-os/marketplace-schemas` package. AWS Lambda supports ESM handlers
on Node 18/20.

## Usage

```ts
import { ValidationService } from '@merch-os/validation';

const result = new ValidationService().validate({
  product,                       // CanonicalProduct
  topCategory: 'Women (29434)',  // optional display value
  // templateId resolved from the product's Takealot category if omitted
});

if (!result.exportAllowed) {
  console.log(result.findings.filter((f) => f.severity === 'ERROR'));
}
```

## Test

```bash
npm test
```

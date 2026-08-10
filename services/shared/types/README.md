# services/shared/types/

Common TypeScript interfaces used by shared middleware and utility modules across MerchOS backend services.

## Active Types

| File | Contents | Used By |
|------|----------|---------|
| `common.types.ts` | `ChannelId`, `LanguageCode`, `EventType`, `NotificationChannel`, `PlanId` | Shared primitives referenced throughout services |
| `tenant.types.ts` | `Tenant`, `TenantSettings`, `WebhookConfig`, `ChannelIntegration` | Tenant management middleware |
| `inventory.types.ts` | `InventoryRecord`, `InventoryTransaction` | Inventory tracking services |
| `billing.types.ts` | `Subscription`, `UsageRecord`, `PlanLimits`, `Invoice` | Billing and subscription management |

## Deprecated Types

| File | Status | Replacement |
|------|--------|-------------|
| `product.types.ts` | **DEPRECATED — DO NOT IMPORT** | Use `CanonicalProduct` from `packages/types/src/marketplace.ts` for domain logic. Use `Product` from `packages/types/src/product.ts` for API DTOs. |

## Where does the product domain model live?

The canonical product domain model is **`CanonicalProduct`** in `packages/types/src/marketplace.ts`. This is the single source of truth for product data in MerchOS (per [ADR-004](../../docs/architecture/adr/ADR-004-canonical-product-domain-model.md)).

The `product.types.ts` file in this directory is an orphaned early-architecture artifact with zero consumers. It must NOT be imported for new development.

# ADR-006: International-Ready Architecture, South-Africa-First Launch

## Status

**Accepted**

Date: 2026-11-08

Builds on: ADR-003 (canonical product model + marketplace adapters), ADR-004 (canonical product domain model).

## Context

MerchOS launches targeting the South African market (Takealot first, then Makro, plus Amazon/Shopify/WooCommerce as SA-usable channels). However, the core value proposition — raw mixed product media in, AI-synthesised listing out, marketplace-specific CSV out — is inherently **market-agnostic**. The engine does not depend on anything South-Africa-specific.

Because MerchOS delivers **downloadable CSVs** (the seller uploads them manually) rather than integrating with marketplace APIs, the hardest part of going international (per-country marketplace API integration, auth, rate limits) does not apply. Expanding to new countries is predominantly a matter of **adding marketplace adapters and locale configuration**, not re-architecting.

The risk is not the architecture; it is **premature scope**: chasing US/UK/CA marketplace schemas before the SA/Takealot pipeline works end to end. Equally, baking South-Africa assumptions into the data model (flat marketplace names, implicit `en-ZA` copy, metric-only units, a single category taxonomy) would be expensive to retrofit later.

## Decision

**Build an international-ready architecture but launch SA-first.** Do not target the US/UK/CA yet and do not build their adapters now, but do NOT bake SA-only assumptions into the data model. Specifically:

1. **Marketplaces are country-scoped.** A marketplace is modelled as `{ id, name, country, locale, currency }`, not a bare name. "Amazon" is therefore `amazon-za`, `amazon-us`, `amazon-uk`, etc. — distinct adapters sharing a common base. This is the single most important future-proofing decision; retrofitting country scope later touches every adapter, batch, and export record.

2. **Locale-aware synthesis.** The AI synthesis pipeline threads a `targetLocale` (default `en-ZA`). Generated copy (title, description, spelling, phrasing) can switch to `en-US` / `en-GB` later by changing a parameter, with no re-plumbing. Prompts are parameterised by locale.

3. **Structured units, not baked-in metric.** Measurements are stored in the canonical model as `{ value, unit }` pairs (consistent with the Takealot loadsheet's value/unit attributes). Adapters convert to each marketplace's mandated unit system (metric vs imperial) at export time. The canonical model never assumes cm/kg.

4. **Seller profile carries `country` / `market`.** Defaults to South Africa. Drives default marketplace options and default `targetLocale`.

5. **Adapter registry keyed by `marketplace + country` (+ category, per ADR-003).** Adding "Amazon US" later is dropping in one adapter and its category/attribute mappings, not modifying core logic. The canonical product model and synthesis/review pipeline remain untouched when a new country adapter is added.

## Explicitly out of scope for launch (deliberate non-goals)

- Building US / UK / CA marketplace adapters (no demand yet; each is real work against real, sourced schemas).
- Currency / tax handling — pricing, stock and lead time are the seller's responsibility set directly on the marketplace (MerchOS produces the content CSV only), so currency affects display at most, not the CSV.
- UI copy localisation — English serves ZA, US, UK, and CA; no i18n framework yet.
- Data-residency / GDPR infrastructure changes — revisit only when an EU/UK seller is actually in sight. (Note: the platform already runs in `eu-west-1`.)
- eBay / Etsy and other non-launch marketplaces remain out of the shipped marketplace list, but the country-scoped model makes re-adding `ebay-uk` / `ebay-us` trivial later.

## Consequences

**Positive**
- International expansion becomes incremental: add an adapter per `marketplace+country`, nothing else changes.
- The CSV-out model sidesteps per-country marketplace API integration entirely.
- Cheap now: these are mostly data-shape decisions, not new subsystems.

**Negative / costs**
- Every adapter, batch, and export artifact carries a country/locale dimension from day one, even while only SA ships (minor added structure).
- Each new country marketplace still requires sourcing and encoding that marketplace's real schema, category taxonomy, required/compliance fields, and unit expectations — the bulk of per-market work, done when entering the market.

## Guardrail

When building the create-listings and export engine, treat marketplace identity as `marketplace + country + locale` and keep synthesis locale-parameterised and units structured — even though only Takealot (SA, `en-ZA`) ships first. Do not add other-country adapters until that market is deliberately targeted.

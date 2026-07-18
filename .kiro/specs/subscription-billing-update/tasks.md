# Implementation Plan: Subscription & Billing Architecture Update

## Overview

This implementation plan updates Section 10 (Billing and Subscription Management) of the MerchOS platform design document (`.kiro/specs/merch-os-platform/design.md`). All tasks involve modifying Markdown documentation with embedded Mermaid diagrams, JSON data model examples, and feature matrix tables. No application code is generated — the deliverable is an updated architecture document only.

## Tasks

- [x] 1. Remove deprecated plan tiers and establish new plan structure
  - [x] 1.1 Remove all references to deprecated plan tiers from Section 10
    - Search Section 10 for all references to "Launch", "Starter", and "Growth" plans
    - Remove or replace deprecated plan references in plan descriptions, feature matrices, upgrade paths, and limit tables
    - Ensure zero remaining references to deprecated tier names in any subsection
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Document the three-tier subscription plan structure with pricing
    - Define exactly three Subscription Plans: Professional (R499/month), Business (R999/month), Enterprise (custom pricing)
    - Document Professional as the visually recommended tier in pricing presentation context
    - Document that Enterprise entitlements are defined per contract and stored in configuration rather than hardcoded
    - Document that all plan definitions are stored in DynamoDB Plans table and updatable by operators without code deployment
    - Include JSON data model examples for each plan definition (Professional, Business, Enterprise)
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4_

- [x] 2. Document Free Trial strategy and Pricing Philosophy
  - [x] 2.1 Add Free Trial section to Section 10
    - Document the Free Trial as the primary acquisition mechanism replacing low-cost entry plans
    - Specify that Free Trial grants access to Professional Plan features with reduced usage limits
    - Document configurable Trial Duration (14 or 30 days) stored in platform configuration, not hardcoded
    - Specify the reduced usage limits during the trial period as distinct from full Professional Plan limits
    - Document trial expiry behaviour: auto-convert to paid Professional subscription (if payment method on file) or suspend access pending payment collection
    - Include JSON data model for Free Trial configuration (CONFIG#trial record)
    - Include JSON data model for tenant billing record during trial status
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.2 Add Pricing Philosophy section to Section 10
    - Create a dedicated Pricing Philosophy subsection
    - State that MerchOS is a professional business platform
    - State that pricing reflects business value delivered through operational time savings and productivity improvements
    - State that the pricing objective is to attract serious sellers who derive measurable business value, not to maximise low-value subscription volume
    - State that customers subscribe because MerchOS saves operational time and improves productivity for e-commerce operations
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 3. Document Promotions Engine as distinct subsystem
  - [x] 3.1 Add Promotions Engine subsystem documentation to Section 10
    - Define the Promotions Engine as a subsystem responsible for applying temporary pricing modifications to Subscription Plans
    - Document supported promotion types: Founding Seller, Launch Campaign, Referral Reward, Coupon Code, Percentage Discount, Fixed Amount Discount, Seasonal Campaign (including Black Friday)
    - Document that each Promotion has a mandatory expiry date after which promotional pricing ceases
    - Document that the Founding Seller concept is preserved solely as a promotion type, not a subscription plan or permanent pricing tier
    - Remove any references to "Founding Seller programme" as a plan tier
    - Document Promotions Engine Lambda functions: promotions-create-fn, promotions-apply-fn, promotions-expire-fn, promotions-list-fn
    - Document Promotions Engine AWS services: Lambda, DynamoDB (Promotions table), EventBridge, EventBridge Scheduler, Stripe Coupons API
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 3.2 Add Promotions Engine data models and API endpoints
    - Document DynamoDB Promotions Table design (PK, SK, attributes, GSI1)
    - Include JSON data model example for a promotion record
    - Document promotion types table with descriptions and pricing modification types
    - Document API endpoints: POST/GET/PUT/DELETE for admin promotions, POST for tenant apply, GET for tenant active promotions
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 4. Document architectural separation and Billing Principles
  - [x] 4.1 Add Billing Principles section to Section 10
    - Create a dedicated Billing Principles subsection
    - State that permanent Subscription Plans and temporary marketing Promotions are separate architectural concepts
    - State that Subscription Plans define entitlements and usage limits while Promotions modify pricing temporarily without altering entitlements
    - Document that a Promotion applied to a Subscription Plan does not change usage limits, feature access, or plan-level entitlements
    - Document that Promotions have an independent lifecycle (creation, activation, expiry) decoupled from the Subscription Plan lifecycle (subscription, renewal, upgrade, cancellation)
    - Include the Mermaid architectural separation diagram showing Plans vs Promotions relationship
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.2 Update Billing Engine documentation for trial and promotion awareness
    - Update Billing Engine Lambda function documentation to include trial-related functions: billing-trial-provision-fn, billing-trial-conversion-fn
    - Document that billing-limit-enforcer-fn now reads trial-specific limits in addition to plan limits
    - Document that billing-stripe-webhook-fn processes trial expiry transitions
    - Document integration point: Billing Engine checks active promotions via Promotions Engine before creating Stripe subscriptions
    - Include Mermaid context diagram showing Billing Engine, Promotions Engine, Plans Table, and external integrations
    - _Requirements: 3.3, 5.1, 6.1, 6.4_

- [x] 5. Checkpoint - Review architectural sections
  - Ensure Billing Principles, Pricing Philosophy, Promotions Engine, and Free Trial sections are complete and internally consistent. Verify Mermaid diagrams render correctly. Ask the user if questions arise.

- [x] 6. Update Feature Matrix and Upgrade Path
  - [x] 6.1 Replace Feature Matrix with updated three-tier version
    - Create Feature Matrix with columns for Professional, Business, and Enterprise only
    - Remove any columns or references to Launch, Starter, or Growth plans
    - Include rows for: maximum products, maximum channels, maximum users, AI enrichment calls/month, image processing calls/month, CSV exports/month, and additional differentiating features (Priority Support, Dedicated Account Manager, SAML SSO, Custom Integrations, SLA Guarantee)
    - Include a Free Trial row or annotation showing reduced entitlements during trial period
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 6.2 Update Upgrade Path documentation
    - Define the Upgrade Path as: Free Trial → Professional → Business → Enterprise
    - Document the Free Trial as the primary acquisition mechanism and entry point for new Tenants
    - Document that upgrade transitions follow proration and entitlement unlock behaviour from existing Billing Engine spec
    - Document that downgrade from Enterprise requires MerchOS sales coordination
    - Document that self-service downgrade is available between Professional and Business
    - Include Mermaid upgrade path diagram and upgrade/downgrade rules table
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 7. Document future flexibility and finalize
  - [x] 7.1 Add configuration-driven extensibility documentation
    - State that the number of Subscription Plans is not hardcoded; additional plans can be introduced through DynamoDB Plans table configuration updates
    - State that the Billing Engine is configuration-driven, reading plan definitions, entitlements, and limits from the Plans table at runtime
    - State that adding a new Subscription Plan requires only a configuration entry, not code changes or redeployment
    - State that the Promotions Engine is similarly configuration-driven, supporting new promotion types through configuration
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 7.2 Add scope boundaries and update tenant billing record documentation
    - Document that the architecture update is limited to Section 10 and directly related plan references in adjacent sections
    - Verify no modifications to RBAC documentation, non-billing API endpoints, or authentication/authorisation architecture
    - Confirm no implementation code, Lambda source, or IaC templates are included
    - Maintain enterprise SaaS documentation standards: consistent formatting, defined terminology from glossary, traceability to approved business decisions
    - Update tenant billing record JSON examples showing active subscription with promotions and trial status variants
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 8. Final checkpoint - Validate complete architecture document update
  - Ensure all ten requirements are addressed in the updated Section 10. Verify zero references to deprecated plan names (Launch, Starter, Growth). Verify Feature Matrix has exactly three plan columns plus Free Trial annotation. Verify all Mermaid diagrams render correctly and all JSON data models are well-formed. Ask the user if questions arise.

## Notes

- All deliverables are updates to the existing Markdown architecture document — no application code is produced
- Mermaid diagrams are used for architectural visualisation (billing context, plan/promotion separation, upgrade path)
- JSON examples are included as documentation of data model design, not executable code
- The target file is `.kiro/specs/merch-os-platform/design.md` Section 10
- No property-based tests are applicable since the deliverable is architecture documentation, not executable code
- Deprecated tier names (Launch, Starter, Growth) must not appear anywhere in the updated sections
- The Founding Seller concept is preserved only as a promotion type, never as a subscription plan

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["7.1", "7.2"] }
  ]
}
```

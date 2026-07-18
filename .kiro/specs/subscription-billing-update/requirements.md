# Requirements Document

## Introduction

This document defines the requirements for updating the MerchOS Subscription & Billing Architecture documentation. The update reflects approved business decisions: consolidation from five pricing tiers to three (Professional, Business, Enterprise), introduction of a free trial acquisition strategy, a Promotions Engine replacing the Founding Seller programme, and architectural separation of subscription plans from marketing promotions. The deliverable is an updated architecture document — no code implementation is in scope.

## Glossary

- **Architecture_Document**: The Subscription & Billing section (Section 10) of the MerchOS platform design document located at `.kiro/specs/merch-os-platform/design.md`
- **Billing_Engine**: The billing subsystem responsible for subscription lifecycle, plan enforcement, usage metering, and payment processing via Stripe
- **Subscription_Plan**: A permanent, configuration-defined tier that grants specific entitlements and usage limits to a Tenant
- **Professional_Plan**: The primary subscription tier at R499/month targeting independent sellers
- **Business_Plan**: The high-volume subscription tier at R999/month targeting teams, agencies, and high-volume sellers
- **Enterprise_Plan**: The custom-pricing subscription tier for large retailers, manufacturers, and distributors
- **Free_Trial**: A time-limited period granting access to Professional_Plan features with reduced usage limits, serving as the primary acquisition mechanism
- **Trial_Duration**: A configurable parameter (14 or 30 days) defining the length of a Free_Trial, stored in configuration rather than hardcoded
- **Promotions_Engine**: A subsystem that applies temporary pricing modifications (discounts, campaigns, coupon codes) to Subscription_Plans without altering plan entitlements
- **Promotion**: A temporary marketing campaign that modifies pricing for a limited time, architecturally separate from Subscription_Plans
- **Feature_Matrix**: A tabular section in the Architecture_Document mapping capabilities and limits to each Subscription_Plan
- **Upgrade_Path**: The documented progression a Tenant follows through subscription tiers: Free_Trial → Professional_Plan → Business_Plan → Enterprise_Plan
- **Pricing_Philosophy**: A set of documented principles explaining why MerchOS pricing targets professional business value rather than entry-level affordability

## Requirements

### Requirement 1: Remove Deprecated Plan Tiers

**User Story:** As a platform architect, I want the Architecture_Document to reflect only the approved subscription tiers, so that deprecated plans do not create confusion for developers or stakeholders.

#### Acceptance Criteria

1. THE Architecture_Document SHALL define exactly three Subscription_Plans: Professional_Plan, Business_Plan, and Enterprise_Plan
2. THE Architecture_Document SHALL contain no references to "Launch", "Starter", or "Growth" plans in any section including the Feature_Matrix, plan limits table, and upgrade path descriptions
3. WHEN documenting plan pricing, THE Architecture_Document SHALL state Professional_Plan at R499/month, Business_Plan at R999/month, and Enterprise_Plan at custom pricing determined per contract

---

### Requirement 2: Document Subscription Plan Structure

**User Story:** As a developer, I want each plan's entitlements and limits clearly documented, so that I can implement enforcement logic correctly.

#### Acceptance Criteria

1. THE Architecture_Document SHALL define for each Subscription_Plan the following entitlements: maximum products, maximum channels, maximum users, maximum AI enrichment calls per month, maximum image processing calls per month, and maximum CSV exports per month
2. THE Architecture_Document SHALL mark the Professional_Plan as the visually recommended tier in any pricing presentation context
3. WHERE a Tenant is on the Enterprise_Plan, THE Architecture_Document SHALL specify that entitlements are defined per contract and stored in configuration rather than hardcoded in the plan limits table
4. THE Architecture_Document SHALL specify that all plan definitions are stored in configuration (DynamoDB Plans table) and are updatable by operators without code deployment

---

### Requirement 3: Document Free Trial Strategy

**User Story:** As a product manager, I want the free trial mechanism documented in the architecture, so that engineering teams understand trial provisioning, limits, and conversion behaviour.

#### Acceptance Criteria

1. THE Architecture_Document SHALL define a Free_Trial that grants access to Professional_Plan features with reduced usage limits for AI enrichment calls, image processing calls, and CSV exports
2. THE Architecture_Document SHALL specify that Trial_Duration is configurable with supported values of 14 days or 30 days, stored in the platform configuration and not hardcoded in application logic
3. WHEN a Free_Trial expires without conversion, THE Architecture_Document SHALL specify that the Billing_Engine converts the Tenant into a paid Professional_Plan subscription or suspends access pending payment method collection
4. THE Architecture_Document SHALL document that the Free_Trial is the primary acquisition mechanism replacing low-cost entry plans
5. THE Architecture_Document SHALL specify the reduced usage limits applied during the Free_Trial period as distinct from the full Professional_Plan limits

---

### Requirement 4: Document Pricing Philosophy

**User Story:** As a stakeholder, I want the pricing philosophy captured in the architecture documentation, so that future pricing decisions remain consistent with the platform's market positioning.

#### Acceptance Criteria

1. THE Architecture_Document SHALL include a Pricing Philosophy section stating that MerchOS is a professional business platform
2. THE Architecture_Document SHALL state that pricing reflects business value delivered through operational time savings and productivity improvements, not entry-level affordability
3. THE Architecture_Document SHALL state that the pricing objective is to attract serious sellers who derive measurable business value, not to maximise low-value subscription volume
4. THE Architecture_Document SHALL state that customers subscribe because MerchOS saves operational time and improves productivity for their e-commerce operations

---

### Requirement 5: Document Promotions Engine

**User Story:** As a developer, I want the Promotions Engine documented as a distinct architectural component, so that I can implement promotional pricing without conflating it with subscription plan logic.

#### Acceptance Criteria

1. THE Architecture_Document SHALL define a Promotions_Engine as a subsystem responsible for applying temporary pricing modifications to Subscription_Plans
2. THE Architecture_Document SHALL specify that the Promotions_Engine supports the following promotion types: Founding Seller promotions, Launch campaigns, Referral rewards, Coupon codes, Percentage discounts, Fixed amount discounts, and Seasonal campaigns (including Black Friday)
3. THE Architecture_Document SHALL specify that each Promotion has a mandatory expiry date after which the promotional pricing ceases to apply
4. THE Architecture_Document SHALL contain no references to the "Founding Seller programme" as a subscription plan or permanent pricing tier
5. THE Architecture_Document SHALL document that the Founding Seller concept is preserved solely as a promotion type within the Promotions_Engine

---

### Requirement 6: Document Architectural Separation of Plans and Promotions

**User Story:** As a platform architect, I want a clear documented separation between subscription plans and promotional pricing, so that the engineering team implements them as independent concerns.

#### Acceptance Criteria

1. THE Architecture_Document SHALL include a Billing Principles section stating that permanent Subscription_Plans and temporary marketing Promotions are separate architectural concepts
2. THE Architecture_Document SHALL state that Subscription_Plans define entitlements and usage limits, while Promotions modify pricing temporarily without altering entitlements
3. THE Architecture_Document SHALL document that a Promotion applied to a Subscription_Plan does not change the Tenant's usage limits, feature access, or plan-level entitlements
4. THE Architecture_Document SHALL document that Promotions have a defined lifecycle (creation, activation, expiry) independent of the Subscription_Plan lifecycle (subscription creation, renewal, upgrade, cancellation)

---

### Requirement 7: Update Feature Matrix

**User Story:** As a developer, I want the Feature_Matrix to reflect only the current plan tiers, so that the architecture document serves as the single source of truth for plan capabilities.

#### Acceptance Criteria

1. THE Feature_Matrix SHALL include columns for Professional_Plan, Business_Plan, and Enterprise_Plan only
2. THE Feature_Matrix SHALL include no columns or references to Launch, Starter, or Growth plans
3. THE Feature_Matrix SHALL include rows for: maximum products, maximum channels, maximum users, AI enrichment calls per month, image processing calls per month, CSV exports per month, and any additional differentiating features between tiers
4. THE Feature_Matrix SHALL include a row or annotation for Free_Trial limits showing the reduced entitlements available during the trial period

---

### Requirement 8: Document Upgrade Path

**User Story:** As a product manager, I want the customer upgrade path clearly documented, so that the onboarding and upsell flows are built on an agreed progression.

#### Acceptance Criteria

1. THE Architecture_Document SHALL define the Upgrade_Path as: Free_Trial → Professional_Plan → Business_Plan → Enterprise_Plan
2. THE Architecture_Document SHALL document that the Free_Trial is the primary acquisition mechanism and entry point for new Tenants
3. THE Architecture_Document SHALL specify that upgrade transitions follow the documented proration and entitlement unlock behaviour defined in the existing Billing_Engine specification
4. THE Architecture_Document SHALL specify that downgrade from Enterprise_Plan requires coordination with MerchOS sales, and that self-service downgrade is available between Professional_Plan and Business_Plan

---

### Requirement 9: Document Future Flexibility

**User Story:** As a platform architect, I want the architecture to document that additional plans can be introduced without code changes, so that the billing system remains adaptable to future business needs.

#### Acceptance Criteria

1. THE Architecture_Document SHALL state that the number of Subscription_Plans is not hardcoded and additional plans can be introduced through configuration updates to the DynamoDB Plans table
2. THE Architecture_Document SHALL state that the Billing_Engine remains configuration-driven, reading plan definitions, entitlements, and limits from the Plans table at runtime
3. THE Architecture_Document SHALL state that adding a new Subscription_Plan requires only a configuration entry and does not require application code changes or redeployment
4. THE Architecture_Document SHALL state that the Promotions_Engine is similarly configuration-driven, supporting new promotion types through configuration rather than code changes

---

### Requirement 10: Scope Boundaries

**User Story:** As a project manager, I want the scope boundaries of this documentation update explicitly stated, so that reviewers understand what is and is not being changed.

#### Acceptance Criteria

1. THE Architecture_Document update SHALL be limited to Section 10 (Billing and Subscription Management) and any directly related plan references in adjacent sections
2. THE Architecture_Document update SHALL NOT modify RBAC documentation, API endpoint specifications beyond billing, or authentication and authorisation architecture
3. THE Architecture_Document update SHALL NOT include implementation code, Lambda function source, or infrastructure-as-code templates
4. THE Architecture_Document update SHALL maintain enterprise SaaS documentation standards including consistent formatting, defined terminology from this Glossary, and traceability to the approved business decisions listed in this requirements document
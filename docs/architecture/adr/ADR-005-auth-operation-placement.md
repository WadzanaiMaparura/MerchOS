# ADR-005: Auth Operation Placement — Identity vs. Privileged Operations

## Status

**Accepted**

Date: 2026-10-25

## Context

MerchOS authenticates all users through a single Amazon Cognito User Pool
([ADR-002](./ADR-002-single-cognito-user-pool-rbac.md)) and enforces
authorization through a centralized middleware pipeline behind API Gateway
([ADR-001](./ADR-001-centralized-middleware-authorization.md)). The frontend
(Seller and Admin dashboards, Next.js on AWS Amplify Hosting) interacts with
Cognito through the `aws-amplify` client library.

During a foundation review we found **two parallel, overlapping mechanisms for
the same authentication operations**, which is architectural drift that must be
resolved before more features build on top of it:

1. **The `aws-amplify` client library** — the frontend calls Cognito directly
   from the browser for `signIn`, `confirmSignIn` (MFA challenge), token
   refresh, `setUpTOTP` / `verifyTOTPSetup` (MFA enrollment), `resetPassword` /
   `confirmResetPassword`, and sign-up confirmation. This is the mechanism the
   frontend actually uses today.

2. **A set of `services/auth/handlers/*` Lambdas behind `/auth/*` API Gateway
   routes** — including `login`, `refresh`, `logout`, `forgot-password`,
   `reset-password`, `verify-email`, `change-password`, `mfa-setup`, and
   `session`. An audit (2026-10-25) found **none of these routes are called by
   any frontend code.** Several (`login`, `refresh`, `mfa-setup`) duplicate,
   and in places re-implemented incorrectly, what the `aws-amplify` library
   already does correctly against Cognito.

### Terminology clarification

"Amplify" refers to two unrelated things in this system; this ADR concerns only
the second:

- **AWS Amplify Hosting** — the deployment/hosting platform for the Next.js
  apps. Out of scope here; unchanged by this decision.
- **The `aws-amplify` npm client library** — the browser SDK that talks to
  Cognito. In scope.

### Why the drift is a problem

- Two code paths for the same operation invite inconsistency: a fix or policy
  change applied to one path silently misses the other.
- The duplicate identity Lambdas carry IAM permissions, bundle weight, and a
  maintenance/security surface with **no offsetting value** — they add no
  authorization decision, tenant check, or cross-system logic that Cognito (via
  the library) isn't already doing.
- A new engineer cannot tell which path is authoritative, so the next auth
  feature may be built against the wrong one, deepening the drift.

## Decision

**Auth operations are placed by category. Identity operations run in the
browser via the `aws-amplify` client library, directly against Cognito.
Privileged and business operations run behind API Gateway and the ADR-001
middleware pipeline.**

### Category 1 — Identity operations (browser → Cognito via `aws-amplify`)

Operations where Cognito is the system of record and there is no additional
authorization decision or cross-system write to perform:

- `signIn` / `signOut`
- MFA challenge during login (`confirmSignIn`)
- Token refresh (`fetchAuthSession`)
- MFA enrollment (`setUpTOTP`, `verifyTOTPSetup`, `updateMFAPreference`)
- Password reset (`resetPassword`, `confirmResetPassword`)
- Change password for the signed-in user
- Sign-up / sign-up confirmation
- Reading the current session/claims

Rationale: routing these through our own API adds a network hop and
re-implements the AWS SDK's secure flows while adding nothing. ADR-002 already
establishes that the browser authenticates directly against the single pool
with a single App Client. These operations stay in the shared `@merch-os/auth`
package (the provider plus its helpers), which is the one place `aws-amplify` is
imported.

### Category 2 — Privileged / business operations (browser → API Gateway → Lambda)

Operations that require an authorization decision, admin privileges, or writes
that span Cognito and application data stores:

- Invite user (`AdminCreateUser` + group assignment + tenant records)
- Update role / group membership
- List users, disable user, delete user
- Any operation that assigns a tenant, provisions resources, or writes to
  DynamoDB alongside Cognito

Rationale: these must pass through the ADR-001 pipeline (JWT → role → tenant →
ownership → permission) so authorization is enforced at the single server-side
boundary. A browser can never be trusted to call Cognito Admin APIs directly.
These use the Cognito **Admin** APIs with scoped IAM on the Lambda.

### Placement rule (for future operations)

> If the operation only reads or mutates the caller's own Cognito identity and
> needs no authorization decision beyond "is this a valid session," it is
> Category 1 (library). If it requires an RBAC decision, acts on another user,
> uses a Cognito `Admin*` API, or writes application data alongside Cognito, it
> is Category 2 (API behind the middleware pipeline).

## Consequences

### Benefits

| Benefit | Description |
|---------|-------------|
| **One authoritative path per operation** | Each auth operation has exactly one home. No silent divergence between a library path and an API path. |
| **Smaller security/IAM surface** | Removing duplicate identity Lambdas removes their IAM grants, bundles, and attack surface. |
| **Consistency with ADR-001/002** | Identity-direct-to-Cognito matches ADR-002; privileged-through-middleware matches ADR-001. |
| **Clear guidance for new work** | The placement rule tells the next engineer where a new auth operation belongs, preventing re-drift. |

### Trade-offs

| Trade-off | Description | Mitigation |
|-----------|-------------|------------|
| **Cognito interactions occur in the browser for Category 1** | The browser holds identity flows directly. | This is the documented Cognito SPA model (SRP + PKCE, no client secret). Cognito Advanced Security (ADR-002) covers anomaly/compromise detection. |
| **Two mechanisms still coexist (by design)** | The system still uses both the library and the API — but now by category, not redundantly. | The placement rule makes the split intentional and legible rather than accidental. |
| **Removing live infrastructure is irreversible** | Deleting Lambdas + routes changes deployed infra. | Only Category 1 duplicates are removed, and only after confirming (by audit) they are unreferenced. Category 2 handlers are retained. Changes are staged and reviewed before synth/deploy. |

## Audit (2026-10-25) — handler disposition

Frontend reference check: no `/auth/*` API route is called by any code under
`apps/` or `packages/`.

| Handler | Category | Frontend-referenced? | Disposition |
|---------|----------|----------------------|-------------|
| `login` | 1 (identity) | No (library does it) | **Remove** |
| `refresh` | 1 | No | **Remove** |
| `logout` | 1 | No | **Remove** |
| `forgot-password` | 1 | No | **Remove** |
| `reset-password` | 1 | No | **Remove** |
| `verify-email` | 1 | No | **Remove** |
| `change-password` | 1 | No | **Remove** |
| `mfa-setup` | 1 | No | **Remove** |
| `session` | 1 | No | **Remove** |
| `invite-user` | 2 (privileged) | No (UI pending) | **Keep** — ahead of UI, architecturally required |
| `list-users` | 2 | No (UI pending) | **Keep** |
| `update-role` | 2 | No (UI pending) | **Keep** |
| `disable-user` | 2 | No (UI pending) | **Keep** |
| `delete-user` | 2 | No (UI pending) | **Keep** |

Note: "unreferenced" is not the same as "dead." Category 2 handlers are
unreferenced only because the admin user-management UI is not built yet; they
are the correct server-side home for those privileged operations and are
retained. Category 1 handlers are redundant with the `aws-amplify` library and
are removed.

The removal of the Category 1 handlers, their `/auth/*` routes, their IAM
statements in `auth-api-stack.ts`, and their tests is tracked as the
implementation of this ADR.

## Alternatives Considered

### 1. Route all auth (including identity) through the API

Migrate login/refresh/MFA/reset to the `services/auth` Lambdas and have the
frontend stop using the `aws-amplify` library for them.

**Rejected:** contradicts ADR-002 (browser authenticates directly against the
single pool), adds a hop and bespoke re-implementation of flows the SDK already
provides securely, and increases latency on the hot login path — all without a
corresponding authorization or business-logic benefit.

### 2. Route all auth (including privileged) through the `aws-amplify` library

Have the browser call Cognito Admin APIs directly for invite/role/user
management.

**Rejected:** the browser cannot be trusted with `Admin*` Cognito APIs, and
these operations require the ADR-001 middleware pipeline for RBAC, tenant
isolation, and audit. This would bypass the single authorization boundary.

### 3. Leave both paths in place

**Rejected:** this is the status quo drift. It guarantees ongoing
inconsistency and leaves a security/maintenance surface with no value.

## References

- [ADR-001: Centralized Middleware Authorization](./ADR-001-centralized-middleware-authorization.md)
- [ADR-002: Single Cognito User Pool with RBAC](./ADR-002-single-cognito-user-pool-rbac.md)
- [MerchOS RBAC Blueprint](../rbac-blueprint.md)
- Auth platform documentation: `docs/auth-platform.md`

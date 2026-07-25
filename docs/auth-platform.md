# MerchOS Auth Platform

## Overview

The Auth Platform provides production-grade authentication and authorization for MerchOS. It extends the existing Cognito User Pools, RBAC package, and CDK infrastructure to deliver JWT-based auth, multi-tenant isolation, user management, and secure session lifecycle.

## System Architecture

The platform is layered into four tiers:

1. **Client Layer** — Next.js dashboards (Seller + Admin) using `@merch-os/auth`
2. **API Gateway Layer** — HTTP API with Cognito JWT Authorizer
3. **Lambda Layer** — 14 auth handlers + 4 Cognito triggers + shared middleware
4. **Data Layer** — Cognito User Pools, DynamoDB, EventBridge, SSM Parameter Store

```
Client (Bearer Token) → API Gateway (JWT Authorizer) → Lambda (Middleware Stack) → Cognito / DynamoDB
```

For the full architecture diagram, see `.kiro/specs/auth-platform/design.md` Section 2.

## Key Components

### AWS Cognito

| Pool | Purpose |
|------|---------|
| `merch-os-tenant-pool` | Seller users with custom:tenantId and custom:role attributes |
| `merch-os-admin-pool` | Platform Admin/Support users with mandatory TOTP MFA |

Cognito handles:
- SRP + PKCE authentication flows
- Token issuance (access, ID, refresh)
- Password policy enforcement (12-char minimum with complexity)
- Advanced Security Mode (adaptive authentication)

### API Gateway (HTTP API)

- JWT Authorizer validates tokens via Cognito JWKS endpoint
- Checks `exp`, `iss`, `aud` claims before passing to Lambda
- Decoded claims available in `requestContext.authorizer.jwt.claims`

### Lambda Functions

14 auth operation handlers under `services/auth/handlers/`:

| Handler | Cognito API |
|---------|-------------|
| login | InitiateAuth (USER_SRP_AUTH) |
| refresh | InitiateAuth (REFRESH_TOKEN_AUTH) |
| logout | GlobalSignOut + RevokeToken |
| forgot-password | ForgotPassword |
| reset-password | ConfirmForgotPassword |
| verify-email | ConfirmSignUp |
| invite-user | AdminCreateUser |
| change-password | ChangePassword |
| mfa-setup | AssociateSoftwareToken + VerifySoftwareToken |
| session | Return decoded JWT claims |
| list-users | ListUsersInGroup (tenant-filtered) |
| update-role | AdminRemoveUserFromGroup + AdminAddUserToGroup |
| disable-user | AdminDisableUser |
| delete-user | AdminDeleteUser |

4 Cognito triggers under `services/auth/triggers/`:

| Trigger | Purpose |
|---------|---------|
| pre-sign-up | Validate email, auto-confirm if invited, assign tenantId |
| post-confirmation | Create tenant record in DynamoDB, emit user.registered |
| pre-token-generation | Inject tenantId and role into access token claims |
| custom-message | Branded email templates |

### DynamoDB Tables

| Table | Purpose | Key Schema |
|-------|---------|-----------|
| `merch-os-invitations-{env}` | User invitation tracking | PK: TENANT#{tenantId}, SK: INVITE#{email} |
| `merch-os-sessions-{env}` | Active session tracking | PK: USER#{userId}, SK: SESSION#{sessionId} |
| `merch-os-rate-limits-{env}` | Per-user/IP rate limiting | PK: identifier, SK: WINDOW#{timestamp} |

All tables use KMS encryption and TTL for automatic record cleanup.

## Authentication Flows

### Login Flow

1. Client submits email + password to `POST /auth/login`
2. Lambda calls Cognito `InitiateAuth` with SRP flow
3. If MFA required, returns challenge (TOTP/SMS) + session token
4. Client submits MFA code, Lambda responds with tokens
5. On success: returns accessToken, idToken, refreshToken
6. Session record created in DynamoDB
7. `auth.session.created` event emitted to EventBridge

### MFA Setup Flow

1. Authenticated user calls `POST /auth/mfa/setup`
2. Lambda calls `AssociateSoftwareToken` → returns secret key
3. User scans QR code in authenticator app
4. User submits verification code
5. Lambda calls `VerifySoftwareToken` to confirm
6. MFA enabled for the user account

### Token Refresh Flow

1. Frontend `session-manager` detects token approaching expiry (55-min mark)
2. Calls `POST /auth/refresh` with refreshToken
3. Lambda calls Cognito `InitiateAuth` (REFRESH_TOKEN_AUTH)
4. Returns new accessToken + idToken (refresh token rotated by Cognito)
5. If refresh fails (expired/revoked), user redirected to login

### Logout Flow

1. Client calls `POST /auth/logout` with Bearer token
2. Lambda calls Cognito `GlobalSignOut` (invalidates all tokens)
3. Lambda calls `RevokeToken` on the refresh token
4. Session record marked as revoked in DynamoDB
5. `auth.session.revoked` event emitted
6. Client clears all local session storage

## Multi-Tenant Isolation

### How It Works

1. Each user is assigned an immutable `tenantId` at registration (via PreSignUp trigger)
2. `PreTokenGeneration` trigger injects `tenantId` into the access token as a custom claim
3. `tenant-context` middleware extracts `tenantId` from JWT claims on every request
4. All DynamoDB queries include `tenantId` in the partition key condition
5. Cross-tenant access attempts return HTTP 403 and emit a security event

### Rules

- `tenantId` is immutable — set once at account creation, cannot be changed
- Users can only see/manage other users within their own tenant
- Platform Admin/Support roles (from admin pool) can query across tenants
- All cross-tenant access attempts are logged as security events

## RBAC Hierarchy

### Platform-Level Roles (Admin Pool)

```
Admin > Support
```

- **Admin**: Full platform access, tenant management, system configuration
- **Support**: Read access to tenants, user management assistance

### Tenant-Level Roles (Tenant Pool)

```
owner > admin > editor > viewer
```

- **owner**: Full tenant access, can promote to admin, cannot be deleted
- **admin**: User management, invitations, role changes (cannot promote to owner)
- **editor**: Content and product management
- **viewer**: Read-only access

Role resolution: extracted from `cognito:groups` claim in JWT.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/login | None | Authenticate with email + password |
| POST | /auth/refresh | None | Refresh access token |
| POST | /auth/logout | Bearer | Sign out (global or single session) |
| POST | /auth/forgot-password | None | Request password reset code |
| POST | /auth/reset-password | None | Confirm password reset with code |
| POST | /auth/verify-email | None | Verify email with 6-digit code |
| POST | /auth/invite | Bearer (admin/owner) | Invite user to tenant |
| GET | /auth/session | Bearer | Get current session info |
| POST | /auth/change-password | Bearer | Change password (authenticated) |
| POST | /auth/mfa/setup | Bearer | Set up TOTP MFA |
| GET | /auth/users | Bearer (admin/owner) | List tenant users |
| PUT | /auth/users/:id/role | Bearer (owner) | Update user role |
| DELETE | /auth/users/:id | Bearer (admin/owner) | Delete user account |
| POST | /auth/users/:id/disable | Bearer (admin/owner) | Disable user account |

## Deployment Guide

### Prerequisites

- AWS CDK v2 installed
- Node.js 20.x
- AWS credentials configured for `af-south-1` region
- Existing Foundation Stack and Auth Stack deployed

### CDK Commands

```bash
# Install dependencies
cd infrastructure
npm install

# Synthesize CloudFormation template
npx cdk synth AuthApiStack

# Deploy auth API stack
npx cdk deploy AuthApiStack

# Deploy with auto-approve (CI/CD)
npx cdk deploy AuthApiStack --require-approval never

# Diff changes before deploying
npx cdk diff AuthApiStack

# Destroy stack (caution: removes all resources)
npx cdk destroy AuthApiStack
```

### Deployment Sequence

1. Foundation Stack (already deployed)
2. Auth Stack (already deployed — Cognito pools)
3. **Auth API Stack** (API Gateway + Lambdas + DynamoDB + Triggers)
4. Update frontend environment variables
5. Deploy frontend with new auth flows

### Post-Deployment Verification

```bash
# Check API Gateway endpoint
aws apigatewayv2 get-apis --region af-south-1

# Verify Lambda functions
aws lambda list-functions --region af-south-1 --query "Functions[?starts_with(FunctionName, 'merch-os-auth')]"

# Check DynamoDB tables
aws dynamodb list-tables --region af-south-1
```

## Environment Variables

### Lambda Functions

| Variable | Source | Description |
|----------|--------|-------------|
| `COGNITO_TENANT_POOL_ID` | SSM | Tenant user pool ID |
| `COGNITO_ADMIN_POOL_ID` | SSM | Admin user pool ID |
| `COGNITO_SELLER_CLIENT_ID` | SSM | Seller dashboard app client ID |
| `COGNITO_ISSUER` | Derived | `https://cognito-idp.af-south-1.amazonaws.com/{poolId}` |
| `INVITATIONS_TABLE` | CDK | Invitations DynamoDB table name |
| `SESSIONS_TABLE` | CDK | Sessions DynamoDB table name |
| `RATE_LIMITS_TABLE` | CDK | Rate limits DynamoDB table name |
| `TENANTS_TABLE` | CDK | Tenants DynamoDB table name |
| `EVENT_BUS_NAME` | SSM | EventBridge bus name |
| `ENVIRONMENT` | CDK | `dev` / `staging` / `production` |
| `AWS_REGION` | Runtime | `af-south-1` |

### Frontend (Seller Dashboard)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Tenant pool ID |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Seller dashboard client ID |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | Cognito hosted UI domain |
| `NEXT_PUBLIC_API_URL` | API Gateway base URL |
| `NEXT_PUBLIC_REDIRECT_SIGN_IN` | OAuth callback URL |
| `NEXT_PUBLIC_REDIRECT_SIGN_OUT` | Post-logout redirect URL |

## Monitoring and Observability

### CloudWatch

- **Structured Logging**: All Lambda functions use AWS Powertools for structured JSON logs
- **Metrics**: Custom metrics emitted for login attempts, failures, token refreshes
- **Alarms**: Configure alarms for:
  - Failed login attempts > 50 in 5 minutes
  - Lambda error rate > 5%
  - Token refresh failure rate > 10%
  - Rate limit triggers > 100 per minute

### EventBridge Events

All auth operations emit events to the `merch-os-events` bus:

| Event | Trigger |
|-------|---------|
| `auth.user.registered` | New user sign-up confirmed |
| `auth.user.invited` | User invited to tenant |
| `auth.user.verified` | Email verification completed |
| `auth.user.disabled` | User account disabled |
| `auth.user.deleted` | User account removed |
| `auth.user.role-changed` | Role updated |
| `auth.session.created` | Login successful |
| `auth.session.revoked` | Logout / forced sign-out |
| `auth.password.reset` | Password reset completed |
| `auth.security.rate-limit` | Rate limit exceeded |

### Recommended CloudWatch Dashboards

1. **Auth Overview**: Login success/failure rates, active sessions, token refreshes
2. **Security**: Rate limit triggers, cross-tenant access attempts, MFA failures
3. **Performance**: Lambda duration p50/p95/p99, cold start frequency

### Log Insights Queries

```
# Failed login attempts by IP
fields @timestamp, sourceIp, email
| filter eventType = "auth.login.failed"
| stats count() as attempts by sourceIp
| sort attempts desc

# Cross-tenant access attempts
fields @timestamp, userId, requestedTenantId, actualTenantId
| filter eventType = "auth.security.cross-tenant"
| sort @timestamp desc
```

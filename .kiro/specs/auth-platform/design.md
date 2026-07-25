# Auth Platform — Technical Design

## 1. Overview

Complete production authentication and authorization platform for MerchOS extending the existing Cognito User Pools, RBAC package, and CDK infrastructure. Implements JWT-based auth, multi-tenant isolation, user management, and secure session lifecycle.

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Seller Dashboard (Next.js)          │  Admin Dashboard (Next.js)           │
│  ┌──────────────────────────┐        │  ┌──────────────────────────┐        │
│  │ @merch-os/auth           │        │  │ @merch-os/auth           │        │
│  │ - AuthProvider           │        │  │ - AuthProvider           │        │
│  │ - RouteGuard             │        │  │ - RouteGuard (MFA)       │        │
│  │ - useAuth/useSession     │        │  │ - useAdminAuth           │        │
│  │ - Token refresh (silent) │        │  │ - InactivityTimer        │        │
│  └──────────────────────────┘        │  └──────────────────────────┘        │
└──────────────────────┬───────────────┴──────────────────┬───────────────────┘
                       │ Bearer Token                      │ Bearer Token
┌──────────────────────▼──────────────────────────────────▼───────────────────┐
│                         API GATEWAY (HTTP API)                                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  JWT Authorizer (Cognito)                                            │   │
│  │  - Validates token signature via JWKS                                │   │
│  │  - Checks exp, iss, aud claims                                       │   │
│  │  - Passes decoded claims to Lambda via requestContext                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Routes                                                               │   │
│  │  POST /auth/login          POST /auth/refresh                        │   │
│  │  POST /auth/logout         POST /auth/forgot-password                │   │
│  │  POST /auth/reset-password POST /auth/verify-email                   │   │
│  │  POST /auth/invite         GET  /auth/session                        │   │
│  │  POST /auth/change-password POST /auth/mfa/setup                     │   │
│  │  GET  /auth/users          PUT  /auth/users/:id/role                 │   │
│  │  DELETE /auth/users/:id    POST /auth/users/:id/disable              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────────────────┐
│                         LAMBDA LAYER                                          │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Auth Service (services/auth/)                                         │ │
│  │  - login-handler.ts         → Cognito InitiateAuth (SRP)              │ │
│  │  - refresh-handler.ts       → Cognito InitiateAuth (REFRESH_TOKEN)    │ │
│  │  - logout-handler.ts        → Cognito GlobalSignOut + RevokeToken     │ │
│  │  - forgot-password.ts       → Cognito ForgotPassword                  │ │
│  │  - reset-password.ts        → Cognito ConfirmForgotPassword           │ │
│  │  - verify-email.ts          → Cognito ConfirmSignUp                   │ │
│  │  - invite-user.ts           → Cognito AdminCreateUser + DynamoDB      │ │
│  │  - change-password.ts       → Cognito ChangePassword                  │ │
│  │  - mfa-setup.ts             → Cognito AssociateSoftwareToken          │ │
│  │  - session-handler.ts       → Return decoded token claims             │ │
│  │  - list-users.ts            → Cognito ListUsersInGroup + tenant filter│ │
│  │  - update-role.ts           → Cognito AdminAddUserToGroup             │ │
│  │  - disable-user.ts          → Cognito AdminDisableUser                │ │
│  │  - delete-user.ts           → Cognito AdminDeleteUser                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Cognito Triggers (services/auth/triggers/)                            │ │
│  │  - pre-sign-up.ts           → Auto-assign tenantId, validate domain   │ │
│  │  - post-confirmation.ts     → Provision tenant record in DynamoDB     │ │
│  │  - pre-token-generation.ts  → Inject custom claims (tenantId, role)   │ │
│  │  - custom-message.ts        → Branded email templates                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Shared Middleware (services/shared/middleware/)                        │ │
│  │  - rbac.ts (existing)       → Permission enforcement                  │ │
│  │  - tenant-context.ts (new)  → Extract & validate tenantId isolation   │ │
│  │  - rate-limit.ts (new)      → Per-user/IP throttling via DynamoDB     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────────────────┐
│                         DATA LAYER                                            │
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │  Cognito User Pools              │  │  DynamoDB                        │ │
│  │  - merch-os-tenant-pool          │  │  - merch-os-tenants (existing)   │ │
│  │    • custom:tenantId             │  │  - merch-os-invitations (new)    │ │
│  │    • custom:role                 │  │  - merch-os-sessions (new)       │ │
│  │    • Groups: Seller              │  │  - merch-os-rate-limits (new)    │ │
│  │  - merch-os-admin-pool           │  │                                  │ │
│  │    • custom:role                 │  │  PK: TENANT#{tenantId}           │ │
│  │    • Groups: Admin, Support      │  │  SK: USER#{userId}               │ │
│  │    • MFA: TOTP required          │  │                                  │ │
│  └──────────────────────────────────┘  └─────────────────────────────────┘ │
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │  EventBridge                     │  │  SSM Parameter Store             │ │
│  │  - merch-os-events bus           │  │  - /merch-os/{env}/cognito/*     │ │
│  │  - auth.user.created             │  │  - /merch-os/{env}/auth/*        │ │
│  │  - auth.user.invited             │  │                                  │ │
│  │  - auth.user.disabled            │  │                                  │ │
│  │  - auth.session.revoked          │  │                                  │ │
│  └──────────────────────────────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Components

### 3.1 CDK Infrastructure (infrastructure/lib/auth-api-stack.ts)

New stack extending the existing auth-stack.ts:

| Resource | Purpose |
|----------|---------|
| HTTP API Gateway | Auth endpoints with JWT authorizer |
| JWT Authorizer | Validates Cognito tokens via JWKS |
| Lambda Functions (14) | Auth operations |
| Cognito Lambda Triggers (4) | Pre-signup, post-confirm, pre-token, custom-message |
| DynamoDB Tables (3) | Invitations, sessions, rate-limits |
| IAM Roles | Least-privilege per Lambda |
| EventBridge Rules | Auth event routing |

### 3.2 Auth Service Lambda Functions (services/auth/)

Each Lambda handler:
- Uses middy middleware stack (powertools + rbac + tenant-context)
- Single-responsibility — one Cognito API call per handler
- Input validation via zod schemas
- Structured error responses
- Audit logging via EventBridge

### 3.3 Cognito Triggers (services/auth/triggers/)

| Trigger | Function |
|---------|----------|
| PreSignUp | Validate email domain, auto-confirm if invited, assign tenantId |
| PostConfirmation | Create tenant record in DynamoDB, emit user.created event |
| PreTokenGeneration | Inject tenantId and role into access token claims |
| CustomMessage | Branded email templates for verification, invitation, password reset |

### 3.4 Multi-Tenant Isolation

```
Request Flow:
1. JWT contains custom:tenantId claim (injected by PreTokenGeneration trigger)
2. API Gateway JWT authorizer validates token
3. Lambda receives claims in requestContext.authorizer.jwt.claims
4. tenant-context middleware extracts tenantId
5. All DynamoDB queries scoped: PK = TENANT#{tenantId}
6. Cross-tenant access returns 403
```

### 3.5 Frontend Auth Guards (packages/auth/)

Extending the existing @merch-os/auth package:

| Module | Purpose |
|--------|---------|
| `password-reset.ts` | forgotPassword + confirmResetPassword flows |
| `invitation.ts` | Accept invitation flow (set password, join tenant) |
| `session-manager.ts` | Proactive token refresh, expiry detection |
| `api-client.ts` | Axios/fetch wrapper with auto-refresh interceptor |

### 3.6 Shared Middleware (services/shared/middleware/)

| Module | Purpose |
|--------|---------|
| `tenant-context.ts` | Extract tenantId from JWT claims, validate isolation |
| `rate-limit.ts` | DynamoDB-based per-user/IP rate limiting (sliding window) |
| `input-validation.ts` | Zod schema validation middleware for request body |

## 4. Data Models

### 4.1 Invitations Table (merch-os-invitations-{env})

```typescript
interface Invitation {
  PK: `TENANT#${string}`;        // Partition key
  SK: `INVITE#${string}`;        // Sort key (email)
  invitationId: string;           // UUID
  email: string;
  tenantId: string;
  role: SellerRole;
  invitedBy: string;              // userId of inviter
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: number;              // Unix epoch (7 days)
  token: string;                  // Secure random token for invite link
  createdAt: string;              // ISO 8601
  acceptedAt?: string;
}
```

### 4.2 Sessions Table (merch-os-sessions-{env})

```typescript
interface SessionRecord {
  PK: `USER#${string}`;          // Partition key (userId)
  SK: `SESSION#${string}`;       // Sort key (sessionId)
  sessionId: string;
  userId: string;
  tenantId: string;
  deviceInfo: string;
  ipAddress: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: number;              // TTL for auto-cleanup
  revoked: boolean;
}
```

### 4.3 Rate Limits Table (merch-os-rate-limits-{env})

```typescript
interface RateLimitRecord {
  PK: string;                     // IP or userId
  SK: `WINDOW#${string}`;        // Time window identifier
  count: number;
  windowStart: number;
  expiresAt: number;              // TTL (auto-delete after window)
}
```

## 5. API Contracts

### 5.1 POST /auth/login
```typescript
// Request
{ email: string; password: string }
// Response 200
{ accessToken: string; idToken: string; refreshToken: string; expiresIn: number }
// Response 200 (MFA required)
{ challengeName: 'TOTP' | 'SMS'; session: string }
// Response 401
{ error: { code: 'INVALID_CREDENTIALS'; message: string } }
```

### 5.2 POST /auth/refresh
```typescript
// Request
{ refreshToken: string }
// Response 200
{ accessToken: string; idToken: string; expiresIn: number }
// Response 401
{ error: { code: 'REFRESH_TOKEN_EXPIRED'; message: string } }
```

### 5.3 POST /auth/logout
```typescript
// Request (Authorization: Bearer token)
{ global?: boolean }  // true = revoke all sessions
// Response 200
{ success: true }
```

### 5.4 POST /auth/forgot-password
```typescript
// Request
{ email: string }
// Response 200 (always — no user enumeration)
{ message: 'If an account exists, a reset code has been sent.' }
```

### 5.5 POST /auth/reset-password
```typescript
// Request
{ email: string; code: string; newPassword: string }
// Response 200
{ success: true }
// Response 400
{ error: { code: 'INVALID_CODE' | 'WEAK_PASSWORD'; message: string } }
```

### 5.6 POST /auth/verify-email
```typescript
// Request
{ email: string; code: string }
// Response 200
{ success: true; verified: true }
```

### 5.7 POST /auth/invite
```typescript
// Request (requires admin/owner role within tenant)
{ email: string; role: SellerRole; tenantId: string }
// Response 201
{ invitationId: string; expiresAt: string }
// Response 409
{ error: { code: 'USER_EXISTS'; message: string } }
```

### 5.8 GET /auth/session
```typescript
// Response 200 (Authorization: Bearer token)
{ userId: string; email: string; tenantId: string; role: string; expiresAt: number }
```

### 5.9 GET /auth/users
```typescript
// Query params: ?tenantId=xxx&limit=50&nextToken=xxx
// Response 200
{ users: AuthUser[]; nextToken?: string }
```

### 5.10 PUT /auth/users/:id/role
```typescript
// Request (requires owner role)
{ role: SellerRole }
// Response 200
{ userId: string; role: SellerRole; updatedAt: string }
```

### 5.11 DELETE /auth/users/:id
```typescript
// Response 200
{ success: true; userId: string }
// Response 403
{ error: { code: 'CANNOT_DELETE_OWNER'; message: string } }
```

### 5.12 POST /auth/users/:id/disable
```typescript
// Response 200
{ success: true; userId: string; disabled: true }
```

## 6. Security Design

### 6.1 Token Strategy
- Access Token: 60 min TTL, JWT, includes tenantId + role claims
- ID Token: 60 min TTL, used for frontend user info
- Refresh Token: 30 days TTL, rotated on each use, revocable
- Silent refresh: Frontend proactively refreshes at 55 min mark

### 6.2 Password Policy
- Minimum 12 characters
- Uppercase, lowercase, digits, symbols required
- Cognito advanced security (adaptive authentication) enforced

### 6.3 Rate Limiting
- Login: 5 attempts per IP per 15 min window
- Forgot password: 3 requests per email per hour
- API: 100 requests per user per minute (sliding window)

### 6.4 IAM Least Privilege
Each Lambda gets a dedicated IAM role with only the permissions it needs:
- login-handler: `cognito-idp:InitiateAuth`
- invite-user: `cognito-idp:AdminCreateUser`, `dynamodb:PutItem` (invitations table)
- list-users: `cognito-idp:ListUsersInGroup` (read-only)
- No Lambda has `cognito-idp:*` or `dynamodb:*`

### 6.5 Organization Isolation
- All data access scoped by tenantId in partition key
- tenantId is immutable (set at account creation, cannot be changed)
- Cross-tenant access attempts return 403 and emit security event
- Admin pool users can query across tenants (platform-level access)

## 7. Event-Driven Integration

All auth operations emit events to the existing EventBridge bus:

```typescript
// Event source: 'merch-os.auth'
// Detail types:
'auth.user.registered'     // New user signed up
'auth.user.invited'        // User invited to tenant
'auth.user.verified'       // Email verified
'auth.user.disabled'       // User account disabled
'auth.user.deleted'        // User account removed
'auth.user.role-changed'   // Role updated
'auth.session.created'     // Login successful
'auth.session.revoked'     // Logout / forced sign-out
'auth.password.reset'      // Password reset completed
'auth.security.rate-limit' // Rate limit exceeded
```

## 8. Environment Variables

### Lambda Functions
```
COGNITO_TENANT_POOL_ID       - from SSM /merch-os/{env}/cognito/tenant-pool-id
COGNITO_ADMIN_POOL_ID        - from SSM /merch-os/{env}/cognito/admin-pool-id
COGNITO_SELLER_CLIENT_ID     - from SSM /merch-os/{env}/cognito/seller-client-id
COGNITO_ISSUER               - https://cognito-idp.{region}.amazonaws.com/{poolId}
INVITATIONS_TABLE            - merch-os-invitations-{env}
SESSIONS_TABLE               - merch-os-sessions-{env}
RATE_LIMITS_TABLE            - merch-os-rate-limits-{env}
EVENT_BUS_NAME               - from SSM /merch-os/{env}/eventbridge/bus-name
ENVIRONMENT                  - dev | staging | production
```

### Frontend (.env.local)
```
NEXT_PUBLIC_COGNITO_USER_POOL_ID   - Tenant pool ID
NEXT_PUBLIC_COGNITO_CLIENT_ID      - Seller dashboard client ID
NEXT_PUBLIC_COGNITO_DOMAIN         - Cognito hosted UI domain
NEXT_PUBLIC_API_URL                - API Gateway base URL
NEXT_PUBLIC_REDIRECT_SIGN_IN       - OAuth callback URL
NEXT_PUBLIC_REDIRECT_SIGN_OUT      - Post-logout redirect URL
```

## 9. Testing Strategy

| Layer | Framework | Coverage |
|-------|-----------|----------|
| Lambda handlers | Vitest + aws-sdk-client-mock | Unit tests for each handler |
| RBAC middleware | Vitest (existing) | Permission matrix validation |
| CDK stacks | CDK assertions | Resource existence + IAM policies |
| Frontend hooks | Vitest + React Testing Library | Auth flows, token refresh |
| Integration | Vitest + localstack (optional) | End-to-end auth flows |

## 10. File Structure (New/Modified)

```
infrastructure/
  lib/
    auth-stack.ts              (existing — no changes)
    auth-api-stack.ts          (NEW — API GW + Lambdas + DynamoDB)
  bin/
    merch-os.ts                (MODIFY — add AuthApiStack)

services/
  auth/                        (NEW directory)
    handlers/
      login.ts
      refresh.ts
      logout.ts
      forgot-password.ts
      reset-password.ts
      verify-email.ts
      invite-user.ts
      change-password.ts
      mfa-setup.ts
      session.ts
      list-users.ts
      update-role.ts
      disable-user.ts
      delete-user.ts
    triggers/
      pre-sign-up.ts
      post-confirmation.ts
      pre-token-generation.ts
      custom-message.ts
    schemas/
      index.ts                 (zod validation schemas)
    utils/
      cognito-client.ts
      event-emitter.ts
    package.json
    tsconfig.json
    vitest.config.ts
    __tests__/
      unit/
      integration/

services/shared/
  middleware/
    tenant-context.ts          (NEW)
    rate-limit.ts              (NEW)
    input-validation.ts        (NEW)

packages/auth/
  src/
    password-reset.ts          (NEW)
    invitation.ts              (NEW)
    session-manager.ts         (NEW)
    api-client.ts              (NEW)
    index.ts                   (MODIFY — add new exports)
```

## 11. Deployment Sequence

1. Deploy Foundation Stack (already deployed)
2. Deploy Auth Stack (already deployed — Cognito pools)
3. Deploy Auth API Stack (new — API GW + Lambdas + DynamoDB + Triggers)
4. Update frontend environment variables
5. Deploy frontend with new auth flows

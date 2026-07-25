# Auth Platform — Requirements

## Functional Requirements

### FR-1: JWT Authentication
- FR-1.1: System SHALL authenticate users via Cognito SRP + PKCE flow
- FR-1.2: System SHALL issue access tokens (60 min TTL), ID tokens (60 min TTL), and refresh tokens (30 day TTL)
- FR-1.3: System SHALL validate JWTs at API Gateway using Cognito JWKS endpoint
- FR-1.4: System SHALL reject expired, malformed, or tampered tokens with HTTP 401

### FR-2: API Gateway JWT Authorizer
- FR-2.1: HTTP API Gateway SHALL use a Cognito JWT authorizer for all protected routes
- FR-2.2: Authorizer SHALL validate issuer (iss), audience (aud), and expiration (exp) claims
- FR-2.3: Authorizer SHALL pass decoded claims to Lambda handlers via requestContext

### FR-3: Multi-Tenant Architecture
- FR-3.1: Each user SHALL be assigned an immutable tenantId at registration
- FR-3.2: All data access SHALL be scoped by tenantId partition key
- FR-3.3: PreTokenGeneration trigger SHALL inject tenantId into access token claims
- FR-3.4: Cross-tenant data access SHALL be blocked and logged as a security event

### FR-4: RBAC Implementation
- FR-4.1: System SHALL enforce role-based permissions using the existing @merch-os/rbac package
- FR-4.2: Roles SHALL be resolved from cognito:groups claim (Admin > Support > Seller)
- FR-4.3: Seller-level roles (owner > admin > editor > viewer) SHALL use the existing hierarchy
- FR-4.4: Permission checks SHALL occur in Lambda middleware before handler execution

### FR-5: Organization Isolation
- FR-5.1: tenant-context middleware SHALL extract and validate tenantId from JWT
- FR-5.2: DynamoDB queries SHALL include tenantId in the partition key condition
- FR-5.3: Users SHALL only see/manage other users within their own tenant
- FR-5.4: Platform Admin/Support roles SHALL be able to query across tenants

### FR-6: User Invitations
- FR-6.1: Tenant owners/admins SHALL be able to invite users by email
- FR-6.2: Invitations SHALL expire after 7 days
- FR-6.3: Invited users SHALL be auto-confirmed in Cognito (skip email verification)
- FR-6.4: System SHALL prevent inviting an already-existing user (HTTP 409)
- FR-6.5: Invitations SHALL be stored in DynamoDB with status tracking

### FR-7: Password Reset
- FR-7.1: System SHALL support forgot-password flow via Cognito ForgotPassword API
- FR-7.2: Reset code SHALL be delivered via email
- FR-7.3: Response SHALL NOT reveal whether the email exists (prevent enumeration)
- FR-7.4: New password SHALL meet the 12-char policy with complexity requirements

### FR-8: Email Verification
- FR-8.1: New registrations SHALL require email verification via 6-digit code
- FR-8.2: CustomMessage trigger SHALL send branded verification emails
- FR-8.3: Verification codes SHALL expire after 24 hours

### FR-9: Admin Management
- FR-9.1: Admin users SHALL be able to list all users in their tenant
- FR-9.2: Admin users SHALL be able to change a user's role within the tenant
- FR-9.3: Admin users SHALL be able to disable/enable user accounts
- FR-9.4: Admin users SHALL be able to delete user accounts (owner cannot be deleted)
- FR-9.5: Only the owner role SHALL be able to promote another user to admin

### FR-10: Session Management
- FR-10.1: System SHALL track active sessions in DynamoDB (device, IP, timestamps)
- FR-10.2: Session records SHALL have a TTL matching refresh token expiry
- FR-10.3: Global logout SHALL revoke all sessions for the user

### FR-11: Refresh Token Handling
- FR-11.1: Frontend SHALL proactively refresh tokens at the 55-minute mark
- FR-11.2: Refresh SHALL use Cognito REFRESH_TOKEN auth flow
- FR-11.3: If refresh fails (expired/revoked), user SHALL be redirected to login
- FR-11.4: Refresh timeout SHALL be 3 seconds max (existing implementation)

### FR-12: Secure Logout
- FR-12.1: Logout SHALL call Cognito GlobalSignOut to invalidate all tokens
- FR-12.2: Logout SHALL revoke the refresh token specifically
- FR-12.3: Logout SHALL clear all client-side session storage
- FR-12.4: Logout SHALL emit auth.session.revoked event

### FR-13: Protected Routes
- FR-13.1: RouteGuard component SHALL redirect unauthenticated users to login
- FR-13.2: RouteGuard SHALL check role hierarchy for role-gated pages
- FR-13.3: Access-denied SHALL display a notification (auto-dismiss 5s) and redirect

### FR-14: Frontend Authentication Guards
- FR-14.1: API client SHALL attach Bearer token to all API requests automatically
- FR-14.2: API client SHALL intercept 401 responses and attempt token refresh
- FR-14.3: API client SHALL redirect to login if refresh fails
- FR-14.4: Session manager SHALL detect token expiry proactively

### FR-15: API Authorization Middleware
- FR-15.1: All Lambda handlers SHALL use the middy middleware stack
- FR-15.2: tenant-context middleware SHALL validate tenantId matches request scope
- FR-15.3: rate-limit middleware SHALL enforce per-user and per-IP limits
- FR-15.4: input-validation middleware SHALL validate request bodies against zod schemas

### FR-16: IAM Least Privilege
- FR-16.1: Each Lambda SHALL have a dedicated IAM role
- FR-16.2: IAM policies SHALL grant only the specific Cognito API actions needed
- FR-16.3: DynamoDB access SHALL be scoped to specific table ARNs
- FR-16.4: No Lambda SHALL have wildcard (*) permissions on any service

## Non-Functional Requirements

### NFR-1: Performance
- Token validation at API Gateway: < 10ms (cached JWKS)
- Lambda cold start: < 500ms (Node.js 20.x, minimal dependencies)
- Token refresh: < 3 seconds end-to-end

### NFR-2: Security
- All tokens transmitted over HTTPS only
- Cognito Advanced Security Mode: ENFORCED
- Password minimum: 12 characters with complexity
- Admin pool: TOTP MFA required
- Rate limiting on auth endpoints

### NFR-3: Availability
- Cognito SLA: 99.9% availability
- Lambda + API Gateway: Multi-AZ by default
- DynamoDB: On-demand capacity (scales to zero, handles spikes)

### NFR-4: Observability
- All auth operations logged via AWS Powertools (structured JSON)
- Security events emitted to EventBridge
- CloudWatch alarms on failed login attempts > threshold

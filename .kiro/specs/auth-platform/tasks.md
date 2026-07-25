# Auth Platform — Tasks

## Task 1: Create Auth Service Scaffolding
Create the services/auth directory with package.json, tsconfig.json, vitest.config.ts, and folder structure (handlers/, triggers/, schemas/, utils/, __tests__/).
- [x] Create services/auth/package.json with dependencies (aws-sdk v3 cognito-identity-provider, middy, zod, @merch-os/types)
- [x] Create services/auth/tsconfig.json extending base config
- [x] Create services/auth/vitest.config.ts
- [x] Create directory structure: handlers/, triggers/, schemas/, utils/, __tests__/unit/, __tests__/integration/

## Task 2: Implement Auth Utility Modules
Create shared utility modules for the auth service: Cognito client factory, EventBridge event emitter, and Zod validation schemas.
- [x] Create services/auth/utils/cognito-client.ts — CognitoIdentityProviderClient factory with region config
- [x] Create services/auth/utils/event-emitter.ts — EventBridge PutEvents helper for auth domain events
- [x] Create services/auth/schemas/index.ts — Zod schemas for all auth request/response payloads

## Task 3: Implement Shared Middleware Extensions
Add tenant-context, rate-limit, and input-validation middleware to services/shared/middleware/.
- [x] Create services/shared/middleware/tenant-context.ts — Extract tenantId from JWT claims, validate isolation, attach to request
- [x] Create services/shared/middleware/rate-limit.ts — DynamoDB sliding window rate limiter (per-user and per-IP)
- [x] Create services/shared/middleware/input-validation.ts — Zod schema validation middy middleware
- [x] Update services/shared/middleware/index.ts — Export new middleware modules
- [x] Add unit tests for tenant-context middleware
- [x] Add unit tests for rate-limit middleware
- [x] Add unit tests for input-validation middleware

## Task 4: Implement Login and Session Handlers
Create the login, session, and MFA setup Lambda handlers.
- [x] Create services/auth/handlers/login.ts — Cognito InitiateAuth (USER_SRP_AUTH), handle MFA challenge response
- [x] Create services/auth/handlers/session.ts — Return decoded JWT claims for authenticated user
- [x] Create services/auth/handlers/mfa-setup.ts — AssociateSoftwareToken + VerifySoftwareToken flow
- [x] Add unit tests for login handler
- [x] Add unit tests for session handler

## Task 5: Implement Token Refresh and Logout Handlers
Create refresh token and logout Lambda handlers.
- [x] Create services/auth/handlers/refresh.ts — Cognito InitiateAuth (REFRESH_TOKEN_AUTH)
- [x] Create services/auth/handlers/logout.ts — GlobalSignOut + RevokeToken + emit event
- [x] Create services/auth/handlers/change-password.ts — Cognito ChangePassword
- [x] Add unit tests for refresh handler
- [x] Add unit tests for logout handler

## Task 6: Implement Password Reset Handlers
Create forgot-password and reset-password Lambda handlers.
- [x] Create services/auth/handlers/forgot-password.ts — Cognito ForgotPassword (no user enumeration)
- [x] Create services/auth/handlers/reset-password.ts — Cognito ConfirmForgotPassword
- [x] Create services/auth/handlers/verify-email.ts — Cognito ConfirmSignUp
- [x] Add unit tests for forgot-password handler
- [x] Add unit tests for reset-password handler

## Task 7: Implement User Management Handlers
Create handlers for listing, updating roles, disabling, and deleting users.
- [x] Create services/auth/handlers/invite-user.ts — AdminCreateUser + DynamoDB invitation record + emit event
- [x] Create services/auth/handlers/list-users.ts — ListUsersInGroup filtered by tenantId
- [x] Create services/auth/handlers/update-role.ts — AdminRemoveUserFromGroup + AdminAddUserToGroup
- [x] Create services/auth/handlers/disable-user.ts — AdminDisableUser + emit event
- [x] Create services/auth/handlers/delete-user.ts — AdminDeleteUser (prevent owner deletion) + emit event
- [ ] Add unit tests for invite-user handler
- [ ] Add unit tests for list-users handler
- [ ] Add unit tests for update-role handler

## Task 8: Implement Cognito Lambda Triggers
Create the four Cognito Lambda triggers for tenant provisioning and custom claims.
- [ ] Create services/auth/triggers/pre-sign-up.ts — Validate email, auto-confirm if invited, assign tenantId
- [ ] Create services/auth/triggers/post-confirmation.ts — Create tenant DynamoDB record, emit user.registered event
- [ ] Create services/auth/triggers/pre-token-generation.ts — Inject tenantId and role into access token claims
- [ ] Create services/auth/triggers/custom-message.ts — Branded email templates (verification, invitation, reset)
- [ ] Add unit tests for pre-sign-up trigger
- [ ] Add unit tests for pre-token-generation trigger

## Task 9: Create Auth API CDK Stack
Create infrastructure/lib/auth-api-stack.ts with API Gateway, JWT Authorizer, Lambda functions, DynamoDB tables, and IAM roles.
- [ ] Create auth-api-stack.ts with HTTP API Gateway and Cognito JWT Authorizer
- [ ] Define all 14 Lambda functions with dedicated IAM roles (least privilege)
- [ ] Define route integrations (POST /auth/login, POST /auth/refresh, etc.)
- [ ] Define DynamoDB tables (invitations, sessions, rate-limits) with KMS encryption
- [ ] Wire Cognito Lambda triggers to the existing tenant pool
- [ ] Add SSM parameters for new resource ARNs
- [ ] Update infrastructure/bin/merch-os.ts to instantiate AuthApiStack
- [ ] Add CDK assertion tests for auth-api-stack

## Task 10: Extend Frontend Auth Package
Add password-reset, invitation, session-manager, and API client modules to @merch-os/auth.
- [ ] Create packages/auth/src/password-reset.ts — forgotPassword + confirmResetPassword using Amplify Auth
- [ ] Create packages/auth/src/invitation.ts — Accept invitation flow (set password, join tenant)
- [ ] Create packages/auth/src/session-manager.ts — Proactive token refresh at 55-min mark, expiry detection
- [ ] Create packages/auth/src/api-client.ts — Fetch wrapper with auth header injection and 401 retry
- [ ] Update packages/auth/src/index.ts — Export new modules
- [ ] Add unit tests for session-manager
- [ ] Add unit tests for api-client

## Task 11: Documentation and Environment Setup
Create documentation and environment variable templates.
- [ ] Create docs/auth-platform.md — Architecture overview, deployment guide, API reference
- [ ] Create services/auth/.env.example — Template with all required environment variables
- [ ] Update apps/seller-dashboard/.env.example — Add auth-related env vars
- [ ] Create docs/auth-runbook.md — Operational runbook (troubleshooting, rotation, incident response)

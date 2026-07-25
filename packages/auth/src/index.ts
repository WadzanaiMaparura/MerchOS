/**
 * @merch-os/auth — Cognito auth wrapper for MerchOS applications.
 *
 * Exports:
 * - AuthProvider: React context provider for auth state
 * - useAuth, useRole, useSession: Hooks for consuming auth context
 * - configureCognitoAuth: Amplify Auth configuration helper
 * - AuthContext: Raw context (for advanced use cases)
 * - RouteGuard: Route-level auth and role-based access control component
 * - requestPasswordReset, confirmPasswordReset: Password reset flows
 * - acceptInvitation: Invitation acceptance flow
 * - SessionManager: Proactive token refresh and expiry detection
 * - createAuthenticatedFetch: Fetch wrapper with auth header injection
 */

export { AuthProvider, AuthContext } from './provider';
export { useAuth, useRole, useSession } from './hooks';
export { configureCognitoAuth, defaultCognitoConfig, cognitoSignUp, cognitoConfirmSignUp } from './cognito';
export type { CognitoConfig, SignUpParams } from './cognito';
export { RouteGuard } from './route-guard';
export type { RouteGuardProps } from './route-guard';
export { requestPasswordReset, confirmPasswordReset } from './password-reset';
export { acceptInvitation } from './invitation';
export { SessionManager } from './session-manager';
export { createAuthenticatedFetch } from './api-client';

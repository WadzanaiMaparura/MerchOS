/**
 * @merch-os/auth — Cognito auth wrapper for MerchOS applications.
 *
 * Exports:
 * - AuthProvider: React context provider for auth state
 * - useAuth, useRole, useSession: Hooks for consuming auth context
 * - configureCognitoAuth: Amplify Auth configuration helper
 * - AuthContext: Raw context (for advanced use cases)
 * - RouteGuard: Route-level auth and role-based access control component
 */

export { AuthProvider, AuthContext } from './provider';
export { useAuth, useRole, useSession } from './hooks';
export { configureCognitoAuth, defaultCognitoConfig, cognitoSignUp, cognitoConfirmSignUp } from './cognito';
export type { CognitoConfig, SignUpParams } from './cognito';
export { RouteGuard } from './route-guard';
export type { RouteGuardProps } from './route-guard';

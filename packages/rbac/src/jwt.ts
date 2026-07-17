import type { PlatformRole } from './types';

/** Role priority for resolving multiple group memberships */
const ROLE_PRIORITY: Record<PlatformRole, number> = {
  Admin: 3,
  Support: 2,
  Seller: 1,
};

const VALID_ROLES: Set<string> = new Set(['Admin', 'Support', 'Seller']);

export interface JwtClaims {
  sub: string;
  iss: string;
  exp: number;
  'cognito:groups'?: string[];
  'custom:tenantId'?: string;
  [key: string]: unknown;
}

export type RoleResolutionResult =
  | {
      success: true;
      role: PlatformRole;
      userId: string;
      tenantId?: string;
    }
  | {
      success: false;
      errorCode: string;
      message: string;
      httpStatus: 401 | 403;
    };

/**
 * Resolve Platform_Role from JWT claims.
 * Uses highest-privilege group when multiple memberships exist.
 */
export function resolveRoleFromClaims(claims: JwtClaims, expectedIssuer: string): RoleResolutionResult {
  // Verify issuer
  if (claims.iss !== expectedIssuer) {
    return { success: false, errorCode: 'INVALID_ISSUER', message: 'Token issuer mismatch', httpStatus: 401 };
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return { success: false, errorCode: 'TOKEN_EXPIRED', message: 'Token has expired', httpStatus: 401 };
  }

  // Extract groups
  const groups = claims['cognito:groups'];
  if (!groups || !Array.isArray(groups) || groups.length === 0) {
    return { success: false, errorCode: 'MISSING_GROUP', message: 'No cognito:groups claim present', httpStatus: 403 };
  }

  // Filter to recognized roles and resolve highest priority
  const recognizedRoles = groups.filter(g => VALID_ROLES.has(g)) as PlatformRole[];
  if (recognizedRoles.length === 0) {
    return { success: false, errorCode: 'UNRECOGNIZED_ROLE', message: 'No recognized platform role in groups', httpStatus: 403 };
  }

  const resolvedRole = recognizedRoles.reduce((highest, current) =>
    ROLE_PRIORITY[current] > ROLE_PRIORITY[highest] ? current : highest
  );

  return {
    success: true,
    role: resolvedRole,
    userId: claims.sub,
    tenantId: claims['custom:tenantId'],
  };
}

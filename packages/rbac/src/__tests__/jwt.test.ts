import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveRoleFromClaims } from '../jwt';
import type { JwtClaims } from '../jwt';

const EXPECTED_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool';

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-123',
    iss: EXPECTED_ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    'cognito:groups': ['Seller'],
    'custom:tenantId': 'tenant-abc',
    ...overrides,
  };
}

describe('resolveRoleFromClaims', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('valid single group resolves correctly', () => {
    it('resolves Admin group to Admin role', () => {
      const result = resolveRoleFromClaims(makeClaims({ 'cognito:groups': ['Admin'] }), EXPECTED_ISSUER);
      expect(result).toEqual({
        success: true,
        role: 'Admin',
        userId: 'user-123',
        tenantId: 'tenant-abc',
      });
    });

    it('resolves Support group to Support role', () => {
      const result = resolveRoleFromClaims(makeClaims({ 'cognito:groups': ['Support'] }), EXPECTED_ISSUER);
      expect(result).toEqual({
        success: true,
        role: 'Support',
        userId: 'user-123',
        tenantId: 'tenant-abc',
      });
    });

    it('resolves Seller group to Seller role', () => {
      const result = resolveRoleFromClaims(makeClaims({ 'cognito:groups': ['Seller'] }), EXPECTED_ISSUER);
      expect(result).toEqual({
        success: true,
        role: 'Seller',
        userId: 'user-123',
        tenantId: 'tenant-abc',
      });
    });
  });

  describe('multiple groups resolves to highest priority', () => {
    it('resolves [Seller, Admin] to Admin (highest priority)', () => {
      const result = resolveRoleFromClaims(makeClaims({ 'cognito:groups': ['Seller', 'Admin'] }), EXPECTED_ISSUER);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.role).toBe('Admin');
      }
    });

    it('resolves [Seller, Support] to Support', () => {
      const result = resolveRoleFromClaims(makeClaims({ 'cognito:groups': ['Seller', 'Support'] }), EXPECTED_ISSUER);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.role).toBe('Support');
      }
    });

    it('resolves [Support, Admin, Seller] to Admin', () => {
      const result = resolveRoleFromClaims(makeClaims({ 'cognito:groups': ['Support', 'Admin', 'Seller'] }), EXPECTED_ISSUER);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.role).toBe('Admin');
      }
    });
  });

  describe('expired token returns 401 with TOKEN_EXPIRED', () => {
    it('returns TOKEN_EXPIRED when exp is in the past', () => {
      const expiredClaims = makeClaims({ exp: Math.floor(Date.now() / 1000) - 60 });
      const result = resolveRoleFromClaims(expiredClaims, EXPECTED_ISSUER);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('TOKEN_EXPIRED');
        expect(result.httpStatus).toBe(401);
        expect(result.message).toBeDefined();
      }
    });

    it('returns TOKEN_EXPIRED when exp equals current time', () => {
      const now = Math.floor(Date.now() / 1000);
      vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
      const expiredClaims = makeClaims({ exp: now });
      const result = resolveRoleFromClaims(expiredClaims, EXPECTED_ISSUER);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('TOKEN_EXPIRED');
        expect(result.httpStatus).toBe(401);
      }
    });
  });

  describe('missing cognito:groups returns 403 with MISSING_GROUP', () => {
    it('returns MISSING_GROUP when cognito:groups is undefined', () => {
      const claims = makeClaims({ 'cognito:groups': undefined });
      const result = resolveRoleFromClaims(claims, EXPECTED_ISSUER);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('MISSING_GROUP');
        expect(result.httpStatus).toBe(403);
        expect(result.message).toBeDefined();
      }
    });

    it('returns MISSING_GROUP when cognito:groups is an empty array', () => {
      const claims = makeClaims({ 'cognito:groups': [] });
      const result = resolveRoleFromClaims(claims, EXPECTED_ISSUER);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('MISSING_GROUP');
        expect(result.httpStatus).toBe(403);
      }
    });
  });

  describe('issuer mismatch returns 401 with INVALID_ISSUER', () => {
    it('returns INVALID_ISSUER when iss does not match expected issuer', () => {
      const claims = makeClaims({ iss: 'https://wrong-issuer.example.com' });
      const result = resolveRoleFromClaims(claims, EXPECTED_ISSUER);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('INVALID_ISSUER');
        expect(result.httpStatus).toBe(401);
        expect(result.message).toBeDefined();
      }
    });
  });

  describe('unrecognized group names return 403 with UNRECOGNIZED_ROLE', () => {
    it('returns UNRECOGNIZED_ROLE when groups contain no recognized roles', () => {
      const claims = makeClaims({ 'cognito:groups': ['UnknownGroup', 'AnotherGroup'] });
      const result = resolveRoleFromClaims(claims, EXPECTED_ISSUER);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('UNRECOGNIZED_ROLE');
        expect(result.httpStatus).toBe(403);
        expect(result.message).toBeDefined();
      }
    });

    it('ignores unrecognized groups when at least one recognized group exists', () => {
      const claims = makeClaims({ 'cognito:groups': ['RandomGroup', 'Seller'] });
      const result = resolveRoleFromClaims(claims, EXPECTED_ISSUER);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.role).toBe('Seller');
      }
    });
  });
});

/**
 * Where each environment's websites live, and the single CORS allow-list for
 * every seller-facing and admin HTTP API. A new frontend origin is added here,
 * in exactly one place.
 *
 * Explicit origins only, never '*': the APIs use allowCredentials:true, which
 * forbids a wildcard, and a wildcard would let any site call them with a seller's
 * session.
 *
 *   production   merchos.co.za / admin.merchos.co.za (the live business)
 *   dev          dev.merchos.co.za / admin.dev.merchos.co.za, plus the raw
 *                Amplify branch origins and localhost (and, until the website
 *                cutover, the live addresses it still serves).
 */

export interface SiteAddresses {
  /** The seller site (links in emails, PayFast return, sign-in callbacks). */
  seller: string;
  /** The admin dashboard. */
  admin: string;
  /** Other origins the seller site is also served from. */
  extraSeller: string[];
  /** Other origins the admin dashboard is also served from. */
  extraAdmin: string[];
}

/**
 * TEMPORARY: production's Amplify branch addresses, so the new production sites
 * can be tested before merchos.co.za moves to the production account. Remove
 * both (set to []) in Phase 5, when the domain switches. The production test
 * fails if they are still here once envConfig.production.hostedZoneId is set.
 */
export const PRODUCTION_PRE_DOMAIN_ORIGINS: { seller: string[]; admin: string[] } = {
  seller: [],
  admin: [],
};

/**
 * TEMPORARY: the live addresses dev still serves until the website cutover
 * (Phase 5 step D). Set both to [] right after it.
 */
export const DEV_UNTIL_CUTOVER: { seller: string[]; admin: string[] } = {
  seller: [],
  admin: [],
};

export const SITES: Record<string, SiteAddresses> = {
  production: {
    seller: 'https://merchos.co.za',
    admin: 'https://admin.merchos.co.za',
    extraSeller: [...PRODUCTION_PRE_DOMAIN_ORIGINS.seller],
    extraAdmin: [...PRODUCTION_PRE_DOMAIN_ORIGINS.admin],
  },
  dev: {
    seller: 'https://dev.merchos.co.za',
    admin: 'https://admin.dev.merchos.co.za',
    extraSeller: [
      // TEMPORARY: dev still serves the live addresses until the website
      // cutover (Phase 5 step D). Remove both (here and below) right after it.
      ...DEV_UNTIL_CUTOVER.seller,
      // Earlier dev address (kept so nothing that still uses it breaks).
      'https://dev.merchos.io',
      // Raw Amplify branch origin (direct access / pre-custom-domain fallback).
      'https://main.d1jwaah0zt7pg5.amplifyapp.com',
      // Local development.
      'http://localhost:3000',
    ],
    extraAdmin: [
      ...DEV_UNTIL_CUTOVER.admin,
      'https://admin-dev.merchos.io',
      'https://main.d3katl1796jtte.amplifyapp.com',
      // Local development (admin runs on :3001).
      'http://localhost:3001',
    ],
  },
};

/** Any other environment (e.g. staging) lives under its own merchos.co.za subdomain. */
export function siteAddresses(env: string): SiteAddresses {
  return (
    SITES[env] ?? {
      seller: `https://${env}.merchos.co.za`,
      admin: `https://admin.${env}.merchos.co.za`,
      extraSeller: [],
      extraAdmin: [],
    }
  );
}

/** Seller site origins (every seller-facing API, the upload bucket, chat visitors). */
export function sellerDashboardOrigins(env: string): string[] {
  const s = siteAddresses(env);
  return [...new Set([s.seller, ...s.extraSeller])];
}

/**
 * Admin dashboard origins (operators and the Support inbox). Kept separate from
 * the seller list so seller-facing APIs never accept the admin origin and the
 * chat can tell visitor sockets from agent sockets by origin.
 */
export function adminDashboardOrigins(env: string): string[] {
  const s = siteAddresses(env);
  return [...new Set([s.admin, ...s.extraAdmin])];
}

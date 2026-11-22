/**
 * The single CORS allow-list for every seller-facing HTTP API.
 *
 * Previously each stack hard-coded its own list, and only the Auth API knew the
 * live frontend origin (https://merchos.co.za). Every other API therefore rejected
 * browser calls from the live site. All APIs now read this one function, so a new
 * frontend origin is added in exactly one place.
 *
 * Explicit origins only, never '*': the APIs use allowCredentials:true, which
 * forbids a wildcard, and a wildcard would let any site call them with a seller's
 * session.
 *
 * The dev environment is what https://merchos.co.za currently runs against
 * (CloudFront in front of the Amplify `main` branch), so its list includes the live
 * origin, the raw Amplify branch origin and localhost. Production gets only its own
 * custom domain.
 */
export function sellerDashboardOrigins(env: string): string[] {
  const customDomainOrigin = `https://${env === 'production' ? 'app' : env}.merchos.io`;
  if (env !== 'dev') return [customDomainOrigin];
  return [
    customDomainOrigin,
    // Live seller frontend (custom domain served via CloudFront).
    'https://merchos.co.za',
    // Raw Amplify branch origin (direct access / pre-custom-domain fallback).
    'https://main.d1jwaah0zt7pg5.amplifyapp.com',
    // Local development.
    'http://localhost:3000',
  ];
}

/**
 * Admin dashboard origins (operators and the Support inbox). Kept separate from
 * the seller list so seller-facing APIs never accept the admin origin and the
 * chat can tell visitor sockets from agent sockets by origin.
 */
export function adminDashboardOrigins(env: string): string[] {
  const customDomainOrigin = `https://admin-${env}.merchos.io`;
  if (env !== 'dev') return [customDomainOrigin];
  return [
    customDomainOrigin,
    // Live admin frontend (Amplify custom domain).
    'https://admin.merchos.co.za',
    // Raw Amplify branch origin.
    'https://main.d3katl1796jtte.amplifyapp.com',
    // Local development (admin runs on :3001).
    'http://localhost:3001',
  ];
}

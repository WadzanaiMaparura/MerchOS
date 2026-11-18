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

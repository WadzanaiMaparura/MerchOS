import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DEV_UNTIL_CUTOVER, PRODUCTION_PRE_DOMAIN_ORIGINS, adminDashboardOrigins, sellerDashboardOrigins, siteAddresses } from '../lib/cors-origins';
import { ProductIntelligenceStack } from '../lib/product-intelligence-stack';
import { SupplierIntelligenceStack } from '../lib/supplier-intelligence-stack';

describe('sellerDashboardOrigins', () => {
  it('dev lives on dev.merchos.co.za (and still accepts the live site until the cutover)', () => {
    expect(siteAddresses('dev')).toMatchObject({ seller: 'https://dev.merchos.co.za', admin: 'https://admin.dev.merchos.co.za' });
    expect(sellerDashboardOrigins('dev')).toEqual([
      'https://dev.merchos.co.za',
      ...DEV_UNTIL_CUTOVER.seller,
      'https://dev.merchos.io',
      'https://main.d1jwaah0zt7pg5.amplifyapp.com',
      'http://localhost:3000',
    ]);
    expect(adminDashboardOrigins('dev')).toEqual([
      'https://admin.dev.merchos.co.za',
      ...DEV_UNTIL_CUTOVER.admin,
      'https://admin-dev.merchos.io',
      'https://main.d3katl1796jtte.amplifyapp.com',
      'http://localhost:3001',
    ]);
  });
  it('production allows only the live domain, plus its own Amplify branch until the domain switch', () => {
    expect(sellerDashboardOrigins('production')).toEqual(['https://merchos.co.za', ...PRODUCTION_PRE_DOMAIN_ORIGINS.seller]);
    expect(adminDashboardOrigins('production')).toEqual(['https://admin.merchos.co.za', ...PRODUCTION_PRE_DOMAIN_ORIGINS.admin]);
    // Never dev's Amplify branches or localhost.
    for (const o of [...sellerDashboardOrigins('production'), ...adminDashboardOrigins('production')]) {
      expect(o).not.toMatch(/localhost|d1jwaah0zt7pg5|d3katl1796jtte|merchos\.io|dev\./);
    }
    expect(siteAddresses('production')).toMatchObject({ seller: 'https://merchos.co.za', admin: 'https://admin.merchos.co.za' });
  });
  it('another environment gets its own merchos.co.za subdomain', () => {
    expect(sellerDashboardOrigins('staging')).toEqual(['https://staging.merchos.co.za']);
    expect(adminDashboardOrigins('staging')).toEqual(['https://admin.staging.merchos.co.za']);
  });
  it('never returns a wildcard (APIs use credentials, which forbids it)', () => {
    for (const env of ['dev', 'staging', 'production']) {
      expect(sellerDashboardOrigins(env)).not.toContain('*');
      expect(adminDashboardOrigins(env)).not.toContain('*');
    }
  });
});

describe('every seller-facing API uses the shared allow-list', () => {
  // Regression: 7 of 8 stacks hard-coded a dev-only list, so the live site was
  // blocked by every API except Auth.
  const libDir = join(__dirname, '../lib');
  const stacks = readdirSync(libDir).filter((f) => f.endsWith('-stack.ts'));

  it('no stack hard-codes its own allowOrigins list', () => {
    const offenders = stacks.filter((f) => {
      const src = readFileSync(join(libDir, f), 'utf8');
      return /allowOrigins:\s*\[/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('every stack that configures CORS reads a shared allow-list (seller site or admin dashboard)', () => {
    for (const f of stacks) {
      const src = readFileSync(join(libDir, f), 'utf8');
      if (/allowOrigins:/.test(src)) expect(src, f).toMatch(/(seller|admin)DashboardOrigins\(/);
    }
  });

  it.each([
    ['ProductIntelligence', (a: cdk.App) => new ProductIntelligenceStack(a, 'PI', { env: { account: '123456789012', region: 'eu-west-1' }, environment: 'dev' })],
    ['SupplierIntelligence', (a: cdk.App) => new SupplierIntelligenceStack(a, 'SI', { env: { account: '123456789012', region: 'eu-west-1' }, environment: 'dev' })],
  ])('%s synthesises with dev.merchos.co.za in its dev CORS config', (_n, make) => {
    const t = Template.fromStack(make(new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })));
    const apis = Object.values(t.findResources('AWS::ApiGatewayV2::Api')) as Array<{ Properties: { CorsConfiguration?: { AllowOrigins?: string[] } } }>;
    const withCors = apis.filter((a) => a.Properties.CorsConfiguration);
    expect(withCors.length).toBeGreaterThan(0);
    for (const a of withCors) {
      expect(a.Properties.CorsConfiguration!.AllowOrigins).toContain('https://dev.merchos.co.za');
      expect(a.Properties.CorsConfiguration!.AllowOrigins).not.toContain('https://merchos.co.za');
    }
  });
});

describe('every route method is allowed by the CORS config of its API', () => {
  // Regression: PATCH /products/{productId}/attributes existed but the Product API's
  // CORS allowMethods lacked PATCH, so browsers blocked every attribute edit.
  const libDir = join(__dirname, '../lib');
  for (const f of readdirSync(libDir).filter((n) => n.endsWith('-stack.ts'))) {
    const src = readFileSync(join(libDir, f), 'utf8');
    const cors = src.match(/allowMethods:\s*\[([\s\S]*?)\]/);
    if (!cors) continue;
    it(f, () => {
      const allowed = new Set([...cors[1]!.matchAll(/CorsHttpMethod\.(\w+)/g)].map((m) => m[1]));
      const used = [...src.matchAll(/methods:\s*\[([^\]]+)\]/g)].flatMap((m) =>
        [...m[1]!.matchAll(/HttpMethod\.(\w+)/g)].map((x) => x[1])
      );
      expect(used.filter((m) => !allowed.has(m))).toEqual([]);
    });
  }
});

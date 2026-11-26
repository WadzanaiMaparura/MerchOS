/**
 * The production app (`cdk synth --context env=production`) synthesises from
 * the real bin/merch-os.ts with the real cdk.json context: every stack, only
 * production addresses, the production switches, and its own image key.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const cdkJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8')) as {
  context: Record<string, unknown> & { envConfig: Record<string, Record<string, string>> };
};
// The CLI merges cdk.context.json (dev's image key) into the context; so do we.
const cdkContext = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cdk.context.json'), 'utf8')) as Record<string, unknown>;

// A throwaway public key: only checked for presence and passed to CloudFront.
const FAKE_KEY = '-----BEGIN PUBLIC KEY-----\nTEST-ONLY-PRODUCTION-KEY\n-----END PUBLIC KEY-----';

const STACKS = [
  'Foundation', 'Tenant', 'Auth', 'AuthApi', 'ProductApi', 'InventoryApi', 'SupplierIntelligence',
  'ImageIntelligence', 'ProductIntelligence', 'ExportApi', 'BillingApi', 'SupportChat', 'Engagement', 'AdminApi',
];

const saved = { ...process.env };
const outdirs: string[] = [];

/** Runs bin/merch-os.ts once with the given production config; returns the assembly dir. */
async function synthProduction(production: Record<string, string>): Promise<string> {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'merchos-prod-synth-'));
  outdirs.push(outdir);
  const context = {
    ...cdkContext,
    ...cdkJson.context,
    envConfig: { ...cdkJson.context.envConfig, production },
    env: 'production',
    // Skip asset bundling (esbuild) for every stack: templates only.
    'aws:cdk:bundling-stacks': [],
  };
  // The dev key at top level must never be used for production.
  expect(context).toHaveProperty('imageSigningPublicKey');
  process.env['CDK_CONTEXT_JSON'] = JSON.stringify(context);
  process.env['CDK_OUTDIR'] = outdir;
  process.env['CDK_DEFAULT_ACCOUNT'] = '210987654321';
  process.env['CDK_DEFAULT_REGION'] = 'eu-west-1';
  vi.resetModules();
  await import('../bin/merch-os');
  return outdir;
}

type Template = { Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }> };
const read = (dir: string, stack: string): Template =>
  JSON.parse(fs.readFileSync(path.join(dir, `MerchOS-${stack}-production.template.json`), 'utf8')) as Template;
const lambdaEnv = (t: Template, key: string) =>
  Object.values(t.Resources)
    .filter((r) => r.Type === 'AWS::Lambda::Function')
    .map((r) => (r.Properties?.['Environment'] as { Variables?: Record<string, unknown> } | undefined)?.Variables ?? {})
    .filter((v) => key in v)
    .map((v) => v[key]);

describe('production app synthesis', () => {
  let dir: string;
  let all: string;

  beforeAll(async () => {
    dir = await synthProduction({ ...cdkJson.context.envConfig['production']!, imageSigningPublicKey: FAKE_KEY });
    all = STACKS.map((s) => fs.readFileSync(path.join(dir, `MerchOS-${s}-production.template.json`), 'utf8')).join('\n');
  }, 300_000);

  afterAll(() => {
    process.env = saved;
    for (const d of outdirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it('synthesises all 14 stacks, named for production', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
      artifacts: Record<string, { type: string }>;
    };
    const stacks = Object.entries(manifest.artifacts)
      .filter(([, a]) => a.type === 'aws:cloudformation:stack')
      .map(([n]) => n)
      .sort();
    expect(stacks).toEqual(STACKS.map((s) => `MerchOS-${s}-production`).sort());
  });

  it('deploys every SSM parameter before any stack reads it (a new account has none)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
      artifacts: Record<string, { type: string; dependencies?: string[] }>;
    };
    const deps = (name: string, seen = new Set<string>()): Set<string> => {
      for (const d of manifest.artifacts[name]?.dependencies ?? []) {
        if (!seen.has(d)) { seen.add(d); deps(d, seen); }
      }
      return seen;
    };
    type Full = Template & { Parameters?: Record<string, { Type: string; Default?: string }> };
    const creators = new Map<string, string>();
    for (const s of STACKS) {
      for (const r of Object.values(read(dir, s).Resources)) {
        if (r.Type === 'AWS::SSM::Parameter') creators.set(String(r.Properties?.['Name']), `MerchOS-${s}-production`);
      }
    }
    const problems: string[] = [];
    for (const s of STACKS) {
      const stack = `MerchOS-${s}-production`;
      for (const p of Object.values((read(dir, s) as Full).Parameters ?? {})) {
        if (!p.Type.startsWith('AWS::SSM::Parameter::Value') || !p.Default) continue;
        if (p.Default.startsWith('/cdk-bootstrap/')) continue; // created by `cdk bootstrap`
        const creator = creators.get(p.Default);
        if (!creator) problems.push(`${stack} reads ${p.Default}, which no stack creates`);
        else if (creator !== stack && !deps(stack).has(creator)) problems.push(`${stack} reads ${p.Default} before ${creator} deploys`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('creates the production tenants table', () => {
    expect(all).toContain('merch-os-tenants-production');
  });

  it('uses only production site addresses (no dev, Amplify branch, localhost or merchos.io hosts)', () => {
    for (const bad of ['dev.merchos.co.za', 'merchos.io', 'amplifyapp.com', 'localhost']) {
      expect(all, bad).not.toContain(bad);
    }
    expect(all).toContain('https://merchos.co.za');
    expect(all).toContain('https://admin.merchos.co.za');
  });

  it('points Cognito callbacks at the production sites only', () => {
    const clients = Object.values(read(dir, 'Auth').Resources).filter((r) => r.Type === 'AWS::Cognito::UserPoolClient');
    expect(clients).toHaveLength(3);
    // The api-gateway client has no hosted sign-in at all.
    const apiClient = clients.find((c) => String(c.Properties?.['ClientName']).startsWith('api-gateway-'));
    expect(apiClient?.Properties?.['AllowedOAuthFlows']).toBeUndefined();
    expect(apiClient?.Properties?.['CallbackURLs']).toBeUndefined();
    expect(all).not.toContain('example.com');
    const urls = clients.flatMap((c) => (c.Properties?.['CallbackURLs'] as string[] | undefined) ?? []).sort();
    expect(urls).toEqual(['https://admin.merchos.co.za/callback', 'https://merchos.co.za/callback']);
  });

  it('applies the production switches', () => {
    expect(new Set(lambdaEnv(read(dir, 'Auth'), 'SIGNUPS_OPEN'))).toEqual(new Set(['false']));
    expect(new Set(lambdaEnv(read(dir, 'AuthApi'), 'SIGNUPS_OPEN'))).toEqual(new Set(['false']));
    expect(new Set(lambdaEnv(read(dir, 'AdminApi'), 'PAYMENTS_LIVE'))).toEqual(new Set(['false']));
    expect(new Set(lambdaEnv(read(dir, 'ProductApi'), 'TRIAL_ENFORCEMENT'))).toEqual(new Set(['true']));
    expect(new Set(lambdaEnv(read(dir, 'AdminApi'), 'DATA_RETENTION'))).toEqual(new Set(['on']));
  });

  it('signs images with the production key, never the dev key', () => {
    const dev = String(cdkContext['imageSigningPublicKey']).trim();
    expect(all).toContain('TEST-ONLY-PRODUCTION-KEY');
    expect(all).not.toContain(dev.split('\n')[1]!);
  });

  it('refuses to synthesise production without its own image signing key', async () => {
    const { imageSigningPublicKey: _drop, ...noKey } = cdkJson.context.envConfig['production']!;
    await expect(synthProduction(noKey)).rejects.toThrow(/imageSigningPublicKey/);
  }, 300_000);
});

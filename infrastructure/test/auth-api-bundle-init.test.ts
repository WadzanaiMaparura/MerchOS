import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as esbuild from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Runtime regression guard for the AuthApi Lambda bundles.
 *
 * The AuthApi handlers are bundled as ESM (NodejsFunction OutputFormat.ESM).
 * esbuild replaces CommonJS `require` with a stub that throws
 * `Dynamic require of "x" is not supported` at runtime. A transitive CJS
 * dependency performs a dynamic `require('util')` during module
 * initialisation, which previously crashed every handler on cold start
 * (observed live as HTTP 500 with that exact error).
 *
 * This test bundles each handler with the SAME esbuild settings the stack uses
 * — crucially including the `createRequire` banner — and then imports each
 * generated bundle in-process to prove module initialisation succeeds. It does
 * NOT invoke the handler, call Cognito, or touch DynamoDB; importing the module
 * only runs top-level/initialisation code.
 *
 * If the banner is removed or a future change reintroduces an unsupported
 * dynamic require at init, importing the bundle throws and this test fails.
 */

// Mirror of infrastructure/lib/auth-api-stack.ts defaultLambdaProps.bundling.
// Keep in sync with the stack; the banner is the regression fix under test.
const REQUIRE_BANNER =
  "import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);";

const HANDLERS = [
  // NOTE: 'login' and 'refresh' were removed — those server-side endpoints no
  // longer exist (frontend authenticates via Amplify SRP). The set below is the
  // exact surviving AuthApi handler list; EXPECTED_HANDLER_COUNT guards it.
  'logout',
  'forgot-password',
  'reset-password',
  'verify-email',
  'change-password',
  'mfa-setup',
  'session',
  'invite-user',
  'list-users',
  'update-role',
  'disable-user',
  'delete-user',
  'profile-status',
  'complete-profile',
] as const;

/** The exact number of surviving AuthApi Lambda handlers after B1 removal. */
const EXPECTED_HANDLER_COUNT = 14;

const handlersDir = path.resolve(__dirname, '../../services/auth/handlers');
let outDir: string;

/**
 * Bundle one handler exactly as the stack does (ESM, node20, minify, sourcemap,
 * mainFields module/main, @aws-sdk/* external) WITH the require banner, into a
 * directory under infrastructure/ so the externalised @aws-sdk/* packages
 * resolve against the workspace node_modules at import time.
 */
async function bundle(handler: string): Promise<string> {
  const outfile = path.join(outDir, `${handler}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(handlersDir, `${handler}.ts`)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: true,
    sourcemap: true,
    mainFields: ['module', 'main'],
    external: ['@aws-sdk/*'],
    banner: { js: REQUIRE_BANNER },
    outfile,
    logLevel: 'silent',
  });
  return outfile;
}

describe('AuthApi Lambda bundle initialisation (ESM require regression guard)', () => {
  beforeAll(() => {
    // Place the output under infrastructure/ so Node can resolve the
    // externalised @aws-sdk/* bare specifiers via the workspace node_modules.
    outDir = fs.mkdtempSync(path.join(__dirname, '..', '.bundle-init-'));
  });

  afterAll(() => {
    if (outDir) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('covers exactly the surviving AuthApi handler set (no login/refresh)', () => {
    expect(HANDLERS.length).toBe(EXPECTED_HANDLER_COUNT);
    expect(HANDLERS).not.toContain('login');
    expect(HANDLERS).not.toContain('refresh');
    // A couple of surviving handlers must remain covered.
    expect(HANDLERS).toContain('profile-status');
    expect(HANDLERS).toContain('complete-profile');
  });

  it('includes the createRequire banner so dynamic requires resolve at runtime', async () => {
    const outfile = await bundle('logout');
    const code = fs.readFileSync(outfile, 'utf8');
    expect(code).toContain('createRequire');
  }, 30000);

  for (const handler of HANDLERS) {
    it(`loads the ${handler} bundle without a module-initialisation error`, async () => {
      const outfile = await bundle(handler);
      // Importing runs module-init code only; it must not throw. A recurrence
      // of the original bug surfaces here as:
      //   Error: Dynamic require of "util" is not supported
      let loadError: unknown;
      let mod: Record<string, unknown> | undefined;
      try {
        mod = (await import(pathToFileURL(outfile).href)) as Record<string, unknown>;
      } catch (err) {
        loadError = err;
      }

      expect(
        loadError,
        loadError instanceof Error ? loadError.message : String(loadError),
      ).toBeUndefined();
      // Each handler must export a callable `handler` entry point.
      expect(typeof mod?.['handler']).toBe('function');
    }, 30000); // real esbuild bundle + import can exceed the 5s default under load
  }
});

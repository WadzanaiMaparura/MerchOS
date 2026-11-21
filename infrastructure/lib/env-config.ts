/**
 * Per-environment deployment settings.
 *
 * Values live in cdk.json under `context.envConfig.<env>` so a plain
 * `cdk deploy --context env=dev` reproduces the live configuration. Before this,
 * settings such as `payfastMode=live` had to be remembered on every deploy and a
 * forgotten flag silently switched PayFast back to sandbox.
 *
 * Precedence: explicit `--context key=value` > cdk.json envConfig[env][key] > fallback.
 */
import type { Construct } from 'constructs';

export function envSetting(scope: Construct, env: string, key: string): string | undefined;
export function envSetting(scope: Construct, env: string, key: string, fallback: string): string;
export function envSetting(scope: Construct, env: string, key: string, fallback?: string): string | undefined {
  const explicit = scope.node.tryGetContext(key) as unknown;
  if (explicit !== undefined && explicit !== null && explicit !== '') return String(explicit);

  const all = scope.node.tryGetContext('envConfig') as Record<string, Record<string, unknown>> | undefined;
  const fromConfig = all?.[env]?.[key];
  if (fromConfig !== undefined && fromConfig !== null && fromConfig !== '') return String(fromConfig);

  return fallback;
}

/** 'true' / 'false' string for Lambda env vars; anything but "true" is false. */
export function envFlag(scope: Construct, env: string, key: string): 'true' | 'false' {
  return envSetting(scope, env, key, 'false') === 'true' ? 'true' : 'false';
}

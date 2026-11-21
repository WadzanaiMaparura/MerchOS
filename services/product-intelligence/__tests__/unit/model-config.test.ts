import { describe, it, expect, vi, afterEach } from 'vitest';

/** model-config reads env at import time, so load a fresh copy per test. */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('../../services/model-config');
}

afterEach(() => {
  delete process.env['BEDROCK_HAIKU_MODEL_ID'];
  delete process.env['BEDROCK_SONNET_MODEL_ID'];
});

describe('model-config', () => {
  it('defaults to the 4.5 EU inference profiles (the models this account is entitled to)', async () => {
    const m = await load({ BEDROCK_HAIKU_MODEL_ID: undefined, BEDROCK_SONNET_MODEL_ID: undefined });
    expect(m.DEFAULT_HAIKU_MODEL_ID).toBe('eu.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(m.DEFAULT_SONNET_MODEL_ID).toBe('eu.anthropic.claude-sonnet-4-5-20250929-v1:0');
    expect(m.getModelConfig('title').modelId).toBe(m.DEFAULT_HAIKU_MODEL_ID);
    // Descriptions run on Haiku: the launch pricing depends on the lower cost.
    expect(m.getModelConfig('description').modelId).toBe(m.DEFAULT_HAIKU_MODEL_ID);
    expect(m.getModelConfig('compliance').modelId).toBe(m.DEFAULT_SONNET_MODEL_ID);
  });

  it('can be switched to 5.5 by configuration alone', async () => {
    const m = await load({ BEDROCK_HAIKU_MODEL_ID: 'eu.anthropic.claude-haiku-5-5', BEDROCK_SONNET_MODEL_ID: 'eu.anthropic.claude-sonnet-5-5' });
    expect(m.getModelConfig('title').modelId).toBe('eu.anthropic.claude-haiku-5-5');
    expect(m.getModelConfig('seo').modelId).toBe('eu.anthropic.claude-sonnet-5-5');
  });

  it.each(['', '   ', 'anthropic.claude-haiku-4-5', 'us.anthropic.x', 'eu.bad model', 'eu.x;rm'])(
    'ignores an invalid override (%j) and keeps the safe default',
    async (bad) => {
      const m = await load({ BEDROCK_HAIKU_MODEL_ID: bad });
      expect(m.getModelConfig('title').modelId).toBe(m.DEFAULT_HAIKU_MODEL_ID);
    }
  );

  it('every generation type has a Claude model configured', async () => {
    const m = await load({});
    for (const t of ['title', 'description', 'bullets', 'seo', 'category', 'brand', 'attributes', 'keywords', 'compliance'] as const) {
      expect(m.getModelConfig(t).modelId).toMatch(/^eu\.anthropic\.claude-/);
    }
  });
});

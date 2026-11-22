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

const VARS = ['BEDROCK_FAST_MODEL_ID', 'BEDROCK_STRONG_MODEL_ID', 'BEDROCK_HAIKU_MODEL_ID', 'BEDROCK_SONNET_MODEL_ID'];
afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe('model-config', () => {
  it('defaults to Amazon Nova EU inference profiles (the models this account can use)', async () => {
    const m = await load({});
    expect(m.DEFAULT_FAST_MODEL_ID).toBe('eu.amazon.nova-lite-v1:0');
    expect(m.DEFAULT_STRONG_MODEL_ID).toBe('eu.amazon.nova-pro-v1:0');
    expect(m.getModelConfig('title').modelId).toBe(m.DEFAULT_FAST_MODEL_ID);
    expect(m.getModelConfig('description').modelId).toBe(m.DEFAULT_STRONG_MODEL_ID);
    expect(m.getModelConfig('compliance').modelId).toBe(m.DEFAULT_STRONG_MODEL_ID);
    // Nova Lite wrote bullets as one paragraph; Pro follows the format.
    expect(m.getModelConfig('bullets').modelId).toBe(m.DEFAULT_STRONG_MODEL_ID);
  });

  it('can be switched (e.g. to Claude) by configuration alone', async () => {
    const m = await load({
      BEDROCK_FAST_MODEL_ID: 'eu.anthropic.claude-haiku-5-5',
      BEDROCK_STRONG_MODEL_ID: 'eu.anthropic.claude-sonnet-5-5',
    });
    expect(m.getModelConfig('title').modelId).toBe('eu.anthropic.claude-haiku-5-5');
    expect(m.getModelConfig('seo').modelId).toBe('eu.anthropic.claude-sonnet-5-5');
  });

  it('still honours the older HAIKU/SONNET variable names', async () => {
    const m = await load({ BEDROCK_HAIKU_MODEL_ID: 'eu.amazon.nova-micro-v1:0' });
    expect(m.getModelConfig('title').modelId).toBe('eu.amazon.nova-micro-v1:0');
  });

  it.each(['', '   ', 'amazon.nova-lite-v1:0', 'us.amazon.nova-lite-v1:0', 'eu.bad model', 'eu.x;rm'])(
    'ignores an invalid override (%j) and keeps the safe default',
    async (bad) => {
      const m = await load({ BEDROCK_FAST_MODEL_ID: bad });
      expect(m.getModelConfig('title').modelId).toBe(m.DEFAULT_FAST_MODEL_ID);
    }
  );

  it('every generation type has an EU model configured', async () => {
    const m = await load({});
    for (const t of ['title', 'description', 'bullets', 'seo', 'category', 'brand', 'attributes', 'keywords', 'compliance'] as const) {
      expect(m.getModelConfig(t).modelId).toMatch(/^eu\.amazon\.nova-(lite|pro)-v1:0$/);
    }
  });
});

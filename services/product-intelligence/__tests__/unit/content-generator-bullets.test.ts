import { describe, expect, it } from 'vitest';
import { ContentGenerator } from '../../services/content-generator';
import { PromptManager } from '../../services/prompt-manager';
import { ResponseCache } from '../../services/response-cache';

class Prompts extends PromptManager {
  override async getActiveTemplate() {
    return { templateId: 't', generationType: 'bullets', version: 3, content: 'Write {{bullet_count}} bullets', active: true, createdAt: '', updatedAt: '' } as never;
  }
}
class NoCache extends ResponseCache {
  override async get() {
    return null;
  }
  override async set() {
    return undefined;
  }
}
const bedrockSays = (text: string) =>
  ({ invoke: async () => ({ content: text, inputTokens: 1, outputTokens: 1, modelId: 'm', latencyMs: 1 }) }) as never;

async function bullets(text: string): Promise<string[]> {
  const g = new ContentGenerator({ promptManager: new Prompts(), responseCache: new NoCache(), bedrockClient: bedrockSays(text) });
  const r = await g.generateBullets({ productData: { name: 'Kettle' } });
  return r.content.type === 'bullets' ? r.content.bullets : [];
}

describe('bullet parsing', () => {
  it('keeps numbers that start a bullet ("1.7 litre" stays 1.7 litre)', async () => {
    expect(await bullets('1.7 litre capacity for several cups\n2.5 m cord\n12V adapter included')).toEqual([
      '1.7 litre capacity for several cups',
      '2.5 m cord',
      '12V adapter included',
    ]);
  });

  it('still strips real list markers', async () => {
    expect(await bullets('1. First point\n2) Second point\n- Third point\n• Fourth point\n* Fifth point')).toEqual([
      'First point',
      'Second point',
      'Third point',
      'Fourth point',
      'Fifth point',
    ]);
  });

  it('a numbered list whose items start with a number keeps the item number out and the value in', async () => {
    expect(await bullets('1. 1.7 litre capacity\n2. 2200 W element')).toEqual(['1.7 litre capacity', '2200 W element']);
  });
});

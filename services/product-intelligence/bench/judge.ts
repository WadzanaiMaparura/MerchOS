/**
 * Optional second opinion on accuracy (bench --judge): one model call per
 * product compares the listing with the product information and lists
 * statements that are wrong (contradict it) or unsupported (not in it).
 *
 * The plain-code checks catch invented numbers and known risky claims; this
 * catches the rest ("comes with a carry bag" when nothing says so). It is a
 * cross-check, not the final word: your review in review.csv is.
 */

import { BedrockClient } from '../services/bedrock-client';
import { getModelConfig } from '../services/model-config';
import type { BenchOutput, CheckFinding } from './types';

const bedrock = new BedrockClient();

export function judgePrompt(sourceText: string, o: BenchOutput): string {
  const listing = [
    `TITLE: ${o.title ?? ''}`,
    `BULLETS:\n${(o.bullets ?? []).map((b) => `- ${b}`).join('\n')}`,
    `DESCRIPTION:\n${o.description ?? ''}`,
    `ATTRIBUTES:\n${(o.attributes ?? []).map((a) => `${a.key}: ${a.value}`).join('\n')}`,
  ].join('\n\n');
  return `You check product listings for accuracy. Compare the LISTING with the PRODUCT INFORMATION.

List every statement in the listing that is:
- "wrong": it contradicts the product information (a different size, material, colour, quantity, model...)
- "unsupported": it states a specific fact or feature that the product information does not contain

General marketing phrasing that makes no factual claim ("stylish", "great for everyday use") is fine: do not list it.

Reply with JSON only, no other text:
{"wrong": [{"statement": "...", "why": "..."}], "unsupported": [{"statement": "..."}]}

PRODUCT INFORMATION:
${sourceText}

LISTING:
${listing}`;
}

/** Findings from the model's answer; an answer that is not the expected JSON is reported, not trusted. */
export function parseJudge(raw: string): CheckFinding[] {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let parsed: { wrong?: Array<{ statement?: string; why?: string }>; unsupported?: Array<{ statement?: string }> };
  try {
    parsed = JSON.parse(json);
  } catch {
    return [{ area: 'accuracy', level: 'warn', message: 'Cross-check gave no readable answer' }];
  }
  return [
    ...(parsed.wrong ?? [])
      .filter((w) => w.statement)
      .map((w) => ({ area: 'accuracy' as const, level: 'fail' as const, message: `Cross-check, wrong: "${w.statement}"${w.why ? ` (${w.why})` : ''}` })),
    ...(parsed.unsupported ?? [])
      .filter((u) => u.statement)
      .map((u) => ({ area: 'accuracy' as const, level: 'warn' as const, message: `Cross-check, not in the product information: "${u.statement}"` })),
  ];
}

export async function judge(sourceText: string, o: BenchOutput): Promise<CheckFinding[]> {
  const model = getModelConfig('compliance');
  const r = await bedrock.invoke({ modelId: model.modelId, prompt: judgePrompt(sourceText, o), maxTokens: 2048, temperature: 0 });
  return parseJudge(r.content);
}

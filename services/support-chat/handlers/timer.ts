/**
 * Fired by EventBridge Scheduler for a waiting chat (see lib/timers.ts).
 *   remind  (+60s):  push again; visitor sees "Still finding someone…"
 *   timeout (+120s): nobody answered — mark MISSED and open the details form
 * Both are no-ops once someone has accepted, or the chat ended.
 */

import { toAgents, toVisitor } from '../lib/broadcast';
import { bestEffort, pushToAgents } from '../lib/notify';
import { getConversation, transitionConversation } from '../lib/store';
import type { TimerEvent } from '../lib/timers';

export async function handler(event: TimerEvent): Promise<{ handled: boolean }> {
  const { conversationId, step } = event ?? ({} as TimerEvent);
  if (typeof conversationId !== 'string' || (step !== 'remind' && step !== 'timeout')) {
    return { handled: false };
  }

  if (step === 'remind') {
    const c = await getConversation(conversationId);
    if (c?.status !== 'WAITING') return { handled: false };
    await Promise.all([
      bestEffort('Visitor reminder', () => toVisitor(conversationId, { type: 'still_finding', conversationId })),
      bestEffort('Push reminder', () =>
        pushToAgents({
          title: 'Chat still waiting (1 min)',
          body: `${c.name ?? 'A visitor'}: ${c.lastMessage ?? ''}`,
          url: `/support?c=${conversationId}`,
          tag: `chat-${conversationId}`,
        }),
      ),
    ]);
    return { handled: true };
  }

  const missed = await transitionConversation(conversationId, ['WAITING'], 'MISSED');
  if (!missed) return { handled: false };
  await Promise.all([
    bestEffort('Visitor timeout', () => toVisitor(conversationId, { type: 'no_one_free', conversationId })),
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation: missed })),
  ]);
  return { handled: true };
}

/**
 * WebSocket messages ($default). Messages themselves are sent over HTTPS (so
 * the sender gets a clear success/error); the socket carries only:
 *   { action: 'typing', conversationId? }  forward a typing indicator
 *   { action: 'heartbeat' }                 agent inbox is open (presence)
 */

import type { APIGatewayProxyResult, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { toAgents, toVisitor } from '../lib/broadcast';
import { getConnection, getConversation, touchPresence } from '../lib/store';

const ok: APIGatewayProxyResult = { statusCode: 200, body: '' };

export async function handler(event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId;
  let body: { action?: unknown; conversationId?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return ok;
  }
  if ((event.body?.length ?? 0) > 2000) return ok;

  try {
    const conn = await getConnection(connectionId);
    if (!conn) return ok;

    if (body.action === 'heartbeat') {
      if (conn.role === 'agent' && conn.agentId) await touchPresence(conn.agentId);
      return ok;
    }

    if (body.action === 'typing') {
      if (conn.role === 'visitor' && conn.conversationId) {
        await toAgents({ type: 'typing', conversationId: conn.conversationId, from: 'visitor' });
      } else if (conn.role === 'agent' && typeof body.conversationId === 'string') {
        const c = await getConversation(body.conversationId);
        if (c?.status === 'ACTIVE') {
          await toVisitor(c.conversationId, { type: 'typing', conversationId: c.conversationId, from: 'agent' });
        }
      }
    }
  } catch (err) {
    console.warn('Chat socket message ignored', { error: (err as Error).message });
  }
  return ok;
}

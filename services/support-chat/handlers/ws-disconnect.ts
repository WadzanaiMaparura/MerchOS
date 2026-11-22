/** WebSocket $disconnect: forget the socket; tell the inbox if the visitor left. */

import type { APIGatewayProxyResult, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { toAgents } from '../lib/broadcast';
import { bestEffort } from '../lib/notify';
import { deleteConnection, getConnection, listVisitorConnections } from '../lib/store';

export async function handler(event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId;
  try {
    const conn = await getConnection(connectionId);
    await deleteConnection(connectionId, conn);
    const conversationId = conn?.role === 'visitor' ? conn.conversationId : undefined;
    if (conversationId && (await listVisitorConnections(conversationId)).length === 0) {
      await bestEffort('Visitor status', () =>
        toAgents({ type: 'visitor_status', conversationId, connected: false }),
      );
    }
  } catch (err) {
    console.error('Chat disconnect cleanup failed', { error: (err as Error).message });
  }
  return { statusCode: 200, body: '' };
}

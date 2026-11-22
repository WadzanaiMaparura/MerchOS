/**
 * WebSocket $connect.
 *   Visitor: ?role=visitor&token=<visitor token>   (bound to one conversation)
 *   Agent:   ?role=agent&token=<Cognito access token> (Support/Admin only)
 * Returning a non-2xx status refuses the connection.
 */

import type { APIGatewayProxyResult, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { verifyAgentToken } from '../lib/agent-auth';
import { toAgents } from '../lib/broadcast';
import { config, getChatSecret } from '../lib/config';
import { header, originAllowed } from '../lib/http';
import { bestEffort } from '../lib/notify';
import { getConversation, putConnection, touchPresence } from '../lib/store';
import { verifyVisitorToken } from '../lib/visitor-token';

type ConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
};

const refuse = (statusCode: number): APIGatewayProxyResult => ({ statusCode, body: '' });

export async function handler(event: ConnectEvent): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId;
  const role = event.queryStringParameters?.['role'];
  const token = event.queryStringParameters?.['token'];
  const origin = header(event, 'origin');

  try {
    if (role === 'visitor') {
      if (!originAllowed(origin, config.visitorOrigins)) return refuse(403);
      const secret = await getChatSecret();
      const conversationId = verifyVisitorToken(token, secret.visitorTokenSecret);
      if (!conversationId || !(await getConversation(conversationId))) return refuse(401);
      await putConnection({ connectionId, role: 'visitor', conversationId });
      await bestEffort('Visitor status', () =>
        toAgents({ type: 'visitor_status', conversationId, connected: true }),
      );
      return { statusCode: 200, body: '' };
    }

    if (role === 'agent') {
      if (!originAllowed(origin, config.agentOrigins)) return refuse(403);
      const agentId = await verifyAgentToken(token);
      if (!agentId) return refuse(401);
      await putConnection({ connectionId, role: 'agent', agentId });
      await touchPresence(agentId);
      return { statusCode: 200, body: '' };
    }

    return refuse(400);
  } catch (err) {
    console.error('Chat connect failed', { role, error: (err as Error).message });
    return refuse(500);
  }
}

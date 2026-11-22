/**
 * Push events down open WebSockets. A socket that has gone away (410) is
 * removed so it is not retried.
 */

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { config } from './config';
import { deleteConnection, listAgentConnections, listVisitorConnections } from './store';
import type { ChatMessage, Conversation } from './store';

/** Everything the server sends on a socket. */
export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; conversationId: string; from: 'visitor' | 'agent' }
  | { type: 'accepted'; conversationId: string; agentName: string }
  | { type: 'resolved'; conversationId: string }
  | { type: 'still_finding'; conversationId: string }
  | { type: 'no_one_free'; conversationId: string }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'conversation_deleted'; conversationId: string }
  | { type: 'visitor_status'; conversationId: string; connected: boolean }
  | { type: 'error'; message: string };

let client: ApiGatewayManagementApiClient | undefined;
function api(): ApiGatewayManagementApiClient {
  client ??= new ApiGatewayManagementApiClient({ endpoint: config.wsCallbackUrl });
  return client;
}

export async function sendToConnection(connectionId: string, event: ChatEvent): Promise<boolean> {
  try {
    await api().send(
      new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(event)) }),
    );
    return true;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'GoneException' || e.$metadata?.httpStatusCode === 410) {
      await deleteConnection(connectionId).catch(() => undefined);
      return false;
    }
    throw err;
  }
}

async function sendToAll(connectionIds: string[], event: ChatEvent, except?: string): Promise<void> {
  await Promise.allSettled(
    connectionIds.filter((id) => id !== except).map((id) => sendToConnection(id, event)),
  );
}

export async function toVisitor(conversationId: string, event: ChatEvent, except?: string): Promise<void> {
  await sendToAll(await listVisitorConnections(conversationId), event, except);
}

export async function toAgents(event: ChatEvent, except?: string): Promise<void> {
  await sendToAll(await listAgentConnections(), event, except);
}

import { Elysia } from 'elysia';
import type { Db } from '@cockpit/db';
import { agents, eq } from '@cockpit/db';
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  createResponse,
  createErrorResponse,
  JsonRpcErrorCode,
  CommandMethod,
  EventMethod,
} from '@cockpit/core/protocol';
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from '@cockpit/core/protocol';
import { getAgentRegistry } from '../services/agent-registry';
import { getBroadcastService } from '../services/broadcast';
import { createInstanceTracker } from '../services/instance-tracker';
import { safeJsonParse } from '@cockpit/core/utils';

// Store agent ID on WebSocket object directly (WeakMap doesn't work with Elysia ws wrappers)
interface WsWithAgentId {
  agentId?: string;
}

/**
 * WebSocket routes for agent connections
 */
export function createWebsocketRoutes(db: Db) {
  const agentRegistry = getAgentRegistry();
  const broadcast = getBroadcastService();
  const instanceTracker = createInstanceTracker(db);

  return new Elysia({ prefix: '/ws' })
    .ws('/hub', {
      // WebSocket open handler
      open(ws) {
        console.log('[Hub] New WebSocket connection');
        // Agent will send registration message
      },

      // WebSocket message handler
      async message(ws, rawMessage) {
        let message: unknown;

        // Parse message - handle Buffer type from ws library
        if (typeof rawMessage === 'string') {
          message = safeJsonParse(rawMessage);
        } else if (rawMessage instanceof ArrayBuffer) {
          message = safeJsonParse(new TextDecoder().decode(rawMessage));
        } else if (Buffer.isBuffer(rawMessage)) {
          message = safeJsonParse(rawMessage.toString('utf-8'));
        } else {
          message = rawMessage;
        }

        if (!message) {
          ws.send(JSON.stringify(
            createErrorResponse('0', JsonRpcErrorCode.PARSE_ERROR, 'Invalid JSON')
          ));
          return;
        }

        // Handle JSON-RPC request
        if (isJsonRpcRequest(message)) {
          const response = await handleRequest(ws, message, db, agentRegistry, broadcast, instanceTracker);
          ws.send(JSON.stringify(response));
          return;
        }

        // Handle JSON-RPC response (from agent to pending hub request)
        if (isJsonRpcResponse(message)) {
          agentRegistry.handleResponseByRequestId(message);
          return;
        }

        // Handle JSON-RPC notification
        if (isJsonRpcNotification(message)) {
          const agentId = (ws as WsWithAgentId).agentId;
          if (agentId) {
            await handleNotification(agentId, message, broadcast, instanceTracker);
          }
          return;
        }

        // Unknown message format
        ws.send(JSON.stringify(
          createErrorResponse('0', JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC message')
        ));
      },

      // WebSocket close handler
      close(ws) {
        const agentId = (ws as WsWithAgentId).agentId;
        if (agentId) {
          console.log(`[Hub] Agent disconnected: ${agentId}`);
          agentRegistry.unregister(agentId);

          // Broadcast agent disconnection
          broadcast.broadcast('agent:disconnected', { agentId });
        }
      },
    });
}

/**
 * Handle incoming JSON-RPC requests from agents
 */
async function handleRequest(
  ws: unknown,
  request: JsonRpcRequest,
  db: Db,
  agentRegistry: ReturnType<typeof getAgentRegistry>,
  broadcast: ReturnType<typeof getBroadcastService>,
  instanceTracker: ReturnType<typeof createInstanceTracker>
): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  switch (method) {
    case 'agent.register': {
      // Agent registration
      const { machineId, hostname, tailscaleIp, os, instances: existingInstances } = params as {
        machineId: string;
        hostname: string;
        tailscaleIp: string;
        os: 'windows' | 'darwin' | 'linux';
        instances?: Array<{ id: string; sessionId?: string; cwd: string; status: string }>;
      };

      if (!machineId || !hostname || !tailscaleIp || !os) {
        return createErrorResponse(id, JsonRpcErrorCode.INVALID_PARAMS, 'Missing required registration parameters');
      }

      // Check if this machine already exists in the database
      const existingDbAgent = await db
        .select()
        .from(agents)
        .where(eq(agents.machineId, machineId))
        .limit(1);

      let agentId: string;
      const now = new Date();

      if (existingDbAgent.length > 0) {
        // Reuse existing database ID to maintain foreign key consistency
        agentId = existingDbAgent[0].id;

        // Update existing record
        await db.update(agents)
          .set({
            hostname,
            tailscaleIp,
            status: 'online',
            lastSeen: now,
          })
          .where(eq(agents.id, agentId));
      } else {
        // Register new agent in registry (will generate new ID)
        const newAgent = agentRegistry.register(ws, { machineId, hostname, tailscaleIp, os });
        agentId = newAgent.id;

        // Insert new record
        await db.insert(agents).values({
          id: agentId,
          machineId,
          hostname,
          tailscaleIp,
          os,
          status: 'online',
          lastSeen: now,
          createdAt: now,
        });
      }

      // Register/update agent in memory registry with correct ID
      const agent = agentRegistry.registerWithId(ws, agentId, { machineId, hostname, tailscaleIp, os });
      (ws as WsWithAgentId).agentId = agentId;

      // Update existing instances if reported
      if (existingInstances && Array.isArray(existingInstances)) {
        for (const inst of existingInstances) {
          const existing = await instanceTracker.get(inst.id);
          if (existing) {
            await instanceTracker.update(inst.id, {
              sessionId: inst.sessionId,
              status: inst.status as any,
            });
          }
        }
      }

      console.log(`[Hub] Agent registered: ${agent.id} (${hostname})`);

      // Broadcast agent connection
      broadcast.broadcast('agent:connected', {
        id: agent.id,
        machineId,
        hostname,
        tailscaleIp,
        os,
      });

      return createResponse(id, {
        agentId: agent.id,
        registered: true,
      });
    }

    case CommandMethod.AGENT_STATUS: {
      // Agent requesting hub status
      const agentId = (ws as WsWithAgentId).agentId;
      if (!agentId) {
        return createErrorResponse(id, JsonRpcErrorCode.INVALID_REQUEST, 'Agent not registered');
      }

      const activeInstances = await instanceTracker.getActiveByAgent(agentId);

      return createResponse(id, {
        hubVersion: '1.0.0',
        connectedAgents: agentRegistry.onlineCount,
        yourInstances: activeInstances.length,
      });
    }

    default:
      return createErrorResponse(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

/**
 * Handle incoming JSON-RPC notifications from agents
 */
async function handleNotification(
  agentId: string,
  notification: JsonRpcNotification,
  broadcast: ReturnType<typeof getBroadcastService>,
  instanceTracker: ReturnType<typeof createInstanceTracker>
): Promise<void> {
  const { method, params } = notification;

  switch (method) {
    case EventMethod.AGENT_HEARTBEAT: {
      // Update agent's last ping time
      const agentRegistry = getAgentRegistry();
      agentRegistry.updatePing(agentId);
      break;
    }

    case EventMethod.INSTANCE_CREATED: {
      const { instance } = params as { instance: { id: string; sessionId?: string } };
      const updated = await instanceTracker.markStarted(instance.id, instance.sessionId);
      if (updated) {
        broadcast.broadcast('instance:started', updated);
      }
      break;
    }

    case EventMethod.INSTANCE_MESSAGE: {
      const { instanceId, type, content, timestamp } = params as {
        instanceId: string;
        type: string;
        content: string;
        timestamp: string;
      };

      // Broadcast message to dashboard
      broadcast.broadcast('instance:message', {
        instanceId,
        type,
        content,
        timestamp,
      });
      break;
    }

    case EventMethod.INSTANCE_STOPPED: {
      const { instanceId } = params as { instanceId: string };
      const instance = await instanceTracker.markStopped(instanceId);
      if (instance) {
        broadcast.broadcast('instance:stopped', { instanceId, instance });
      }
      break;
    }

    case EventMethod.INSTANCE_STATUS_CHANGED: {
      const { instanceId, newStatus } = params as { instanceId: string; newStatus: string };
      if (newStatus === 'error') {
        const instance = await instanceTracker.markError(instanceId);
        if (instance) {
          broadcast.broadcast('instance:error', { instanceId, instance });
        }
      }
      break;
    }

    default:
      console.log(`[Hub] Unknown notification method: ${method}`);
  }
}

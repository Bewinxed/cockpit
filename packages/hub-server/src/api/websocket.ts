import { Elysia, t } from 'elysia';
import type { Db } from '@cockpit/db';
import { agents, eq } from '@cockpit/db';
import {
  isRequest,
  isResponse,
  isNotification,
  createResponse,
  createErrorResponse,
  JSON_RPC_ERROR_CODES,
  PROTOCOL_METHODS,
} from '@cockpit/core/protocol';
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from '@cockpit/core/protocol';
import { getAgentRegistry } from '../services/agent-registry';
import { getBroadcastService } from '../services/broadcast';
import { createInstanceTracker } from '../services/instance-tracker';
import { safeJsonParse } from '@cockpit/core/utils';

// Store agent ID by WebSocket for cleanup
const wsToAgentId = new WeakMap<unknown, string>();

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

        // Parse message
        if (typeof rawMessage === 'string') {
          message = safeJsonParse(rawMessage);
        } else if (rawMessage instanceof ArrayBuffer) {
          message = safeJsonParse(new TextDecoder().decode(rawMessage));
        } else {
          message = rawMessage;
        }

        if (!message) {
          ws.send(JSON.stringify(
            createErrorResponse(0, JSON_RPC_ERROR_CODES.PARSE_ERROR, 'Invalid JSON')
          ));
          return;
        }

        // Handle JSON-RPC request
        if (isRequest(message)) {
          const response = await handleRequest(ws, message, db, agentRegistry, broadcast, instanceTracker);
          ws.send(JSON.stringify(response));
          return;
        }

        // Handle JSON-RPC response (from agent to pending hub request)
        if (isResponse(message)) {
          const agentId = wsToAgentId.get(ws);
          if (agentId) {
            agentRegistry.handleResponse(agentId, message);
          }
          return;
        }

        // Handle JSON-RPC notification
        if (isNotification(message)) {
          const agentId = wsToAgentId.get(ws);
          if (agentId) {
            await handleNotification(agentId, message, broadcast, instanceTracker);
          }
          return;
        }

        // Unknown message format
        ws.send(JSON.stringify(
          createErrorResponse(0, JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC message')
        ));
      },

      // WebSocket close handler
      close(ws) {
        const agentId = wsToAgentId.get(ws);
        if (agentId) {
          console.log(`[Hub] Agent disconnected: ${agentId}`);
          agentRegistry.unregister(agentId);

          // Broadcast agent disconnection
          broadcast.broadcast('agent:disconnected', { agentId });
        }
      },

      // WebSocket error handler
      error(ws, error) {
        console.error('[Hub] WebSocket error:', error);
        const agentId = wsToAgentId.get(ws);
        if (agentId) {
          agentRegistry.unregister(agentId);
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
    case PROTOCOL_METHODS.AGENT_REGISTER: {
      // Agent registration
      const { machineId, hostname, tailscaleIp, os, instances: existingInstances } = params as {
        machineId: string;
        hostname: string;
        tailscaleIp: string;
        os: 'windows' | 'darwin' | 'linux';
        instances?: Array<{ id: string; sessionId?: string; cwd: string; status: string }>;
      };

      if (!machineId || !hostname || !tailscaleIp || !os) {
        return createErrorResponse(id, JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'Missing required registration parameters');
      }

      // Register agent in registry
      const agent = agentRegistry.register(ws, { machineId, hostname, tailscaleIp, os });
      wsToAgentId.set(ws, agent.id);

      // Persist agent to database
      await db.insert(agents).values({
        id: agent.id,
        machineId,
        hostname,
        tailscaleIp,
        os,
        status: 'online',
        lastSeen: new Date(),
        createdAt: agent.createdAt,
      }).onConflictDoUpdate({
        target: agents.machineId,
        set: {
          hostname,
          tailscaleIp,
          status: 'online',
          lastSeen: new Date(),
        },
      });

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

    case PROTOCOL_METHODS.AGENT_STATUS: {
      // Agent requesting hub status
      const agentId = wsToAgentId.get(ws);
      if (!agentId) {
        return createErrorResponse(id, JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'Agent not registered');
      }

      const activeInstances = await instanceTracker.getActiveByAgent(agentId);

      return createResponse(id, {
        hubVersion: '1.0.0',
        connectedAgents: agentRegistry.onlineCount,
        yourInstances: activeInstances.length,
      });
    }

    default:
      return createErrorResponse(id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method: ${method}`);
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
    case PROTOCOL_METHODS.AGENT_HEARTBEAT: {
      // Update agent's last ping time
      const agentRegistry = getAgentRegistry();
      agentRegistry.updatePing(agentId);
      break;
    }

    case PROTOCOL_METHODS.INSTANCE_STARTED: {
      const { instanceId, sessionId } = params as { instanceId: string; sessionId?: string };
      const instance = await instanceTracker.markStarted(instanceId, sessionId);
      if (instance) {
        broadcast.broadcast('instance:started', instance);
      }
      break;
    }

    case PROTOCOL_METHODS.INSTANCE_MESSAGE: {
      const { instanceId, messageType, content, timestamp } = params as {
        instanceId: string;
        messageType: string;
        content: unknown;
        timestamp: number;
      };

      // Broadcast message to dashboard
      broadcast.broadcast('instance:message', {
        instanceId,
        messageType,
        content,
        timestamp,
      });
      break;
    }

    case PROTOCOL_METHODS.INSTANCE_STOPPED: {
      const { instanceId } = params as { instanceId: string };
      const instance = await instanceTracker.markStopped(instanceId);
      if (instance) {
        broadcast.broadcast('instance:stopped', { instanceId, instance });
      }
      break;
    }

    case PROTOCOL_METHODS.INSTANCE_ERROR: {
      const { instanceId, error } = params as { instanceId: string; error: string };
      const instance = await instanceTracker.markError(instanceId);
      if (instance) {
        broadcast.broadcast('instance:error', { instanceId, error, instance });
      }
      break;
    }

    case PROTOCOL_METHODS.SDK_MESSAGE: {
      // Generic SDK message passthrough
      const { instanceId, message } = params as { instanceId: string; message: unknown };
      broadcast.broadcast('instance:message', { instanceId, message });
      break;
    }

    default:
      console.log(`[Hub] Unknown notification method: ${method}`);
  }
}

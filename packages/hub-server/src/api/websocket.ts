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

// Map to store agentId by connection ID
// We use a module-level Map since Elysia ws wrappers don't preserve properties between calls
const connectionAgentMap = new Map<string, string>();

// Helper to get unique ID from ws object
function getWsId(ws: unknown): string {
  // Try to get a unique identifier from the ws object
  const wsAny = ws as { id?: string; raw?: { remoteAddress?: string } };
  if (wsAny.id) return wsAny.id;
  // Fallback: use stringified reference (not ideal but works)
  return String(ws);
}

/**
 * WebSocket routes for agent connections
 */
export function createWebsocketRoutes(db: Db) {
  // Note: Don't cache agentRegistry/broadcast here - get fresh reference on each request
  // to avoid stale references after hot reload
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
          try {
            const response = await handleRequest(ws, message, db, instanceTracker);
            ws.send(JSON.stringify(response));
          } catch (error) {
            console.error(`[Hub] Error handling request ${message.method}:`, error);
            ws.send(JSON.stringify(
              createErrorResponse(message.id, JsonRpcErrorCode.INTERNAL_ERROR,
                `Internal error: ${error instanceof Error ? error.message : String(error)}`)
            ));
          }
          return;
        }

        // Handle JSON-RPC response (from agent to pending hub request)
        if (isJsonRpcResponse(message)) {
          getAgentRegistry().handleResponseByRequestId(message);
          return;
        }

        // Handle JSON-RPC notification
        if (isJsonRpcNotification(message)) {
          const wsId = getWsId(ws);
          const agentId = connectionAgentMap.get(wsId);
          if (agentId) {
            await handleNotification(agentId, message, instanceTracker);
          }
          return;
        }

        // Unknown message format
        ws.send(JSON.stringify(
          createErrorResponse('0', JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC message')
        ));
      },

      // WebSocket close handler
      async close(ws) {
        const wsId = getWsId(ws);
        const agentId = connectionAgentMap.get(wsId);
        if (agentId) {
          // Pass ws to unregister - it will skip if this is a stale close event
          // (i.e., agent already reconnected with a new WebSocket)
          const result = getAgentRegistry().unregister(agentId, ws);

          if (!result) {
            // Stale close event - agent already reconnected, just clean up our map
            connectionAgentMap.delete(wsId);
            return;
          }

          console.log(`[Hub] Agent reconnecting: ${agentId}`);

          // Update agent status in database to reconnecting
          await db.update(agents)
            .set({ status: 'reconnecting', lastSeen: new Date() })
            .where(eq(agents.id, agentId));

          connectionAgentMap.delete(wsId);

          // Broadcast agent is reconnecting - UI shows "reconnecting" state
          // Don't mark instances as stopped yet - agent may reconnect quickly
          getBroadcastService().broadcast('agent:reconnecting', { agentId });
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
      // First try by machineId (stable identifier)
      let existingDbAgent = await db
        .select()
        .from(agents)
        .where(eq(agents.machineId, machineId))
        .limit(1);

      // Fallback: try by hostname for old records that don't have machineId
      // This handles backwards compatibility during hot reloads in development
      if (existingDbAgent.length === 0) {
        existingDbAgent = await db
          .select()
          .from(agents)
          .where(eq(agents.hostname, hostname))
          .limit(1);
      }

      let agentId: string;
      const now = new Date();

      if (existingDbAgent.length > 0) {
        // Reuse existing database ID to maintain foreign key consistency
        agentId = existingDbAgent[0].id;

        // Update existing record - always set machineId to ensure it's populated
        await db.update(agents)
          .set({
            machineId, // Ensure machineId is set (fixes old records)
            hostname,
            tailscaleIp,
            status: 'online',
            lastSeen: now,
          })
          .where(eq(agents.id, agentId));
      } else {
        // Register new agent in registry (will generate new ID)
        const newAgent = getAgentRegistry().register(ws, { machineId, hostname, tailscaleIp, os });
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
      const agent = getAgentRegistry().registerWithId(ws, agentId, { machineId, hostname, tailscaleIp, os });
      const wsId = getWsId(ws);
      connectionAgentMap.set(wsId, agentId);

      // Reconcile instances: sync agent's actual state with DB
      // This handles agent restarts where instances are lost from memory
      const agentInstanceIds = new Set(
        (existingInstances || []).map((inst: { id: string }) => inst.id)
      );

      // Get all instances in DB that are marked as running for this machine
      const dbRunningInstances = await instanceTracker.getActiveByMachineId(machineId);

      let orphanedCount = 0;
      for (const dbInstance of dbRunningInstances) {
        if (!agentInstanceIds.has(dbInstance.id)) {
          // Instance is in DB as running but agent doesn't have it
          // Mark as sleeping (can be resumed with sdkSessionId)
          await instanceTracker.markSleeping(dbInstance.id);
          getBroadcastService().broadcast('instance:sleeping', {
            instanceId: dbInstance.id,
            reason: 'agent_reconnect_reconciliation'
          });
          orphanedCount++;
        }
      }

      // Update instances that agent reports
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

      if (orphanedCount > 0) {
        console.log(`[Hub] Reconciled ${orphanedCount} orphaned instances for agent ${hostname} (marked as sleeping)`);
      }
      console.log(`[Hub] Agent registered: ${agent.id} (${hostname}), ${agentInstanceIds.size} running instances`);

      // Backfill machineId for any instances that don't have it set
      // This handles instances created before machineId was added
      await instanceTracker.backfillMachineId(agentId, machineId);

      // Broadcast agent connection
      getBroadcastService().broadcast('agent:connected', {
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
      const wsId = getWsId(ws);
      const agentId = connectionAgentMap.get(wsId);
      if (!agentId) {
        return createErrorResponse(id, JsonRpcErrorCode.INVALID_REQUEST, 'Agent not registered');
      }

      const activeInstances = await instanceTracker.getActiveByAgent(agentId);

      return createResponse(id, {
        hubVersion: '1.0.0',
        connectedAgents: getAgentRegistry().onlineCount,
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
  instanceTracker: ReturnType<typeof createInstanceTracker>
): Promise<void> {
  const { method, params } = notification;

  switch (method) {
    case EventMethod.AGENT_HEARTBEAT: {
      // Update agent's last ping time
      getAgentRegistry().updatePing(agentId);
      break;
    }

    case EventMethod.INSTANCE_CREATED: {
      const { instance } = params as { instance: { id: string; sessionId?: string } };
      const updated = await instanceTracker.markStarted(instance.id, instance.sessionId);
      if (updated) {
        getBroadcastService().broadcast('instance:started', updated);
      }
      break;
    }

    // Handle 'instance.started' from agent (different from INSTANCE_CREATED)
    case 'instance.started': {
      const { instanceId, sessionId } = params as { instanceId: string; sessionId?: string };
      // Note: sessionId here is the agent's internal tracking ID
      // The SDK's session_id (for resume) is stored separately as sdkSessionId
      const updated = await instanceTracker.markStarted(instanceId, sessionId);
      if (updated) {
        getBroadcastService().broadcast('instance:started', updated);
      }
      break;
    }

    case EventMethod.INSTANCE_STOPPED: {
      const { instanceId } = params as { instanceId: string };
      const instance = await instanceTracker.markStopped(instanceId);
      if (instance) {
        getBroadcastService().broadcast('instance:stopped', { instanceId, instance });
      }
      break;
    }

    case EventMethod.INSTANCE_SLEEPING: {
      const { instanceId, sdkSessionId } = params as { instanceId: string; sdkSessionId?: string };
      // Update instance with sleeping status
      const instance = await instanceTracker.markSleeping(instanceId);
      if (instance) {
        // Also update SDK session ID if provided (for resume)
        if (sdkSessionId) {
          await instanceTracker.update(instanceId, { sdkSessionId });
        }
        getBroadcastService().broadcast('instance:sleeping', { instanceId, instance, sdkSessionId });
      }
      break;
    }

    case EventMethod.INSTANCE_STATUS_CHANGED: {
      const { instanceId, newStatus } = params as { instanceId: string; newStatus: string };
      if (newStatus === 'error') {
        const instance = await instanceTracker.markError(instanceId);
        if (instance) {
          getBroadcastService().broadcast('instance:error', { instanceId, instance });
        }
      }
      break;
    }

    // Handle SDK messages from agent
    case 'sdk.message': {
      const { instanceId, message } = params as { instanceId: string; message: unknown };
      const msg = message as { type?: string; session_id?: string; usage?: { input_tokens?: number; output_tokens?: number }; total_cost_usd?: number };

      // Capture and persist SDK session ID (used for resume)
      if (msg.session_id) {
        try {
          await instanceTracker.update(instanceId, {
            sdkSessionId: msg.session_id,
          });
        } catch (err) {
          console.error('[Hub] Failed to update SDK session ID:', err);
        }
      }

      // Persist message to database
      try {
        await instanceTracker.saveMessage(instanceId, {
          messageType: msg.type || 'unknown',
          content: message,
          timestamp: new Date(),
        });
      } catch (err) {
        console.error('[Hub] Failed to save SDK message:', err);
      }

      // Extract token usage from result messages
      if (msg.type === 'result' && msg.usage) {
        const costDelta = msg.total_cost_usd || 0;

        if (costDelta > 0) {
          await instanceTracker.incrementCost(instanceId, costDelta);
        }

        // Broadcast token usage update
        getBroadcastService().broadcast('instance:token_usage', {
          instanceId,
          inputTokens: msg.usage.input_tokens || 0,
          outputTokens: msg.usage.output_tokens || 0,
          costDelta,
        });
      }

      // Forward SDK messages to dashboard
      getBroadcastService().broadcast('sdk:message', { instanceId, message });
      break;
    }

    // Handle instance errors
    case 'instance.error': {
      const { instanceId, error: errorMsg } = params as { instanceId: string; error: string };
      const instance = await instanceTracker.markError(instanceId);
      if (instance) {
        getBroadcastService().broadcast('instance:error', { instanceId, instance, error: errorMsg });
      }
      break;
    }

    // Handle permission requests from agent
    case 'permission.request': {
      const {
        requestId,
        instanceId,
        toolName,
        toolInput,
        toolUseID,
        decisionReason,
        blockedPath,
        agentID: subAgentID,
        suggestions,
        createdAt,
      } = params as {
        requestId: string;
        instanceId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        toolUseID: string;
        decisionReason?: string;
        blockedPath?: string;
        agentID?: string;
        suggestions?: unknown[];
        createdAt: number;
      };

      // Broadcast permission request to dashboard clients
      getBroadcastService().broadcast('permission:request', {
        requestId,
        instanceId,
        agentId,
        toolName,
        toolInput,
        toolUseID,
        decisionReason,
        blockedPath,
        subAgentID,
        suggestions,
        createdAt,
      });
      break;
    }

    default:
      // Don't log unknown methods - they're handled elsewhere or expected
      break;
  }
}

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

// Map to store machineId by WebSocket connection ID
// We use a module-level Map since Elysia ws wrappers don't preserve properties between calls
const connectionMachineMap = new Map<string, string>();

// Helper to get unique ID from ws object
function getWsId(ws: unknown): string {
  // Try to get a unique identifier from the ws object
  const wsAny = ws as { id?: string; raw?: { remoteAddress?: string } };
  if (wsAny.id) return wsAny.id;
  // Fallback: use stringified reference (not ideal but works)
  return String(ws);
}

/**
 * WebSocket routes for machine connections
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
        // Machine will send registration message
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

        // Handle JSON-RPC response (from machine to pending hub request)
        if (isJsonRpcResponse(message)) {
          getAgentRegistry().handleResponseByRequestId(message);
          return;
        }

        // Handle JSON-RPC notification
        if (isJsonRpcNotification(message)) {
          const wsId = getWsId(ws);
          const machineId = connectionMachineMap.get(wsId);
          if (machineId) {
            await handleNotification(machineId, message, instanceTracker);
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
        const machineId = connectionMachineMap.get(wsId);
        if (machineId) {
          // Pass ws to unregister - it will skip if this is a stale close event
          // (i.e., machine already reconnected with a new WebSocket)
          const result = getAgentRegistry().unregister(machineId, ws);

          if (!result) {
            // Stale close event - machine already reconnected, just clean up our map
            connectionMachineMap.delete(wsId);
            return;
          }

          console.log(`[Hub] Machine reconnecting: ${machineId}`);

          // Update machine status in database to reconnecting
          await db.update(agents)
            .set({ status: 'reconnecting', lastSeen: new Date() })
            .where(eq(agents.machineId, machineId));

          connectionMachineMap.delete(wsId);

          // Broadcast machine is reconnecting - UI shows "reconnecting" state
          // Don't mark instances as stopped yet - machine may reconnect quickly
          getBroadcastService().broadcast('agent:reconnecting', { machineId });
        }
      },
    });
}

/**
 * Handle incoming JSON-RPC requests from machines
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
      // Machine registration - machineId is the primary identifier
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

      const now = new Date();

      // Check if this machine already exists in the database (by machineId - primary key)
      const existingDbAgent = await db
        .select()
        .from(agents)
        .where(eq(agents.machineId, machineId))
        .limit(1);

      if (existingDbAgent.length > 0) {
        // Update existing machine record
        await db.update(agents)
          .set({
            hostname,
            tailscaleIp,
            status: 'online',
            lastSeen: now,
          })
          .where(eq(agents.machineId, machineId));
      } else {
        // Insert new machine record - machineId is the primary key
        await db.insert(agents).values({
          machineId,
          hostname,
          tailscaleIp,
          os,
          status: 'online',
          lastSeen: now,
          createdAt: now,
        });
      }

      // Register machine in memory registry
      const agent = getAgentRegistry().register(ws, { machineId, hostname, tailscaleIp, os });
      const wsId = getWsId(ws);
      connectionMachineMap.set(wsId, machineId);

      // Reconcile instances: sync machine's actual state with DB
      // This handles machine restarts where instances are lost from memory
      const machineInstanceIds = new Set(
        (existingInstances || []).map((inst: { id: string }) => inst.id)
      );

      // Get all instances in DB that are marked as running for this machine
      const dbRunningInstances = await instanceTracker.getActiveByMachineId(machineId);

      let orphanedCount = 0;
      for (const dbInstance of dbRunningInstances) {
        if (!machineInstanceIds.has(dbInstance.id)) {
          // Instance is in DB as running but machine doesn't have it
          // Mark as sleeping (can be resumed with sdkSessionId)
          await instanceTracker.markSleeping(dbInstance.id);
          getBroadcastService().broadcast('instance:sleeping', {
            instanceId: dbInstance.id,
            reason: 'agent_reconnect_reconciliation'
          });
          orphanedCount++;
        }
      }

      // Update instances that machine reports
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
        console.log(`[Hub] Reconciled ${orphanedCount} orphaned instances for machine ${hostname} (marked as sleeping)`);
      }
      console.log(`[Hub] Machine registered: ${machineId} (${hostname}), ${machineInstanceIds.size} running instances`);

      // Broadcast machine connection
      getBroadcastService().broadcast('agent:connected', {
        machineId,
        hostname,
        tailscaleIp,
        os,
      });

      return createResponse(id, {
        machineId,
        registered: true,
      });
    }

    case CommandMethod.AGENT_STATUS: {
      // Machine requesting hub status
      const wsId = getWsId(ws);
      const machineId = connectionMachineMap.get(wsId);
      if (!machineId) {
        return createErrorResponse(id, JsonRpcErrorCode.INVALID_REQUEST, 'Machine not registered');
      }

      const activeInstances = await instanceTracker.getActiveByMachineId(machineId);

      return createResponse(id, {
        hubVersion: '1.0.0',
        connectedMachines: getAgentRegistry().onlineCount,
        yourInstances: activeInstances.length,
      });
    }

    default:
      return createErrorResponse(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

/**
 * Handle incoming JSON-RPC notifications from machines
 */
async function handleNotification(
  machineId: string,
  notification: JsonRpcNotification,
  instanceTracker: ReturnType<typeof createInstanceTracker>
): Promise<void> {
  const { method, params } = notification;

  switch (method) {
    case EventMethod.AGENT_HEARTBEAT: {
      // Update machine's last ping time
      getAgentRegistry().updatePing(machineId);
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

    // Handle 'instance.started' from machine (different from INSTANCE_CREATED)
    case 'instance.started': {
      const { instanceId, sessionId } = params as { instanceId: string; sessionId?: string };
      // Note: sessionId here is the machine's internal tracking ID
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

    // Handle SDK messages from machine
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

    // Handle permission requests from machine
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
        machineId,
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

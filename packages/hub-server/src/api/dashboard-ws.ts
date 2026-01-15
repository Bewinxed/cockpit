/**
 * Dashboard WebSocket Handler
 *
 * WebSocket endpoint for dashboard clients using river.ts format.
 * Wire format: { type: string, data: T, id?: string }
 *
 * This is separate from agent WebSocket (/ws/hub) which uses JSON-RPC 2.0.
 * Dashboard WebSocket will eventually replace SSE for real-time events.
 */

import { Elysia } from 'elysia';
import type { Db } from '@cockpit/db';
import type {
  SpawnInstanceRequest,
  SendMessageRequest,
  StopInstanceRequest,
  PermissionResponseRequest,
  QuestionResponseRequest,
  DashboardEventType,
  DashboardEventMap,
} from '@cockpit/core/dashboard';
import type { PermissionMode } from '@cockpit/core';
import { getAgentRegistry, getDashboardRegistry, createInstanceTracker } from '../services';

/**
 * Broadcast an event to all connected dashboard clients.
 * Uses river.ts format: { type, data }
 *
 * Re-export from DashboardRegistry for convenience.
 */
export function broadcastToDashboards<K extends DashboardEventType>(
  type: K,
  data: DashboardEventMap[K]
): number {
  return getDashboardRegistry().broadcast(type, data);
}

/**
 * Get count of connected dashboard clients
 */
export function getDashboardClientCount(): number {
  return getDashboardRegistry().size;
}

/**
 * Check if any dashboard clients are connected
 */
export function hasDashboardClients(): boolean {
  return getDashboardRegistry().hasClients;
}

/**
 * Send a response to a specific request (for RPC-style commands)
 * Uses river.ts format: { type, data, id }
 */
function sendResponse(
  ws: unknown,
  type: string,
  data: unknown,
  id: string
): void {
  getDashboardRegistry().sendRawToWs(ws, JSON.stringify({ type, data, id }));
}

/**
 * Create dashboard WebSocket routes
 */
export function createDashboardWsRoutes(db: Db) {
  const instanceTracker = createInstanceTracker(db);
  const registry = getDashboardRegistry();

  return new Elysia({ prefix: '/ws' })
    .ws('/dashboard', {
      // Connection opened
      open(ws) {
        // Register client in registry
        const client = registry.register(ws);

        console.log(`[Dashboard WS] Client connected: ${client.id} (total: ${registry.size})`);

        // Send connection confirmation
        registry.sendToClient(client.id, 'connected', { clientId: client.id });
      },

      // Message received
      async message(ws, rawMessage) {
        // Find client by Elysia's ws.id
        const wsId = (ws as { id?: string }).id;
        const client = wsId ? registry.getByWsId(wsId) : undefined;
        if (!client) {
          console.warn('[Dashboard WS] Message from unknown client, wsId:', wsId);
          return;
        }

        // Parse message - Elysia/Bun may already parse JSON for us
        let parsed: { type?: string; data?: unknown; id?: string } | null = null;
        try {
          if (typeof rawMessage === 'object' && rawMessage !== null) {
            // Already parsed by Elysia/Bun
            parsed = rawMessage as { type?: string; data?: unknown; id?: string };
          } else if (typeof rawMessage === 'string') {
            parsed = JSON.parse(rawMessage);
          } else if (rawMessage instanceof ArrayBuffer) {
            parsed = JSON.parse(new TextDecoder().decode(rawMessage));
          } else if (Buffer.isBuffer(rawMessage)) {
            parsed = JSON.parse(rawMessage.toString('utf-8'));
          }
        } catch (e) {
          console.warn('[Dashboard WS] Invalid JSON message:', e);
          return;
        }

        if (!parsed || !parsed.type) {
          console.warn('[Dashboard WS] Message missing type field:', JSON.stringify(parsed));
          return;
        }

        const { type, data, id } = parsed;

        // Handle commands (requests with id expecting response)
        if (id) {
          try {
            const result = await handleCommand(type, data, db, instanceTracker);
            sendResponse(ws, type, result, id);
          } catch (error) {
            sendResponse(ws, type, {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, id);
          }
          return;
        }

        // Handle fire-and-forget events (no id, no response)
        // Currently dashboard only sends commands, not events
        console.log(`[Dashboard WS] Received event: ${type}`);
      },

      // Connection closed
      close(ws) {
        const client = registry.unregisterByWs(ws);
        if (client) {
          console.log(`[Dashboard WS] Client disconnected: ${client.id} (remaining: ${registry.size})`);
        }
      },
    });
}

/**
 * Handle dashboard commands (RPC-style requests)
 */
async function handleCommand(
  type: string,
  data: unknown,
  db: Db,
  instanceTracker: ReturnType<typeof createInstanceTracker>
): Promise<unknown> {
  switch (type) {
    case 'instance.spawn': {
      const req = data as SpawnInstanceRequest;
      const { machineId, cwd, model, projectId, permissionMode, resumeSessionId } = req;

      // Get agent for this machine
      const agent = getAgentRegistry().get(machineId);
      if (!agent || !agent.ws) {
        throw new Error(`Agent ${machineId} not connected`);
      }

      // Create instance in database (tracker generates the id)
      const instance = await instanceTracker.create({
        machineId,
        cwd,
        model: model ?? undefined,
        projectId: projectId ?? undefined,
        permissionMode: (permissionMode as PermissionMode) ?? undefined,
      });
      const instanceId = instance.id;

      // Broadcast instance created
      getDashboardRegistry().broadcast('instance:created', instance);

      // Send spawn command to agent (using existing JSON-RPC protocol for now)
      // TODO: Migrate agent protocol to river.ts format in future epic
      const response = await getAgentRegistry().sendToMachine(machineId, 'instance.spawn', {
        instanceId,
        cwd,
        model,
        permissionMode,
        resumeSessionId,
      });

      if ('error' in response && response.error) {
        // Mark instance as error if spawn fails
        await instanceTracker.markError(instanceId);
        throw new Error(response.error.message);
      }

      return { instanceId, status: 'created' };
    }

    case 'instance.send': {
      const req = data as SendMessageRequest;
      const { instanceId, message } = req;

      // Get instance to find machine
      const instance = await instanceTracker.get(instanceId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      // Send message to agent
      const response = await getAgentRegistry().sendToMachine(instance.machineId, 'instance.send', {
        instanceId,
        message,
      });

      if ('error' in response && response.error) {
        throw new Error(response.error.message);
      }

      return { success: true };
    }

    case 'instance.stop': {
      const req = data as StopInstanceRequest;
      const { instanceId } = req;

      // Get instance to find machine
      const instance = await instanceTracker.get(instanceId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      // Send stop command to agent
      const response = await getAgentRegistry().sendToMachine(instance.machineId, 'instance.stop', {
        instanceId,
      });

      if ('error' in response && response.error) {
        throw new Error(response.error.message);
      }

      return { success: true };
    }

    case 'permission.response': {
      const req = data as PermissionResponseRequest;
      const { requestId, instanceId, behavior, updatedInput, updatedPermissions, message: denyMessage, interrupt } = req;

      // Get instance to find machine
      const instance = await instanceTracker.get(instanceId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      // Send permission response to agent as notification (fire-and-forget)
      // The agent handles this in handleNotification, not handleRequest
      const sent = getAgentRegistry().notifyMachine(instance.machineId, 'permission.response', {
        requestId,
        instanceId,
        behavior,
        updatedInput,
        updatedPermissions,
        message: denyMessage,
        interrupt,
      });

      if (!sent) {
        throw new Error(`Failed to send permission response to agent ${instance.machineId}`);
      }

      return { success: true };
    }

    case 'question.response': {
      const req = data as QuestionResponseRequest;
      const { requestId, instanceId, answers } = req;

      // Get instance to find machine
      const instance = await instanceTracker.get(instanceId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      // Send question response to agent as notification (fire-and-forget)
      // The agent handles this in handleNotification, not handleRequest
      const sent = getAgentRegistry().notifyMachine(instance.machineId, 'question.response', {
        requestId,
        instanceId,
        answers,
      });

      if (!sent) {
        throw new Error(`Failed to send question response to agent ${instance.machineId}`);
      }

      return { success: true };
    }

    default:
      throw new Error(`Unknown command: ${type}`);
  }
}

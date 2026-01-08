import { Elysia, t } from 'elysia';
import type { Db } from '@cockpit/db';
import type { Agent } from '@cockpit/core';
import { CommandMethod, type FilesystemListResult, type ClaudeVersionResult, type JsonRpcError } from '@cockpit/core/protocol';
import { agents, eq, desc } from '@cockpit/db';
import { getAgentRegistry } from '../services/agent-registry';
import { createInstanceTracker } from '../services/instance-tracker';

/**
 * Safely extract error message from JsonRpcError or any error object
 */
function getErrorMessage(error: JsonRpcError | unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') return err.message;
    if (typeof err.error === 'string') return err.error;
  }
  return String(error);
}

/**
 * Machine (Agent) management routes.
 * Routes use machineId as the primary identifier.
 */
export function createAgentRoutes(db: Db) {
  // Note: Don't cache agentRegistry here - get fresh reference on each request
  // to avoid stale references after hot reload
  const instanceTracker = createInstanceTracker(db);

  return new Elysia({ prefix: '/agents' })
    // List all machines (from both registry and database)
    .get(
      '/',
      async ({ query }) => {
        // Get machines from registry (connected with live status)
        const connectedMachines = getAgentRegistry().getAll();
        const connectedMachineIds = new Set(connectedMachines.map((a) => a.machineId));

        // Get machines from database
        let dbQuery = db.select().from(agents).$dynamic();

        if (query.status === 'online') {
          // Only return online machines from registry
          return {
            success: true,
            data: connectedMachines.map(connectedMachineToResponse),
            total: connectedMachines.length,
          };
        }

        dbQuery = dbQuery.orderBy(desc(agents.lastSeen));

        if (query.limit) {
          dbQuery = dbQuery.limit(parseInt(query.limit));
        }

        const dbMachines = await dbQuery;

        // Merge database machines with live status from registry
        const machinesWithStatus = dbMachines.map((dbMachine) => {
          const connected = connectedMachines.find((a) => a.machineId === dbMachine.machineId);
          return {
            ...dbMachineToResponse(dbMachine),
            status: connected ? 'online' as const : 'offline' as const,
            connectedAt: connected?.connectedAt,
            lastPing: connected?.lastPing,
          };
        });

        // Add any connected machines not in database (newly connected)
        for (const connected of connectedMachines) {
          if (!machinesWithStatus.find((a) => a.machineId === connected.machineId)) {
            machinesWithStatus.unshift(connectedMachineToResponse(connected));
          }
        }

        return {
          success: true,
          data: machinesWithStatus,
          total: machinesWithStatus.length,
          online: connectedMachines.length,
        };
      },
      {
        query: t.Object({
          status: t.Optional(t.Union([t.Literal('online'), t.Literal('offline')])),
          limit: t.Optional(t.String()),
        }),
      }
    )

    // Get machine by machineId
    .get(
      '/:machineId',
      async ({ params, set }) => {
        // First check registry for connected machine
        const connected = getAgentRegistry().get(params.machineId);

        if (connected) {
          // Get instance count
          const instances = await instanceTracker.getActiveByMachineId(params.machineId);

          return {
            success: true,
            data: {
              ...connectedMachineToResponse(connected),
              activeInstances: instances.length,
            },
          };
        }

        // Fall back to database
        const result = await db
          .select()
          .from(agents)
          .where(eq(agents.machineId, params.machineId))
          .limit(1);

        if (result.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Machine not found',
          };
        }

        const instances = await instanceTracker.getActiveByMachineId(params.machineId);

        return {
          success: true,
          data: {
            ...dbMachineToResponse(result[0]),
            status: 'offline' as const,
            activeInstances: instances.length,
          },
        };
      },
      {
        params: t.Object({
          machineId: t.String(),
        }),
      }
    )

    // Get machine's instances
    .get(
      '/:machineId/instances',
      async ({ params, query, set }) => {
        // Check if machine exists
        const connected = getAgentRegistry().get(params.machineId);
        const dbMachine = await db
          .select()
          .from(agents)
          .where(eq(agents.machineId, params.machineId))
          .limit(1);

        if (!connected && dbMachine.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Machine not found',
          };
        }

        const instances = await instanceTracker.list({
          machineId: params.machineId,
          status: query.status as any,
          limit: query.limit ? parseInt(query.limit) : undefined,
        });

        return {
          success: true,
          data: instances,
          total: instances.length,
        };
      },
      {
        params: t.Object({
          machineId: t.String(),
        }),
        query: t.Object({
          status: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      }
    )

    // Get machine statistics
    .get(
      '/:machineId/stats',
      async ({ params, set }) => {
        // Check if machine exists
        const connected = getAgentRegistry().get(params.machineId);
        const dbMachine = await db
          .select()
          .from(agents)
          .where(eq(agents.machineId, params.machineId))
          .limit(1);

        if (!connected && dbMachine.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Machine not found',
          };
        }

        const [totalInstances, activeInstances, totalCost] = await Promise.all([
          instanceTracker.count({ machineId: params.machineId }),
          instanceTracker.count({ machineId: params.machineId, status: ['starting', 'running'] }),
          instanceTracker.getTotalCostByMachineId(params.machineId),
        ]);

        return {
          success: true,
          data: {
            totalInstances,
            activeInstances,
            totalCostUsd: totalCost,
          },
        };
      },
      {
        params: t.Object({
          machineId: t.String(),
        }),
      }
    )

    // Get machine status (live from registry)
    .get(
      '/:machineId/status',
      async ({ params, set }) => {
        const connected = getAgentRegistry().get(params.machineId);

        if (!connected) {
          // Check database
          const dbMachine = await db
            .select()
            .from(agents)
            .where(eq(agents.machineId, params.machineId))
            .limit(1);

          if (dbMachine.length === 0) {
            set.status = 404;
            return {
              success: false,
              error: 'Machine not found',
            };
          }

          return {
            success: true,
            data: {
              status: 'offline',
              lastSeen: dbMachine[0].lastSeen,
            },
          };
        }

        return {
          success: true,
          data: {
            status: 'online',
            connectedAt: connected.connectedAt,
            lastPing: connected.lastPing,
            pendingRequests: connected.pendingRequests.size,
          },
        };
      },
      {
        params: t.Object({
          machineId: t.String(),
        }),
      }
    )

    // List filesystem directory on machine
    .get(
      '/:machineId/filesystem',
      async ({ params, query, set }) => {
        const connected = getAgentRegistry().get(params.machineId);

        if (!connected || connected.status !== 'online') {
          set.status = 404;
          return {
            success: false,
            error: 'Machine not found or offline',
          };
        }

        // Forward request to machine
        const response = await getAgentRegistry().sendToMachine(
          params.machineId,
          CommandMethod.FILESYSTEM_LIST,
          { path: query.path }
        );

        if (response.error) {
          set.status = 400;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        return {
          success: true,
          data: response.result as FilesystemListResult,
        };
      },
      {
        params: t.Object({
          machineId: t.String(),
        }),
        query: t.Object({
          path: t.Optional(t.String()),
        }),
      }
    )

    // Get Claude CLI version from machine
    .get(
      '/:machineId/claude-version',
      async ({ params, set }) => {
        const connected = getAgentRegistry().get(params.machineId);

        if (!connected || connected.status !== 'online') {
          set.status = 404;
          return {
            success: false,
            error: 'Machine not found or offline',
          };
        }

        // Forward request to machine
        const response = await getAgentRegistry().sendToMachine(
          params.machineId,
          CommandMethod.CLAUDE_VERSION,
          {}
        );

        if (response.error) {
          set.status = 400;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        return {
          success: true,
          data: response.result as ClaudeVersionResult,
        };
      },
      {
        params: t.Object({
          machineId: t.String(),
        }),
      }
    );
}

/**
 * Convert connected machine to API response
 */
function connectedMachineToResponse(machine: ReturnType<ReturnType<typeof getAgentRegistry>['getAll']>[0]) {
  return {
    machineId: machine.machineId,
    hostname: machine.hostname,
    tailscaleIp: machine.tailscaleIp,
    os: machine.os,
    status: 'online' as const,
    lastSeen: machine.lastSeen,
    createdAt: machine.createdAt,
    connectedAt: machine.connectedAt,
    lastPing: machine.lastPing,
  };
}

/**
 * Convert database machine to API response
 */
function dbMachineToResponse(machine: typeof agents.$inferSelect) {
  return {
    machineId: machine.machineId,
    hostname: machine.hostname,
    tailscaleIp: machine.tailscaleIp,
    os: machine.os,
    status: machine.status as 'online' | 'offline' | 'reconnecting',
    lastSeen: machine.lastSeen,
    createdAt: machine.createdAt,
  };
}

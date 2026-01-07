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
 * Agent management routes
 */
export function createAgentRoutes(db: Db) {
  const agentRegistry = getAgentRegistry();
  const instanceTracker = createInstanceTracker(db);

  return new Elysia({ prefix: '/agents' })
    // List all agents (from both registry and database)
    .get(
      '/',
      async ({ query }) => {
        // Get agents from registry (connected agents with live status)
        const connectedAgents = agentRegistry.getAll();
        const connectedAgentIds = new Set(connectedAgents.map((a) => a.id));

        // Get agents from database
        let dbQuery = db.select().from(agents).$dynamic();

        if (query.status === 'online') {
          // Only return online agents from registry
          return {
            success: true,
            data: connectedAgents.map(connectedAgentToResponse),
            total: connectedAgents.length,
          };
        }

        dbQuery = dbQuery.orderBy(desc(agents.lastSeen));

        if (query.limit) {
          dbQuery = dbQuery.limit(parseInt(query.limit));
        }

        const dbAgents = await dbQuery;

        // Merge database agents with live status from registry
        const agentsWithStatus = dbAgents.map((dbAgent) => {
          const connected = connectedAgents.find((a) => a.id === dbAgent.id);
          return {
            ...dbAgentToResponse(dbAgent),
            status: connected ? 'online' as const : 'offline' as const,
            connectedAt: connected?.connectedAt,
            lastPing: connected?.lastPing,
          };
        });

        // Add any connected agents not in database (newly connected)
        for (const connected of connectedAgents) {
          if (!agentsWithStatus.find((a) => a.id === connected.id)) {
            agentsWithStatus.unshift(connectedAgentToResponse(connected));
          }
        }

        return {
          success: true,
          data: agentsWithStatus,
          total: agentsWithStatus.length,
          online: connectedAgents.length,
        };
      },
      {
        query: t.Object({
          status: t.Optional(t.Union([t.Literal('online'), t.Literal('offline')])),
          limit: t.Optional(t.String()),
        }),
      }
    )

    // Get agent by ID
    .get(
      '/:id',
      async ({ params, set }) => {
        // First check registry for connected agent
        const connected = agentRegistry.get(params.id);

        if (connected) {
          // Get instance count
          const instances = await instanceTracker.getActiveByAgent(params.id);

          return {
            success: true,
            data: {
              ...connectedAgentToResponse(connected),
              activeInstances: instances.length,
            },
          };
        }

        // Fall back to database
        const result = await db
          .select()
          .from(agents)
          .where(eq(agents.id, params.id))
          .limit(1);

        if (result.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Agent not found',
          };
        }

        const instances = await instanceTracker.getActiveByAgent(params.id);

        return {
          success: true,
          data: {
            ...dbAgentToResponse(result[0]),
            status: 'offline' as const,
            activeInstances: instances.length,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Get agent's instances
    .get(
      '/:id/instances',
      async ({ params, query, set }) => {
        // Check if agent exists
        const connected = agentRegistry.get(params.id);
        const dbAgent = await db
          .select()
          .from(agents)
          .where(eq(agents.id, params.id))
          .limit(1);

        if (!connected && dbAgent.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Agent not found',
          };
        }

        const instances = await instanceTracker.list({
          agentId: params.id,
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
          id: t.String(),
        }),
        query: t.Object({
          status: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      }
    )

    // Get agent statistics
    .get(
      '/:id/stats',
      async ({ params, set }) => {
        // Check if agent exists
        const connected = agentRegistry.get(params.id);
        const dbAgent = await db
          .select()
          .from(agents)
          .where(eq(agents.id, params.id))
          .limit(1);

        if (!connected && dbAgent.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Agent not found',
          };
        }

        const [totalInstances, activeInstances, totalCost] = await Promise.all([
          instanceTracker.count({ agentId: params.id }),
          instanceTracker.count({ agentId: params.id, status: ['starting', 'running'] }),
          instanceTracker.getTotalCostByAgent(params.id),
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
          id: t.String(),
        }),
      }
    )

    // Get agent status (live from registry)
    .get(
      '/:id/status',
      async ({ params, set }) => {
        const connected = agentRegistry.get(params.id);

        if (!connected) {
          // Check database
          const dbAgent = await db
            .select()
            .from(agents)
            .where(eq(agents.id, params.id))
            .limit(1);

          if (dbAgent.length === 0) {
            set.status = 404;
            return {
              success: false,
              error: 'Agent not found',
            };
          }

          return {
            success: true,
            data: {
              status: 'offline',
              lastSeen: dbAgent[0].lastSeen,
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
          id: t.String(),
        }),
      }
    )

    // List filesystem directory on agent
    .get(
      '/:id/filesystem',
      async ({ params, query, set }) => {
        const connected = agentRegistry.get(params.id);

        if (!connected || connected.status !== 'online') {
          set.status = 404;
          return {
            success: false,
            error: 'Agent not found or offline',
          };
        }

        // Forward request to agent
        const response = await agentRegistry.sendToAgent(
          params.id,
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
          id: t.String(),
        }),
        query: t.Object({
          path: t.Optional(t.String()),
        }),
      }
    )

    // Get Claude CLI version from agent
    .get(
      '/:id/claude-version',
      async ({ params, set }) => {
        const connected = agentRegistry.get(params.id);

        if (!connected || connected.status !== 'online') {
          set.status = 404;
          return {
            success: false,
            error: 'Agent not found or offline',
          };
        }

        // Forward request to agent
        const response = await agentRegistry.sendToAgent(
          params.id,
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
          id: t.String(),
        }),
      }
    );
}

/**
 * Convert connected agent to API response
 */
function connectedAgentToResponse(agent: ReturnType<ReturnType<typeof getAgentRegistry>['getAll']>[0]) {
  return {
    id: agent.id,
    machineId: agent.machineId,
    hostname: agent.hostname,
    tailscaleIp: agent.tailscaleIp,
    os: agent.os,
    status: 'online' as const,
    lastSeen: agent.lastSeen,
    createdAt: agent.createdAt,
    connectedAt: agent.connectedAt,
    lastPing: agent.lastPing,
  };
}

/**
 * Convert database agent to API response
 */
function dbAgentToResponse(agent: typeof agents.$inferSelect) {
  return {
    id: agent.id,
    machineId: agent.machineId,
    hostname: agent.hostname,
    tailscaleIp: agent.tailscaleIp,
    os: agent.os,
    status: agent.status as 'online' | 'offline',
    lastSeen: agent.lastSeen,
    createdAt: agent.createdAt,
  };
}

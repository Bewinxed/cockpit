import { Elysia, t } from 'elysia';
import type { Db } from '@cockpit/db';
import type { SpawnInstanceData } from '@cockpit/core';
import type { JsonRpcError } from '@cockpit/core/protocol';
import { CommandMethod } from '@cockpit/core/protocol';
import { createInstanceTracker } from '../services/instance-tracker';
import { getAgentRegistry } from '../services/agent-registry';
import { getBroadcastService } from '../services/broadcast';

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
 * Instance CRUD routes
 */
export function createInstanceRoutes(db: Db) {
  const tracker = createInstanceTracker(db);
  const agentRegistry = getAgentRegistry();
  const broadcast = getBroadcastService();

  return new Elysia({ prefix: '/instances' })
    // List all instances
    .get(
      '/',
      async ({ query }) => {
        const instances = await tracker.list({
          agentId: query.agentId,
          projectId: query.projectId,
          status: query.status as any,
          limit: query.limit ? parseInt(query.limit) : undefined,
          offset: query.offset ? parseInt(query.offset) : undefined,
        });

        return {
          success: true,
          data: instances,
          total: instances.length,
        };
      },
      {
        query: t.Object({
          agentId: t.Optional(t.String()),
          projectId: t.Optional(t.String()),
          status: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )

    // Get instance by ID
    .get(
      '/:id',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        return {
          success: true,
          data: instance,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Spawn a new instance
    .post(
      '/',
      async ({ body, set }) => {
        // Check if agent exists and is online
        const agent = agentRegistry.get(body.agentId);

        if (!agent) {
          set.status = 404;
          return {
            success: false,
            error: 'Agent not found',
          };
        }

        if (agent.status !== 'online') {
          set.status = 400;
          return {
            success: false,
            error: 'Agent is not online',
          };
        }

        // Create instance in database
        const spawnData: SpawnInstanceData = {
          agentId: body.agentId,
          cwd: body.cwd,
          projectId: body.projectId,
          permissionMode: body.permissionMode as SpawnInstanceData['permissionMode'],
          initialPrompt: body.prompt,
        };

        const instance = await tracker.create(spawnData);

        // Send spawn request to agent
        const response = await agentRegistry.sendToAgent(
          body.agentId,
          CommandMethod.INSTANCE_SPAWN,
          {
            instanceId: instance.id,
            cwd: body.cwd,
            prompt: body.prompt,
            permissionMode: body.permissionMode,
            projectId: body.projectId,
          }
        );

        if (response.error) {
          // Mark instance as errored if spawn failed
          await tracker.markError(instance.id);

          set.status = 500;
          return {
            success: false,
            error: getErrorMessage(response.error),
            data: instance,
          };
        }

        // Broadcast instance creation
        broadcast.broadcast('instance:created', instance);

        return {
          success: true,
          data: instance,
        };
      },
      {
        body: t.Object({
          agentId: t.String(),
          cwd: t.String(),
          projectId: t.Optional(t.String()),
          prompt: t.Optional(t.String()),
          permissionMode: t.Optional(t.String()),
        }),
      }
    )

    // Send message to instance
    .post(
      '/:id/send',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        if (instance.status !== 'running') {
          set.status = 400;
          return {
            success: false,
            error: `Instance is not running (status: ${instance.status})`,
          };
        }

        // Send message to agent
        const response = await agentRegistry.sendToAgent(
          instance.agentId,
          CommandMethod.INSTANCE_SEND,
          {
            instanceId: params.id,
            content: body.message,
          }
        );

        if (response.error) {
          set.status = 500;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        // Update last prompt
        await tracker.update(params.id, {
          lastPrompt: body.message,
        });

        return {
          success: true,
          data: { sent: true },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          message: t.String(),
        }),
      }
    )

    // Stop an instance
    .delete(
      '/:id',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        if (instance.status === 'stopped' || instance.status === 'error') {
          return {
            success: true,
            data: instance,
            message: 'Instance already stopped',
          };
        }

        // Send stop request to agent
        const response = await agentRegistry.sendToAgent(
          instance.agentId,
          CommandMethod.INSTANCE_STOP,
          {
            instanceId: params.id,
          }
        );

        if (response.error) {
          // Agent error - still mark as stopped in database
          // This is common when instance was already stopped or agent restarted
          const stoppedInstance = await tracker.markStopped(params.id);

          // Don't return 500 - this is expected when instance isn't known to agent
          return {
            success: true,
            data: stoppedInstance,
            message: 'Instance marked as stopped (agent returned: ' + getErrorMessage(response.error) + ')',
          };
        }

        const stoppedInstance = await tracker.markStopped(params.id);

        // Broadcast instance stopped
        broadcast.broadcast('instance:stopped', { instanceId: params.id });

        return {
          success: true,
          data: stoppedInstance,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Get instance status from agent
    .get(
      '/:id/status',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Get live status from agent
        const response = await agentRegistry.sendToAgent(
          instance.agentId,
          CommandMethod.AGENT_STATUS,
          {
            instanceId: params.id,
          }
        );

        if (response.error) {
          return {
            success: true,
            data: {
              instance,
              liveStatus: null,
              error: getErrorMessage(response.error),
            },
          };
        }

        return {
          success: true,
          data: {
            instance,
            liveStatus: response.result,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    );
}

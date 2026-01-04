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
 * Derive instance status based on agent connectivity
 * If agent is offline, instance status should reflect that
 */
function deriveInstanceStatus(
  instance: { status: string; agentId: string },
  agentRegistry: ReturnType<typeof getAgentRegistry>
): string {
  const agent = agentRegistry.get(instance.agentId);
  const isAgentOnline = agent?.status === 'online';

  // If agent is offline and instance claims to be running, show as disconnected
  if (!isAgentOnline && (instance.status === 'running' || instance.status === 'starting')) {
    return 'disconnected';
  }

  return instance.status;
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

        // Derive status based on agent connectivity
        const instancesWithDerivedStatus = instances.map((inst) => ({
          ...inst,
          status: deriveInstanceStatus(inst, agentRegistry),
        }));

        return {
          success: true,
          data: instancesWithDerivedStatus,
          total: instancesWithDerivedStatus.length,
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

        // Derive status based on agent connectivity
        const instanceWithDerivedStatus = {
          ...instance,
          status: deriveInstanceStatus(instance, agentRegistry),
        };

        return {
          success: true,
          data: instanceWithDerivedStatus,
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
            resumeSessionId: body.resumeSessionId,
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

        // Save initial user prompt as message
        if (body.prompt) {
          await tracker.saveMessage(instance.id, {
            messageType: 'user',
            content: { type: 'user', content: body.prompt },
            timestamp: new Date(),
          });
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
          resumeSessionId: t.Optional(t.String()),
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

        // Save user message and update last prompt
        await tracker.saveMessage(params.id, {
          messageType: 'user',
          content: { type: 'user', content: body.message },
          timestamp: new Date(),
        });

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
    )

    // Get messages for an instance
    .get(
      '/:id/messages',
      async ({ params, query, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        const limit = query.limit ? parseInt(query.limit) : 100;
        const offset = query.offset ? parseInt(query.offset) : 0;

        const messages = await tracker.getMessages(params.id, limit, offset);
        const total = await tracker.countMessages(params.id);

        return {
          success: true,
          data: messages,
          total,
          limit,
          offset,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        query: t.Object({
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )

    // Get available commands for an instance
    .get(
      '/:id/commands',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Check if agent is online
        const agent = agentRegistry.get(instance.agentId);
        if (!agent || agent.status !== 'online') {
          set.status = 503;
          return {
            success: false,
            error: 'Agent is not online',
          };
        }

        // Request commands from agent
        const response = await agentRegistry.sendToAgent(
          instance.agentId,
          CommandMethod.COMMANDS_LIST,
          {
            instanceId: params.id,
            cwd: instance.cwd,
          }
        );

        if (response.error) {
          set.status = 500;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        return {
          success: true,
          data: response.result,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Interrupt an instance's current operation
    .post(
      '/:id/interrupt',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        if (instance.status !== 'running' && instance.status !== 'starting') {
          set.status = 400;
          return {
            success: false,
            error: `Instance is not running (status: ${instance.status})`,
          };
        }

        // Check if agent is online
        const agent = agentRegistry.get(instance.agentId);
        if (!agent || agent.status !== 'online') {
          set.status = 503;
          return {
            success: false,
            error: 'Agent is not online',
          };
        }

        // Send interrupt request to agent
        const response = await agentRegistry.sendToAgent(
          instance.agentId,
          CommandMethod.INSTANCE_INTERRUPT,
          {
            instanceId: params.id,
          }
        );

        if (response.error) {
          set.status = 500;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        // Update instance status to sleeping
        await tracker.update(params.id, {
          status: 'sleeping',
          sdkSessionId: (response.result as { sdkSessionId?: string })?.sdkSessionId,
        });

        // Broadcast instance sleeping
        broadcast.broadcast('instance:sleeping', {
          instanceId: params.id,
          instance: await tracker.get(params.id),
        });

        return {
          success: true,
          data: {
            interrupted: true,
            sdkSessionId: (response.result as { sdkSessionId?: string })?.sdkSessionId,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Resume an instance - re-spawn with the same instance ID
    .post(
      '/:id/resume',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Check if agent is online
        const agent = agentRegistry.get(instance.agentId);
        if (!agent || agent.status !== 'online') {
          set.status = 400;
          return {
            success: false,
            error: 'Agent is not online',
          };
        }

        // If instance is already running, just send the message
        if (instance.status === 'running') {
          if (body?.prompt) {
            // Save user message
            await tracker.saveMessage(params.id, {
              messageType: 'user',
              content: { type: 'user', content: body.prompt },
              timestamp: new Date(),
            });

            const response = await agentRegistry.sendToAgent(
              instance.agentId,
              CommandMethod.INSTANCE_SEND,
              {
                instanceId: params.id,
                content: body.prompt,
              }
            );

            if (response.error) {
              set.status = 500;
              return {
                success: false,
                error: getErrorMessage(response.error),
              };
            }
          }

          return {
            success: true,
            data: instance,
          };
        }

        // Instance is stopped - re-spawn with the SAME instance ID
        // Update instance status to starting
        await tracker.update(params.id, { status: 'starting' });

        // Send spawn request to agent with the same instanceId
        const response = await agentRegistry.sendToAgent(
          instance.agentId,
          CommandMethod.INSTANCE_SPAWN,
          {
            instanceId: params.id, // Reuse same ID!
            cwd: instance.cwd,
            prompt: body?.prompt,
            permissionMode: instance.permissionMode,
            projectId: instance.projectId,
            resumeSessionId: instance.sdkSessionId, // Use stored SDK session ID
          }
        );

        if (response.error) {
          // Mark instance as errored if spawn failed
          await tracker.markError(params.id);

          set.status = 500;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        // Save user message for resume prompt
        if (body?.prompt) {
          await tracker.saveMessage(params.id, {
            messageType: 'user',
            content: { type: 'user', content: body.prompt },
            timestamp: new Date(),
          });
        }

        // Get updated instance
        const updated = await tracker.get(params.id);

        // Broadcast instance resumed
        broadcast.broadcast('instance:resumed', updated);

        return {
          success: true,
          data: updated,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Optional(t.Object({
          prompt: t.Optional(t.String()),
        })),
      }
    );
}

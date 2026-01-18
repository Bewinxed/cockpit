import { Elysia, t } from 'elysia';
import type { Db } from '@cockpit/db';
import { credentials, eq } from '@cockpit/db';
import type { SpawnInstanceData } from '@cockpit/core';
import type { JsonRpcError } from '@cockpit/core/protocol';
import { CommandMethod } from '@cockpit/core/protocol';
import { isTokenExpired, refreshAccessToken } from '@cockpit/auth';
import { createInstanceTracker, getAgentRegistry, getDashboardRegistry } from '../services';

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

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Get OAuth credentials from database for passing to agents
 */
async function getOAuthCredentials(db: Db): Promise<OAuthCredentials | null> {
  const result = await db
    .select()
    .from(credentials)
    .where(eq(credentials.isDefault, true))
    .limit(1);

  if (result.length === 0) return null;

  const cred = result[0];
  if (cred.type !== 'oauth' || !cred.accessToken || !cred.refreshToken) return null;

  // Auto-refresh if expired (expiresAt is stored as number in ms)
  if (cred.expiresAt && isTokenExpired(cred.expiresAt)) {
    if (cred.refreshToken) {
      try {
        const tokens = await refreshAccessToken(cred.refreshToken);
        await db
          .update(credentials)
          .set({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt, // Store as number (ms)
            updatedAt: new Date(),
          })
          .where(eq(credentials.id, cred.id));
        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  return {
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken,
    expiresAt: cred.expiresAt || Date.now() + 3600000,
  };
}

/**
 * Derive instance status based on machine connectivity.
 * If machine is offline, instance status should reflect that.
 */
function deriveInstanceStatus(
  instance: { status: string; machineId: string }
): string {
  const registry = getAgentRegistry();
  const agent = registry.get(instance.machineId);
  const isMachineOnline = agent?.status === 'online';

  // If machine is offline and instance claims to be running, show as disconnected
  if (!isMachineOnline && (instance.status === 'running' || instance.status === 'starting')) {
    return 'disconnected';
  }

  return instance.status;
}

/**
 * Instance CRUD routes
 */
export function createInstanceRoutes(db: Db) {
  const tracker = createInstanceTracker(db);
  // Note: Don't cache agentRegistry/broadcast here - get fresh reference on each request
  // to avoid stale references after hot reload

  return new Elysia({ prefix: '/instances' })
    // List all instances
    .get(
      '/',
      async ({ query }) => {
        const instances = await tracker.list({
          machineId: query.machineId,
          projectId: query.projectId,
          status: query.status as any,
          limit: query.limit ? parseInt(query.limit) : undefined,
          offset: query.offset ? parseInt(query.offset) : undefined,
        });

        // Derive status based on machine connectivity
        const instancesWithDerivedStatus = instances.map((inst) => ({
          ...inst,
          status: deriveInstanceStatus(inst),
        }));

        return {
          success: true,
          data: instancesWithDerivedStatus,
          total: instancesWithDerivedStatus.length,
        };
      },
      {
        query: t.Object({
          machineId: t.Optional(t.String()),
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

        // Derive status based on machine connectivity
        const instanceWithDerivedStatus = {
          ...instance,
          status: deriveInstanceStatus(instance),
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
        // Check if machine exists and is online
        const machine = getAgentRegistry().get(body.machineId);

        if (!machine) {
          set.status = 404;
          return {
            success: false,
            error: 'Machine not found',
          };
        }

        if (machine.status !== 'online') {
          set.status = 400;
          return {
            success: false,
            error: 'Machine is not online',
          };
        }

        // Get credentials to pass to machine
        const oauthCreds = await getOAuthCredentials(db);

        // Create instance in database
        const spawnData: SpawnInstanceData = {
          machineId: body.machineId,
          cwd: body.cwd,
          projectId: body.projectId,
          permissionMode: body.permissionMode as SpawnInstanceData['permissionMode'],
          initialPrompt: body.prompt,
        };

        const instance = await tracker.create(spawnData);

        // Send spawn request to machine with credentials
        const response = await getAgentRegistry().sendToMachine(
          body.machineId,
          CommandMethod.INSTANCE_SPAWN,
          {
            instanceId: instance.id,
            cwd: body.cwd,
            initialPrompt: body.prompt,
            permissionMode: body.permissionMode,
            projectId: body.projectId,
            resumeSessionId: body.resumeSessionId,
            envVars: oauthCreds ? {
              COCKPIT_OAUTH_ACCESS_TOKEN: oauthCreds.accessToken,
              COCKPIT_OAUTH_REFRESH_TOKEN: oauthCreds.refreshToken,
              COCKPIT_OAUTH_EXPIRES_AT: String(oauthCreds.expiresAt),
            } : undefined,
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
            content: { type: 'user', content: body.prompt },
            timestamp: new Date(),
          });
        }

        // Broadcast instance creation
        getDashboardRegistry().broadcast('instance:created', instance);

        return {
          success: true,
          data: instance,
        };
      },
      {
        body: t.Object({
          machineId: t.String(),
          cwd: t.String(),
          projectId: t.Optional(t.String()),
          prompt: t.Optional(t.String()),
          permissionMode: t.Optional(t.String()),
          resumeSessionId: t.Optional(t.String()),
        }),
      }
    )

    // Get instance status from machine
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

        // Get live status from machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
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

    // Clear messages for an instance
    .delete(
      '/:id/messages',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        const deletedCount = await tracker.deleteMessages(params.id);

        return {
          success: true,
          data: {
            deletedCount,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // Delete messages after a specific message (for edit/rewind)
    .delete(
      '/:id/messages/after/:messageId',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        const deletedCount = await tracker.deleteMessagesAfter(params.id, params.messageId);

        return {
          success: true,
          data: {
            deletedCount,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
          messageId: t.String(),
        }),
      }
    )

    // Get tool invocations for an instance
    .get(
      '/:id/tools',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        const tools = await tracker.getToolInvocations(params.id);

        return {
          success: true,
          data: tools,
        };
      },
      {
        params: t.Object({
          id: t.String(),
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

        // Request commands from machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
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

        // Send interrupt request to machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
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
        const sleepingInstance = await tracker.get(params.id);
        getDashboardRegistry().broadcast('instance:sleeping', {
          instanceId: params.id,
          instance: sleepingInstance ? {
            id: sleepingInstance.id,
            status: sleepingInstance.status,
            sdkSessionId: sleepingInstance.sdkSessionId,
          } : undefined,
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

        // Track whether we already saved the user message (to avoid duplicates)
        let messageSaved = false;

        // If instance is already running, just send the message
        if (instance.status === 'running') {
          if (body?.prompt) {
            // Save user message
            await tracker.saveMessage(params.id, {
              content: { type: 'user', content: body.prompt },
              timestamp: new Date(),
            });
            messageSaved = true;

            const response = await getAgentRegistry().sendToMachine(
              instance.machineId,
              CommandMethod.INSTANCE_SEND,
              {
                instanceId: params.id,
                content: body.prompt,
              }
            );

            if (response.error) {
              const errorMsg = getErrorMessage(response.error);
              // If machine says "not found", the machine was restarted - fall through to re-spawn
              if (errorMsg.toLowerCase().includes('not found')) {
                console.log(`[Resume] Instance ${params.id} not found on machine, will re-spawn`);
                // Don't return - fall through to re-spawn logic below
              } else {
                set.status = 500;
                return {
                  success: false,
                  error: errorMsg,
                };
              }
            } else {
              // Send succeeded, return success
              return {
                success: true,
                data: instance,
              };
            }
          } else {
            // No prompt, just return success
            return {
              success: true,
              data: instance,
            };
          }
        }

        // Instance is stopped or machine lost it - re-spawn with the SAME instance ID
        // Get credentials to pass to machine
        const oauthCreds = await getOAuthCredentials(db);

        // Update instance status to starting
        await tracker.update(params.id, { status: 'starting' });

        // Only pass resumeFromMessageId if we have a valid sdkSessionId
        // Invalid UUIDs will crash the SDK
        const resumeFromMessageId = instance.sdkSessionId && body?.resumeFromMessageId
          ? body.resumeFromMessageId
          : undefined;

        if (body?.resumeFromMessageId && !resumeFromMessageId) {
          console.warn(`[Resume] Cannot use resumeFromMessageId without sdkSessionId for instance ${params.id}`);
        }

        // Send spawn request to machine with the same instanceId
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
          CommandMethod.INSTANCE_SPAWN,
          {
            instanceId: params.id, // Reuse same ID!
            cwd: instance.cwd,
            initialPrompt: body?.prompt,
            permissionMode: instance.permissionMode,
            projectId: instance.projectId,
            resumeSessionId: instance.sdkSessionId, // Use stored SDK session ID
            resumeFromMessageId, // Only pass if we have a valid session to resume from
            forkSession: body?.forkSession, // Optional: fork to new session
            enableFileCheckpointing: body?.enableFileCheckpointing, // Optional: enable file checkpointing
            envVars: oauthCreds ? {
              COCKPIT_OAUTH_ACCESS_TOKEN: oauthCreds.accessToken,
              COCKPIT_OAUTH_REFRESH_TOKEN: oauthCreds.refreshToken,
              COCKPIT_OAUTH_EXPIRES_AT: String(oauthCreds.expiresAt),
            } : undefined,
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

        // Save user message for resume prompt (only if not already saved above)
        // Format as SDK-like message for consistent extraction
        if (body?.prompt && !messageSaved) {
          await tracker.saveMessage(params.id, {
            content: {
              type: 'user',
              message: {
                role: 'user',
                content: [{ type: 'text', text: body.prompt }],
              },
            },
            timestamp: new Date(),
          });
        }

        // Get updated instance and broadcast
        const updated = await tracker.get(params.id);
        if (updated) {
          getDashboardRegistry().broadcast('instance:resumed', updated);
        }

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
          /** Resume from a specific message UUID (discards subsequent messages) */
          resumeFromMessageId: t.Optional(t.String()),
          /** Fork to a new session ID instead of modifying original */
          forkSession: t.Optional(t.Boolean()),
          /** Enable file checkpointing for rewind functionality */
          enableFileCheckpointing: t.Optional(t.Boolean()),
        })),
      }
    )

    // Get available models for an instance
    .get(
      '/:id/models',
      async ({ params, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Request models from machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
          CommandMethod.MODELS_LIST,
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

    // Set model for an instance
    .patch(
      '/:id/models',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Send model change request to machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
          CommandMethod.MODELS_SET,
          {
            instanceId: params.id,
            model: body.model,
          }
        );

        if (response.error) {
          set.status = 500;
          return {
            success: false,
            error: getErrorMessage(response.error),
          };
        }

        // Broadcast model changed event
        getDashboardRegistry().broadcast('instance:model-changed', {
          instanceId: params.id,
          model: body.model,
        });

        return {
          success: true,
          data: response.result,
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          model: t.String(),
        }),
      }
    )

    // Get memory content for an instance
    .get(
      '/:id/memory',
      async ({ params, query, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Send memory read request to machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
          CommandMethod.MEMORY_READ,
          {
            type: query.type as 'project' | 'user',
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
        query: t.Object({
          type: t.String(), // 'project' | 'user'
        }),
      }
    )

    // Write memory content for an instance
    .put(
      '/:id/memory',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Send memory write request to machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
          CommandMethod.MEMORY_WRITE,
          {
            type: body.type,
            content: body.content,
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
        body: t.Object({
          type: t.String(), // 'project' | 'user'
          content: t.String(),
        }),
      }
    )

    // Rewind files to a previous message state
    .post(
      '/:id/rewind',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Send rewind request to machine
        const response = await getAgentRegistry().sendToMachine(
          instance.machineId,
          CommandMethod.INSTANCE_REWIND,
          {
            instanceId: params.id,
            userMessageId: body.userMessageId,
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
        body: t.Object({
          userMessageId: t.String(),
        }),
      }
    )

    // Respond to a question request (AskUserQuestion)
    .post(
      '/:id/question',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Forward question response to machine as notification
        const agentRegistry = getAgentRegistry();
        const machine = agentRegistry.get(instance.machineId);

        if (!machine) {
          set.status = 400;
          return {
            success: false,
            error: 'Machine not connected',
          };
        }

        // Send question response as notification to machine
        agentRegistry.notifyMachine(instance.machineId, 'question.response', {
          requestId: body.requestId,
          instanceId: params.id,
          answers: body.answers,
        });

        return {
          success: true,
          data: {
            requestId: body.requestId,
            answered: true,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          requestId: t.String(),
          answers: t.Record(t.String(), t.String()),
        }),
      }
    )

    // Respond to a permission request
    .post(
      '/:id/permission',
      async ({ params, body, set }) => {
        const instance = await tracker.get(params.id);

        if (!instance) {
          set.status = 404;
          return {
            success: false,
            error: 'Instance not found',
          };
        }

        // Forward permission response to machine as notification
        const agentRegistry = getAgentRegistry();
        const machine = agentRegistry.get(instance.machineId);

        if (!machine) {
          set.status = 400;
          return {
            success: false,
            error: 'Machine not connected',
          };
        }

        // Send permission response as notification to machine
        agentRegistry.notifyMachine(instance.machineId, 'permission.response', {
          requestId: body.requestId,
          instanceId: params.id,
          behavior: body.behavior,
          updatedInput: body.updatedInput,
          updatedPermissions: body.updatedPermissions,
          message: body.message,
          interrupt: body.interrupt,
        });

        return {
          success: true,
          data: {
            requestId: body.requestId,
            behavior: body.behavior,
          },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          requestId: t.String(),
          behavior: t.Union([t.Literal('allow'), t.Literal('deny')]),
          updatedInput: t.Optional(t.Record(t.String(), t.Unknown())),
          updatedPermissions: t.Optional(t.Array(t.Unknown())),
          message: t.Optional(t.String()),
          interrupt: t.Optional(t.Boolean()),
        }),
      }
    );
}

import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JSON_RPC_ERROR_CODES } from '@cockpit/core';
import { isAuthenticated, getValidAccessToken } from '@cockpit/auth';
import type { InstanceManager, SpawnInstanceParams } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

export interface SpawnHandlerParams {
  /** Working directory (from hub) */
  cwd?: string;
  /** @deprecated Use cwd instead */
  projectPath?: string;
  instanceId?: string;
  sessionId?: string;
  systemPrompt?: string;
  prompt?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  model?: string;
  maxTokens?: number;
  initialPrompt?: string;
  envVars?: Record<string, string>;
  projectId?: string;
}

/**
 * Handle instance.spawn requests from the hub
 */
export async function handleSpawn(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as SpawnHandlerParams | undefined;

  // Accept either cwd (from hub) or projectPath (legacy)
  const workingDir = params?.cwd || params?.projectPath;

  if (!params || !workingDir) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Missing required parameter: cwd (working directory)'
      )
    );
    return;
  }

  // Check for OAuth credentials before spawning
  try {
    const hasAuth = await isAuthenticated();
    if (!hasAuth) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JSON_RPC_ERROR_CODES.AUTH_REQUIRED,
          'Authentication required. Please run "cockpit login" to authenticate.',
          { authRequired: true }
        )
      );
      return;
    }

    // Validate token is actually usable
    const token = await getValidAccessToken();
    if (!token) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JSON_RPC_ERROR_CODES.AUTH_FAILED,
          'Failed to obtain valid access token. Please run "cockpit login" to re-authenticate.',
          { authRequired: true }
        )
      );
      return;
    }
  } catch (authError) {
    const message = authError instanceof Error ? authError.message : String(authError);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.AUTH_FAILED,
        `Authentication error: ${message}`,
        { authRequired: true }
      )
    );
    return;
  }

  try {
    // Map params to SpawnInstanceParams
    const spawnParams: SpawnInstanceParams = {
      projectPath: workingDir,
      instanceId: params.instanceId, // Use hub's instanceId to keep in sync
      sessionId: params.sessionId,
      systemPrompt: params.systemPrompt,
      permissionMode: params.permissionMode,
      mcpServers: params.mcpServers,
      model: params.model,
      maxTokens: params.maxTokens,
      initialPrompt: params.initialPrompt || params.prompt,
      envVars: params.envVars,
    };

    const instanceId = await instanceManager.spawn(spawnParams);

    hubClient.sendResponse(
      createResponse(request.id, {
        instanceId,
        status: 'starting',
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `Failed to spawn instance: ${message}`
      )
    );
  }
}

export default handleSpawn;

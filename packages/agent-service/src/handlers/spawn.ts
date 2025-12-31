import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JSON_RPC_ERROR_CODES } from '@cockpit/core';
import type { InstanceManager, SpawnInstanceParams } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

export interface SpawnHandlerParams {
  projectPath: string;
  sessionId?: string;
  systemPrompt?: string;
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

  if (!params || !params.projectPath) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Missing required parameter: projectPath'
      )
    );
    return;
  }

  try {
    // Map params to SpawnInstanceParams
    const spawnParams: SpawnInstanceParams = {
      projectPath: params.projectPath,
      sessionId: params.sessionId,
      systemPrompt: params.systemPrompt,
      permissionMode: params.permissionMode,
      mcpServers: params.mcpServers,
      model: params.model,
      maxTokens: params.maxTokens,
      initialPrompt: params.initialPrompt,
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

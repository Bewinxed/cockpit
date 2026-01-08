import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JSON_RPC_ERROR_CODES } from '@cockpit/core';
import { saveCredentials } from '@cockpit/auth';
import type { InstanceManager, SpawnInstanceParams } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

export interface SpawnHandlerParams {
  /** Working directory (from hub) */
  cwd?: string;
  /** @deprecated Use cwd instead */
  projectPath?: string;
  instanceId?: string;
  sessionId?: string;
  /** Claude SDK session ID to resume a previous conversation */
  resumeSessionId?: string;
  /** Message UUID to resume from (discards subsequent messages) */
  resumeFromMessageId?: string;
  /** Fork to a new session ID when resuming */
  forkSession?: boolean;
  /** Enable file checkpointing for rewind functionality */
  enableFileCheckpointing?: boolean;
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

  // If credentials were passed from hub, save them for SDK to use
  // We don't pre-validate - let the SDK handle auth and propagate errors
  if (params.envVars?.COCKPIT_OAUTH_ACCESS_TOKEN && params.envVars?.COCKPIT_OAUTH_REFRESH_TOKEN) {
    try {
      await saveCredentials({
        accessToken: params.envVars.COCKPIT_OAUTH_ACCESS_TOKEN,
        refreshToken: params.envVars.COCKPIT_OAUTH_REFRESH_TOKEN,
        expiresAt: parseInt(params.envVars.COCKPIT_OAUTH_EXPIRES_AT || '0') || Date.now() + 3600000,
        tokenType: 'Bearer',
        scopes: params.envVars.COCKPIT_OAUTH_SCOPES ?
          JSON.parse(params.envVars.COCKPIT_OAUTH_SCOPES) :
          ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        subscriptionType: params.envVars.COCKPIT_OAUTH_SUBSCRIPTION_TYPE || 'max',
        rateLimitTier: params.envVars.COCKPIT_OAUTH_RATE_LIMIT_TIER || 'default_claude_max_5x',
      });
      console.log('[Spawn] Saved credentials from hub to local file');
    } catch (saveError) {
      console.error('[Spawn] Failed to save credentials from hub:', saveError);
      // Continue anyway - SDK will handle auth errors
    }
  }

  try {
    // Map params to SpawnInstanceParams
    const spawnParams: SpawnInstanceParams = {
      projectPath: workingDir,
      instanceId: params.instanceId, // Use hub's instanceId to keep in sync
      sessionId: params.sessionId,
      resumeSessionId: params.resumeSessionId, // Claude SDK session ID for resume
      resumeFromMessageId: params.resumeFromMessageId, // Resume from specific message
      forkSession: params.forkSession, // Fork to new session
      enableFileCheckpointing: params.enableFileCheckpointing, // Enable file checkpointing
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

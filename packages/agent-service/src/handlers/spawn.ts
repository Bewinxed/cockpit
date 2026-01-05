import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JSON_RPC_ERROR_CODES } from '@cockpit/core';
import { isAuthenticated, getValidAccessToken, saveCredentials } from '@cockpit/auth';
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

  // Check for OAuth credentials - either passed from hub or local
  // First check if credentials were passed from hub
  if (params.envVars?.COCKPIT_OAUTH_ACCESS_TOKEN && params.envVars?.COCKPIT_OAUTH_REFRESH_TOKEN) {
    // Save credentials from hub to local file so SDK can use them
    try {
      await saveCredentials({
        accessToken: params.envVars.COCKPIT_OAUTH_ACCESS_TOKEN,
        refreshToken: params.envVars.COCKPIT_OAUTH_REFRESH_TOKEN,
        expiresAt: parseInt(params.envVars.COCKPIT_OAUTH_EXPIRES_AT || '0') || Date.now() + 3600000,
        tokenType: 'Bearer',
        // Additional fields required by CLI
        scopes: params.envVars.COCKPIT_OAUTH_SCOPES ?
          JSON.parse(params.envVars.COCKPIT_OAUTH_SCOPES) :
          ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        subscriptionType: params.envVars.COCKPIT_OAUTH_SUBSCRIPTION_TYPE || 'max',
        rateLimitTier: params.envVars.COCKPIT_OAUTH_RATE_LIMIT_TIER || 'default_claude_max_5x',
      });
      console.log('[Spawn] Saved credentials from hub to local file');
    } catch (saveError) {
      console.error('[Spawn] Failed to save credentials from hub:', saveError);
      // Continue anyway - might still work if local creds exist
    }
  }

  // Now verify we have valid credentials (either just saved or pre-existing)
  try {
    const hasAuth = await isAuthenticated();
    if (!hasAuth) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JSON_RPC_ERROR_CODES.AUTH_REQUIRED,
          'Authentication required. Please login via the dashboard.',
          { authRequired: true }
        )
      );
      return;
    }

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JSON_RPC_ERROR_CODES.AUTH_FAILED,
          'Failed to obtain valid access token. Please re-authenticate.',
          { authRequired: true }
        )
      );
      return;
    }
    console.log('[Spawn] Credentials validated successfully');
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
      resumeSessionId: params.resumeSessionId, // Claude SDK session ID for resume
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

import type { JsonRpcRequest, SpawnInstanceParams as SpawnParams } from '@agentdeck/core';
import { createResponse, createErrorResponse, JsonRpcErrorCode } from '@agentdeck/core';
import { saveCredentials } from '@agentdeck/auth';
import type { InstanceManager, SpawnInstanceParams as LocalSpawnParams } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

/**
 * Handle instance.spawn requests from the hub
 */
export async function handleSpawn(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as SpawnParams | undefined;

  if (!params || !params.cwd) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
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
    // Validate resumeFromMessageId format if provided
    // SDK UUIDs are in standard UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let validatedResumeFromMessageId = params.resumeFromMessageId;

    if (params.resumeFromMessageId && !uuidRegex.test(params.resumeFromMessageId)) {
      console.warn(`[Spawn] Invalid resumeFromMessageId format: ${params.resumeFromMessageId}, ignoring`);
      validatedResumeFromMessageId = undefined;
    }

    // Map params to local SpawnInstanceParams for instance-manager
    const spawnParams: LocalSpawnParams = {
      projectPath: params.cwd,
      instanceId: params.instanceId, // Use hub's instanceId to keep in sync
      sessionId: params.sessionId,
      resumeSessionId: params.resumeSessionId, // Claude SDK session ID for resume
      resumeFromMessageId: validatedResumeFromMessageId, // Resume from specific message (validated)
      forkSession: params.forkSession, // Fork to new session
      enableFileCheckpointing: params.enableFileCheckpointing, // Enable file checkpointing
      systemPrompt: params.systemPrompt,
      permissionMode: params.permissionMode,
      mcpServers: params.mcpServers,
      model: params.model,
      maxTokens: params.maxTokens,
      initialPrompt: params.initialPrompt,
      envVars: params.envVars,
      allowThinking: params.allowThinking,
      // New spawn options
      maxTurns: params.maxTurns,
      maxBudgetUsd: params.maxBudgetUsd,
      allowedTools: params.allowedTools,
      disallowedTools: params.disallowedTools,
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
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to spawn instance: ${message}`
      )
    );
  }
}

export default handleSpawn;

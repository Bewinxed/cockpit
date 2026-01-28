/**
 * Handler for thinking.set protocol method
 */

import type { JsonRpcRequest, ThinkingSetParams, ThinkingSetResult } from '@agentdeck/core';
import {
  createResponse,
  createErrorResponse,
  JsonRpcErrorCode,
} from '@agentdeck/core';
import type { HubClient } from '../hub-client.js';
import type { InstanceManager } from '../instance-manager.js';

/**
 * Handle thinking.set request - change thinking mode on instance
 */
export async function handleThinkingSet(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as ThinkingSetParams | undefined;

  if (!params?.instanceId || !params?.mode) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing required params: instanceId, mode'
      )
    );
    return;
  }

  const validModes = ['off', 'think', 'ultrathink'] as const;
  if (!validModes.includes(params.mode as typeof validModes[number])) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        `Invalid mode: ${params.mode}. Must be one of: ${validModes.join(', ')}`
      )
    );
    return;
  }

  const status = instanceManager.getStatus(params.instanceId);
  if (!status) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        `Instance not found: ${params.instanceId}`
      )
    );
    return;
  }

  try {
    await instanceManager.setThinking(params.instanceId, params.mode);

    const result: ThinkingSetResult = {
      success: true,
      mode: params.mode,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to set thinking mode: ${message}`
      )
    );
  }
}

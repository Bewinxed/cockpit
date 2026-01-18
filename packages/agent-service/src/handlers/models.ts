/**
 * Handler for models.list and models.set protocol methods
 */

import type { JsonRpcRequest } from '@cockpit/core';
import {
  createResponse,
  createErrorResponse,
  JsonRpcErrorCode,
  type ModelsListParams,
  type ModelsListResult,
  type ModelsSetParams,
  type ModelsSetResult,
} from '@cockpit/core';
import type { HubClient } from '../hub-client.js';
import type { InstanceManager } from '../instance-manager.js';

/**
 * Handle models.list request - get available models from SDK
 */
export async function handleModelsList(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as ModelsListParams | undefined;

  if (!params?.instanceId) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing required param: instanceId'
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
    const session = instanceManager.getSession(params.instanceId);
    if (!session) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INTERNAL_ERROR,
          'Instance has no active session'
        )
      );
      return;
    }

    const models = await session.supportedModels();

    const result: ModelsListResult = {
      models: models.map(m => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
      })),
      currentModel: instanceManager.getModel(params.instanceId),
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to get models: ${message}`
      )
    );
  }
}

/**
 * Handle models.set request - change model on instance
 */
export async function handleModelsSet(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as ModelsSetParams | undefined;

  if (!params?.instanceId || !params?.model) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing required params: instanceId, model'
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
    const session = instanceManager.getSession(params.instanceId);
    if (!session) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INTERNAL_ERROR,
          'Instance has no active session'
        )
      );
      return;
    }

    await session.setModel(params.model);

    // Update instance's model tracking
    instanceManager.setModel(params.instanceId, params.model);

    const result: ModelsSetResult = {
      success: true,
      model: params.model,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to set model: ${message}`
      )
    );
  }
}

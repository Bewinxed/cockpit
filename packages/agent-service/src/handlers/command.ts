import type { JsonRpcRequest, SendMessageParams, StopInstanceParams } from '@cockpit/core';
import { createResponse, createErrorResponse, JsonRpcErrorCode } from '@cockpit/core';
import type { InstanceManager } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

/**
 * Handle instance.send requests from the hub
 */
export async function handleCommand(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as SendMessageParams | undefined;

  if (!params || !params.instanceId || !params.message) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing required parameters: instanceId and message'
      )
    );
    return;
  }

  // Check if instance exists
  const status = instanceManager.getStatus(params.instanceId);
  if (!status) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INSTANCE_NOT_FOUND,
        `Instance ${params.instanceId} not found`
      )
    );
    return;
  }

  // Respond immediately - message processing happens asynchronously
  // The hub will receive streaming updates via the sdk.message events
  hubClient.sendResponse(
    createResponse(request.id, {
      success: true,
      instanceId: params.instanceId,
    })
  );

  // Start message processing asynchronously (don't await)
  // Errors will be emitted as sdk.message events with type='error'
  instanceManager.sendMessage(params.instanceId, params.message).catch((error) => {
    console.error(`[Command] Message processing failed for ${params.instanceId}:`, error);
  });
}

/**
 * Handle instance.stop requests from the hub
 */
export async function handleStop(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as StopInstanceParams | undefined;

  if (!params || !params.instanceId) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing required parameter: instanceId'
      )
    );
    return;
  }

  try {
    // Check if instance exists
    const status = instanceManager.getStatus(params.instanceId);
    if (!status) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INSTANCE_NOT_FOUND,
          `Instance ${params.instanceId} not found`
        )
      );
      return;
    }

    await instanceManager.stop(params.instanceId);

    hubClient.sendResponse(
      createResponse(request.id, {
        success: true,
        instanceId: params.instanceId,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to stop instance: ${message}`
      )
    );
  }
}

export default handleCommand;

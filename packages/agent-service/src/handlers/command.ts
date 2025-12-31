import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JSON_RPC_ERROR_CODES } from '@cockpit/core';
import type { InstanceManager } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

export interface SendCommandParams {
  instanceId: string;
  content: string;
}

/**
 * Handle instance.send requests from the hub
 */
export async function handleCommand(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as SendCommandParams | undefined;

  if (!params || !params.instanceId || !params.content) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Missing required parameters: instanceId and content'
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
          JSON_RPC_ERROR_CODES.INSTANCE_NOT_FOUND,
          `Instance ${params.instanceId} not found`
        )
      );
      return;
    }

    // Send message (this queues it for processing)
    await instanceManager.sendMessage(params.instanceId, params.content);

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
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `Failed to send message: ${message}`
      )
    );
  }
}

export interface StopInstanceParams {
  instanceId: string;
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
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
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
          JSON_RPC_ERROR_CODES.INSTANCE_NOT_FOUND,
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
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `Failed to stop instance: ${message}`
      )
    );
  }
}

export default handleCommand;

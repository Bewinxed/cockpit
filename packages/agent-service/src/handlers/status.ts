import type { JsonRpcRequest, AgentStatusParams, InstanceStatusParams } from '@agentdeck/core';
import { createResponse, createErrorResponse, JsonRpcErrorCode } from '@agentdeck/core';
import type { InstanceManager, InstanceStatusInfo } from '../instance-manager.js';
import type { HubClient } from '../hub-client.js';

export interface AgentStatusResponse {
  machineId: string;
  hostname: string;
  platform: string;
  uptime: number;
  instances: InstanceStatusInfo[];
}

/**
 * Handle agent.status requests from the hub
 */
export async function handleAgentStatus(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient,
  machineId: string,
  startTime: Date
): Promise<void> {
  try {
    const instances = instanceManager.listInstances();
    const hostname = require('os').hostname();
    const platform = process.platform;
    const uptime = Date.now() - startTime.getTime();

    const response: AgentStatusResponse = {
      machineId,
      hostname,
      platform,
      uptime,
      instances,
    };

    hubClient.sendResponse(createResponse(request.id, response));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to get agent status: ${message}`
      )
    );
  }
}

/**
 * Handle instance.status requests from the hub
 */
export async function handleInstanceStatus(
  request: JsonRpcRequest,
  instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as InstanceStatusParams | undefined;
  console.log(`[handleInstanceStatus] Request for instanceId=${params?.instanceId}, known instances:`, instanceManager.listInstances().map(i => i.instanceId));

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

    hubClient.sendResponse(createResponse(request.id, status));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to get instance status: ${message}`
      )
    );
  }
}

export default { handleAgentStatus, handleInstanceStatus };

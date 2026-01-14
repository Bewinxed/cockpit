/**
 * API Actions for Dashboard
 * Handles all mutations (create, update, delete) using Eden Treaty through the proxy
 *
 * Note: Data refresh is handled automatically via SSE events.
 * When mutations succeed, the hub broadcasts events that update stores.
 */

import { api } from '$lib/api';
import { extractErrorMessage } from '$lib/utils/error';

/** Error codes that indicate authentication issues */
const AUTH_ERROR_CODES = [-32004, -32005];

/** Result type with auth error detection */
export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  authRequired?: boolean;
}

/**
 * Check if an error indicates authentication is required.
 * Uses only error codes - auth is handled via SDK messages with subtype 'login_prompt'.
 */
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as Record<string, unknown>;
  return typeof errObj.code === 'number' && AUTH_ERROR_CODES.includes(errObj.code);
}

/**
 * Spawn a new instance on a machine
 */
export async function spawnInstance(params: {
  machineId: string;
  cwd: string;
  projectId?: string;
  prompt?: string;
  permissionMode?: string;
  resumeSessionId?: string;
}): Promise<ActionResult> {
  const { data, error } = await api.api.instances.post(params);

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to spawn instance:', errorMsg);
    return {
      success: false,
      error: errorMsg,
      authRequired: isAuthError(error),
    };
  }

  // SSE will broadcast instance:created to update stores
  return { success: true, data: data?.data };
}

/**
 * Stop an instance
 */
export async function stopInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await api.api.instances({ id: instanceId }).delete();

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to stop instance:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // SSE will broadcast instance:stopped to update stores
  return { success: true };
}

/**
 * Send a message to an instance
 * Returns messageUuid if available (for edit support)
 */
export async function sendMessage(
  instanceId: string,
  content: string
): Promise<{ success: boolean; error?: string; messageUuid?: string }> {
  const { data, error } = await api.api.instances({ id: instanceId }).send.post({ message: content });

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to send message:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // Debug: log the response to see what's available
  console.log('[sendMessage] Response data:', JSON.stringify(data, null, 2));

  // Try to extract messageUuid from response if available
  // The server might return it in different locations
  const responseData = data as { success?: boolean; data?: Record<string, unknown> };
  const messageUuid = responseData?.data?.messageUuid as string | undefined
    || responseData?.data?.uuid as string | undefined
    || responseData?.data?.id as string | undefined;

  return { success: true, messageUuid };
}

/**
 * Create a new project
 */
export async function createProject(params: {
  name: string;
  description?: string;
  rootPath?: string;
  machineId?: string;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { data, error } = await api.api.projects.post(params);

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to create project:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // SSE will broadcast project:created to update stores
  return { success: true, data: data?.data };
}

/**
 * Update a project
 */
export async function updateProject(
  projectId: string,
  params: {
    name?: string;
    description?: string;
    rootPath?: string;
    machineId?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { error } = await api.api.projects({ id: projectId }).patch(params);

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to update project:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // SSE will broadcast project:updated to update stores
  return { success: true };
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await api.api.projects({ id: projectId }).delete();

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to delete project:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // SSE will broadcast project:deleted to update stores
  return { success: true };
}

/**
 * Interrupt an instance's current operation
 * Unlike stop, interrupt allows the instance to be resumed
 */
export async function interruptInstance(instanceId: string): Promise<ActionResult> {
  const { data, error } = await api.api.instances({ id: instanceId }).interrupt.post();

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to interrupt instance:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // SSE will broadcast instance state change to update stores
  return { success: true, data: data?.data };
}

/**
 * Resume a stopped instance (re-spawn with same ID)
 */
export async function resumeInstance(
  instanceId: string,
  prompt?: string
): Promise<ActionResult> {
  const { data, error } = await api.api.instances({ id: instanceId }).resume.post(
    prompt ? { prompt } : {}
  );

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to resume instance:', errorMsg);
    return {
      success: false,
      error: errorMsg,
      authRequired: isAuthError(error),
    };
  }

  // SSE will broadcast instance:resumed to update stores
  return { success: true, data: data?.data };
}

/**
 * Fetch messages for an instance to get UUIDs for recently sent messages
 * This is used to enable editing after sending when SSE doesn't provide UUIDs
 */
export interface StoredMessage {
  id: string;
  instanceId: string;
  timestamp: string;
  sdkUuid?: string;
  sdkType: string;
  sdkSubtype?: string | null;
  parentToolUseId?: string | null;
  role?: 'user' | 'assistant' | null;
  textContent?: string | null;
  rawContent: unknown;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

export async function fetchInstanceMessages(instanceId: string): Promise<{
  success: boolean;
  messages?: StoredMessage[];
  error?: string;
}> {
  const { data, error } = await api.api.instances({ id: instanceId }).messages.get();

  if (error) {
    const errorMsg = extractErrorMessage(error);
    return { success: false, error: errorMsg };
  }

  const responseData = data as { success?: boolean; data?: unknown[] };
  if (responseData?.success && responseData?.data) {
    return {
      success: true,
      messages: responseData.data as StoredMessage[],
    };
  }

  return { success: true, messages: [] };
}

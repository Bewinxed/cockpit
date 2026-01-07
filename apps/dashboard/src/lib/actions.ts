/**
 * API Actions for Dashboard
 * Handles all mutations (create, update, delete) using Eden Treaty through the proxy
 */

import { api } from '$lib/api';
import { fetchAgents, fetchInstances, fetchProjects } from './stores/realtime.svelte';
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
 * Check if an error indicates authentication is required
 */
function isAuthError(error: unknown): boolean {
  if (!error) return false;

  const errorStr = extractErrorMessage(error).toLowerCase();
  if (errorStr.includes('auth') || errorStr.includes('login') || errorStr.includes('credential')) {
    return true;
  }

  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.code === 'number' && AUTH_ERROR_CODES.includes(errObj.code)) {
      return true;
    }
  }

  return false;
}

/**
 * Spawn a new instance on an agent
 */
export async function spawnInstance(params: {
  agentId: string;
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

  // Refresh instances list
  await fetchInstances();

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

  // Refresh instances list
  await fetchInstances();

  return { success: true };
}

/**
 * Send a message to an instance
 */
export async function sendMessage(
  instanceId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await api.api.instances({ id: instanceId }).send.post({ message: content });

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to send message:', errorMsg);
    return { success: false, error: errorMsg };
  }

  return { success: true };
}

/**
 * Create a new project
 */
export async function createProject(params: {
  name: string;
  description?: string;
  rootPath?: string;
  agentId?: string;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { data, error } = await api.api.projects.post(params);

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to create project:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // Refresh projects list
  await fetchProjects();

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
    agentId?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { error } = await api.api.projects({ id: projectId }).patch(params);

  if (error) {
    const errorMsg = extractErrorMessage(error);
    console.error('Failed to update project:', errorMsg);
    return { success: false, error: errorMsg };
  }

  // Refresh projects list
  await fetchProjects();

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

  // Refresh projects list
  await fetchProjects();

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

  // Refresh instances list
  await fetchInstances();

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

  // Refresh instances list
  await fetchInstances();

  return { success: true, data: data?.data };
}

/**
 * Refresh all data from the hub
 */
export async function refreshAll(): Promise<void> {
  await Promise.all([
    fetchAgents(),
    fetchInstances(),
    fetchProjects(),
  ]);
}

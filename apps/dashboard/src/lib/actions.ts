/**
 * API Actions for Dashboard
 * Handles all mutations (create, update, delete) using Eden Treaty
 */

import { api } from './api';
import { fetchAgents, fetchInstances, fetchProjects } from './stores/realtime';

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

  // Check error message for auth keywords
  const errorStr = String(error).toLowerCase();
  if (errorStr.includes('auth') || errorStr.includes('login') || errorStr.includes('credential')) {
    return true;
  }

  // Check if error object has auth-related code
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
}): Promise<ActionResult> {
  try {
    const { data, error } = await api.api.instances.post(params);

    if (error) {
      console.error('Failed to spawn instance:', error);
      const errorStr = String(error);
      return {
        success: false,
        error: errorStr,
        authRequired: isAuthError(error),
      };
    }

    // Check if response indicates auth error
    if (data && !data.success && data.error) {
      return {
        success: false,
        error: data.error,
        authRequired: isAuthError(data.error) || (data as any).authRequired,
      };
    }

    // Refresh instances list
    await fetchInstances();

    return { success: true, data: data?.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      success: false,
      error: message,
      authRequired: isAuthError(err),
    };
  }
}

/**
 * Stop an instance
 */
export async function stopInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await api.api.instances({ id: instanceId }).delete();

    if (error) {
      console.error('Failed to stop instance:', error);
      return { success: false, error: String(error) };
    }

    // Refresh instances list
    await fetchInstances();

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Send a message to an instance
 */
export async function sendMessage(
  instanceId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await api.api.instances({ id: instanceId }).send.post({ message });

    if (error) {
      console.error('Failed to send message:', error);
      return { success: false, error: String(error) };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
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
  try {
    const { data, error } = await api.api.projects.post(params);

    if (error) {
      console.error('Failed to create project:', error);
      return { success: false, error: String(error) };
    }

    // Refresh projects list
    await fetchProjects();

    return { success: true, data: data?.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
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
  try {
    const { data, error } = await api.api.projects({ id: projectId }).patch(params);

    if (error) {
      console.error('Failed to update project:', error);
      return { success: false, error: String(error) };
    }

    // Refresh projects list
    await fetchProjects();

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await api.api.projects({ id: projectId }).delete();

    if (error) {
      console.error('Failed to delete project:', error);
      return { success: false, error: String(error) };
    }

    // Refresh projects list
    await fetchProjects();

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
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

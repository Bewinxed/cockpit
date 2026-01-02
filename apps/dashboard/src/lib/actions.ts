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
 * Extract a human-readable error message from various error types
 * Handles Eden Treaty error format: { value: {...}, status: number, headers: {...} }
 */
function extractErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';

  // If it's already a string, return it
  if (typeof error === 'string') return error;

  // If it's an Error instance
  if (error instanceof Error) return error.message;

  // If it's an object, try to extract message
  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;

    // Eden Treaty format: { value: { success: false, error: "..." }, status: 400 }
    // Check this FIRST since it's the most common format
    if (errObj.value && typeof errObj.value === 'object') {
      const valueObj = errObj.value as Record<string, unknown>;
      if (typeof valueObj.error === 'string') return valueObj.error;
      if (typeof valueObj.message === 'string') return valueObj.message;
      // Check for nested details
      if (typeof valueObj.details === 'string') return valueObj.details;
      // Elysia validation format
      if (typeof valueObj.summary === 'string') return valueObj.summary;
    }

    // Elysia validation error format (not wrapped in value)
    if (errObj.type === 'validation' && typeof errObj.summary === 'string') {
      return errObj.summary;
    }

    // Try common error message properties
    if (typeof errObj.message === 'string') return errObj.message;
    if (typeof errObj.error === 'string') return errObj.error;
    if (typeof errObj.statusText === 'string') return errObj.statusText;
    if (typeof errObj.summary === 'string') return errObj.summary;

    // Check for HTTP status and provide meaningful message
    if (typeof errObj.status === 'number') {
      const status = errObj.status;
      // Try to get error from value first
      if (errObj.value && typeof errObj.value === 'object') {
        const val = errObj.value as Record<string, unknown>;
        if (typeof val.error === 'string') return val.error;
      }
      if (status === 400) return 'Bad request - please check your input';
      if (status === 401) return 'Authentication required';
      if (status === 403) return 'Access denied';
      if (status === 404) return 'Resource not found';
      if (status === 500) return 'Server error - please try again';
      if (status >= 400) return `Request failed with status ${status}`;
    }

    // Last resort: try to stringify but limit length
    try {
      const str = JSON.stringify(error, null, 0);
      if (str !== '{}' && str.length < 200) return str;
      if (str !== '{}') return str.slice(0, 200) + '...';
    } catch {
      // Ignore stringify errors
    }
  }

  return 'An unexpected error occurred';
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
      const errorMsg = extractErrorMessage(error);
      console.error('Failed to spawn instance:', errorMsg, '| Raw error:', error);
      return {
        success: false,
        error: errorMsg,
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
    return {
      success: false,
      error: extractErrorMessage(err),
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
      const errorMsg = extractErrorMessage(error);
      console.error('Failed to stop instance:', errorMsg, '| Raw error:', error);
      return { success: false, error: errorMsg };
    }

    // Refresh instances list
    await fetchInstances();

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Send a message to an instance
 */
export async function sendMessage(
  instanceId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await api.api.instances({ id: instanceId }).send.post({ message: content });

    if (error) {
      console.log('Raw error object:', error);
      console.log('Error type:', typeof error);
      console.log('Error keys:', Object.keys(error));
      const errorMsg = extractErrorMessage(error);
      console.error('Extracted message:', errorMsg);
      return { success: false, error: errorMsg };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
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
      return { success: false, error: extractErrorMessage(error) };
    }

    // Refresh projects list
    await fetchProjects();

    return { success: true, data: data?.data };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
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
      return { success: false, error: extractErrorMessage(error) };
    }

    // Refresh projects list
    await fetchProjects();

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
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
      return { success: false, error: extractErrorMessage(error) };
    }

    // Refresh projects list
    await fetchProjects();

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
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

/**
 * Remote functions for SSR data loading
 *
 * These run on the server and are called from components.
 * Features:
 * - Type-safe server calls via query/command
 * - Automatic caching with .refresh() support
 * - Batch queries to avoid N+1 problems
 * - Error handling via .error property
 * - Loading states via .loading property
 *
 * IMPORTANT: Only remote functions can be exported from .remote.ts files.
 * Types and helpers are in ./remote-types.ts
 */
import { query } from '$app/server';
import { env } from '$env/dynamic/private';
import * as v from 'valibot';
import type { CanonicalMessage } from '@agentdeck/core/dashboard';

// Types re-exported from remote-types.ts for external consumers
// (but types CAN be used internally here)
import type { AgentData, InstanceData, ProjectData, InstanceMessage } from './remote-types';

// Use $env for type-safe server-only env access
const HUB_URL = env.HUB_URL || 'http://localhost:3456';

// ============================================
// Internal Fetch Helpers (not exported)
// ============================================

async function fetchFromHub<T>(path: string): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(`${HUB_URL}/api/${path}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Hub returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.success && data.data) {
      return data.data as T[];
    }

    // API returned success:false
    throw new Error(data.error || 'Unknown API error');
  } catch (error) {
    clearTimeout(timeout);

    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request to ${path} timed out`);
    }

    throw error;
  }
}

async function fetchOneFromHub<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${HUB_URL}/api/${path}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Not found is not an error for single-item fetches
      }
      throw new Error(`Hub returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.success ? (data.data as T) : null;
  } catch (error) {
    clearTimeout(timeout);

    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request to ${path} timed out`);
    }

    throw error;
  }
}

async function postToHub<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${HUB_URL}/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Hub returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.success && data.data) {
      return data.data as T;
    }

    throw new Error(data.error || 'Unknown API error');
  } catch (error) {
    clearTimeout(timeout);

    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request to ${path} timed out`);
    }

    throw error;
  }
}

// ============================================
// Query Functions (Zero-argument)
// ============================================

/**
 * Get all agents.
 * Usage:
 *   const agents = getAgents();
 *   {#if agents.loading}Loading...{/if}
 *   {#if agents.error}Error: {agents.error.message}{/if}
 *   {#each agents.current ?? [] as agent}...{/each}
 */
export const getAgents = query(async () => {
  return fetchFromHub<AgentData>('agents');
});

/**
 * Get all instances.
 */
export const getInstances = query(async () => {
  return fetchFromHub<InstanceData>('instances');
});

/**
 * Get all projects.
 */
export const getProjects = query(async () => {
  return fetchFromHub<ProjectData>('projects');
});

// ============================================
// Query Functions (Parameterized)
// ============================================

/**
 * Get a single instance by ID.
 */
export const getInstance = query(v.string(), async (id) => {
  return fetchOneFromHub<InstanceData>(`instances/${id}`);
});

/**
 * Get messages for a single instance.
 * For multiple instances, use getInstanceMessagesBatch instead.
 */
export const getInstanceMessages = query(v.string(), async (id) => {
  return fetchFromHub<InstanceMessage>(`instances/${id}/messages`);
});

// ============================================
// Batch Query Functions (N+1 Prevention)
// ============================================

/**
 * Batch fetch messages for multiple instances in a single HTTP request.
 *
 * When multiple tabs/components call this with different instance IDs
 * within the same macrotask, SvelteKit batches them into one request.
 *
 * Usage:
 *   // These three calls become ONE HTTP request:
 *   const msgs1 = getInstanceMessagesBatch(id1);
 *   const msgs2 = getInstanceMessagesBatch(id2);
 *   const msgs3 = getInstanceMessagesBatch(id3);
 */
export const getInstanceMessagesBatch = query.batch(
  v.string(),
  async (instanceIds) => {
    // All IDs from the same macrotask arrive here as an array
    const batchResult = await postToHub<Record<string, InstanceMessage[]>>(
      'instances/batch/messages',
      { instanceIds, limit: 100 }
    );

    // Return a resolver function that maps each ID to its messages
    return (instanceId: string) => batchResult[instanceId] ?? [];
  }
);

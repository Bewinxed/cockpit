/**
 * Remote functions for SSR data loading
 * These run on the server and are called from components
 */
import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import type { CanonicalMessage } from '@agentdeck/core/dashboard';

const HUB_URL = process.env.HUB_URL || 'http://localhost:3456';

interface AgentData {
  machineId: string;
  hostname?: string;
  os?: string;
  status: 'online' | 'offline' | 'reconnecting';
  tailscaleIp?: string;
  connectedAt?: string;
  lastPing?: string;
}

interface InstanceData {
  id: string;
  lastPrompt?: string;
  status: string;
  machineId: string;
  projectId?: string;
  createdAt?: string;
  cwd: string;
  model?: string;
  totalCostUsd?: number;
  viewMode?: 'flow' | 'chat';
}

interface ProjectData {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  machineId?: string;
  createdAt: string;
  updatedAt: string;
}

type InstanceMessage = CanonicalMessage;

async function fetchFromHub<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${HUB_URL}/api/${path}`);
    if (!response.ok) {
      console.error(`[Remote] Failed to fetch ${path}: ${response.status}`);
      return [];
    }
    const data = await response.json();
    if (data.success && data.data) {
      return data.data as T[];
    }
    return [];
  } catch (error) {
    console.error(`[Remote] Error fetching ${path}:`, error);
    return [];
  }
}

async function fetchOneFromHub<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${HUB_URL}/api/${path}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.success ? (data.data as T) : null;
  } catch {
    return null;
  }
}

// Zero-argument queries for lists
export const getAgents = query(async () => {
  return fetchFromHub<AgentData>('agents');
});

export const getInstances = query(async () => {
  return fetchFromHub<InstanceData>('instances');
});

export const getProjects = query(async () => {
  return fetchFromHub<ProjectData>('projects');
});

// Parameterized queries for single items
export const getInstance = query(
  v.string(),
  async (id) => {
    return fetchOneFromHub<InstanceData>(`instances/${id}`);
  }
);

export const getInstanceMessages = query(
  v.string(),
  async (id) => {
    return fetchFromHub<InstanceMessage>(`instances/${id}/messages`);
  }
);

/**
 * Preload messages for all open tabs (from URL query params).
 * Returns a map of instanceId -> messages[]
 */
export const getTabMessages = query(async () => {
  // Must call getRequestEvent synchronously (before any await)
  const event = getRequestEvent();
  const tabsParam = event.url.searchParams.get('tabs');
  const tabIds = tabsParam ? tabsParam.split(',').filter(Boolean) : [];

  if (tabIds.length === 0) {
    return {} as Record<string, InstanceMessage[]>;
  }

  // Fetch messages for all tabs in parallel
  const results = await Promise.all(
    tabIds.map(async (id) => {
      const messages = await fetchFromHub<InstanceMessage>(`instances/${id}/messages`);
      return { id, messages };
    })
  );

  // Convert to map
  const messagesMap: Record<string, InstanceMessage[]> = {};
  for (const { id, messages } of results) {
    messagesMap[id] = messages;
  }
  return messagesMap;
});

/**
 * Types for remote functions.
 *
 * These are separated from data.remote.ts because .remote.ts files
 * can ONLY export remote functions (query/command/form).
 */
import type { CanonicalMessage } from '@agentdeck/core/dashboard';

// ============================================
// Data Types
// ============================================

export interface AgentData {
  machineId: string;
  hostname?: string;
  os?: string;
  status: 'online' | 'offline' | 'reconnecting';
  tailscaleIp?: string;
  connectedAt?: string;
  lastPing?: string;
}

export interface InstanceData {
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

export interface ProjectData {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  machineId?: string;
  createdAt: string;
  updatedAt: string;
}

export type InstanceMessage = CanonicalMessage;

// ============================================
// Error Types
// ============================================

/**
 * Error thrown when fetching from the hub fails.
 * Note: This is NOT exported from the .remote.ts file because only
 * remote functions can be exported from those files.
 */
export class RemoteFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly path?: string
  ) {
    super(message);
    this.name = 'RemoteFetchError';
  }
}

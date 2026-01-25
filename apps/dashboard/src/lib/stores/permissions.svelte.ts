import { SvelteMap } from 'svelte/reactivity';
import type { PermissionRequest } from './types';
import type { PermissionRequestEvent } from '@agentdeck/core/dashboard';

/**
 * Permission store - manages pending permission requests.
 * Uses SvelteMap for reactive mutations without reassignment.
 */
class PermissionStore {
  #permissions = $state(new SvelteMap<string, PermissionRequest>());

  /** Get the underlying map (read-only access for iteration) */
  get all() {
    return this.#permissions;
  }

  /** Get permission count */
  get size() {
    return this.#permissions.size;
  }

  /** Derived: all permissions as array, sorted by newest first */
  readonly sorted = $derived(
    Array.from(this.#permissions.values()).sort((a, b) => b.createdAt - a.createdAt)
  );

  /** Derived: count for badge display */
  readonly count = $derived(this.#permissions.size);

  // ========================================
  // Mutations
  // ========================================

  /** Add a permission request */
  add(request: PermissionRequest): void {
    this.#permissions.set(request.requestId, request);
  }

  /** Get a permission request by ID */
  get(requestId: string): PermissionRequest | undefined {
    return this.#permissions.get(requestId);
  }

  /** Check if a permission request exists */
  has(requestId: string): boolean {
    return this.#permissions.has(requestId);
  }

  /** Remove a permission request (after approval/denial) */
  remove(requestId: string): boolean {
    return this.#permissions.delete(requestId);
  }

  /** Clear all permissions */
  clear(): void {
    this.#permissions.clear();
  }

  /** Get permissions for a specific instance */
  getByInstance(instanceId: string): PermissionRequest[] {
    return Array.from(this.#permissions.values()).filter(p => p.instanceId === instanceId);
  }

  /** Check if an instance has pending permissions */
  hasPendingForInstance(instanceId: string): boolean {
    for (const p of this.#permissions.values()) {
      if (p.instanceId === instanceId) return true;
    }
    return false;
  }

  // ========================================
  // WebSocket Event Handlers
  // ========================================

  /** Handle permission:request WebSocket event */
  handleRequest(event: PermissionRequestEvent): void {
    this.#permissions.set(event.requestId, {
      requestId: event.requestId,
      instanceId: event.instanceId,
      machineId: event.machineId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      toolUseID: event.toolUseID,
      decisionReason: event.decisionReason,
      blockedPath: event.blockedPath,
      subAgentID: event.subAgentID,
      suggestions: event.suggestions,
      createdAt: event.createdAt,
    });
  }
}

// Singleton with HMR persistence
function createPermissionStore(): PermissionStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__agentdeckPermissionStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__agentdeckPermissionStore;
  }
  const store = new PermissionStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__agentdeckPermissionStore = store;
  return store;
}

export const permissions = createPermissionStore();

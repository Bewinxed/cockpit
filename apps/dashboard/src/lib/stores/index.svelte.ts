/**
 * Store facade — re-exports entity stores and provides WebSocket connection management.
 *
 * This is the main entry point for store access. Import from here, not individual files.
 *
 * Usage:
 *   import { agents, instances, ui, stores } from '$lib/stores';
 *   // For cross-store derivations:
 *   const populated = stores.populatedInstances; // reactive
 */

// Re-export types
export type {
  Agent,
  Instance, Message,
  MessageMetadata, PermissionRequest, Project, ProjectGroup, SidebarFilter,
  SidebarFilterState, SplitViewState, StreamingMessage, StreamingState, SubagentState, Task
} from './types';

// Re-export dashboard event types from core
export type {
  AgentConnectedEvent,
  AgentDisconnectedEvent,
  AgentReconnectingEvent,
  AgentUpdatedEvent,
  DashboardEventMap,
  DashboardEventPayload,
  DashboardEventType,
  InstanceCreatedEvent,
  InstanceErrorEvent,
  InstanceModelChangedEvent,
  InstanceResumedEvent,
  InstanceSleepingEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceTokenUsageEvent,
  MessageCreatedEvent,
  MessageStreamEvent,
  PermissionRequestEvent,
  ProjectCreatedEvent,
  ProjectDeletedEvent,
  ProjectUpdatedEvent,
  QuestionRequestEvent,
  TaskCompletedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
} from '@agentdeck/core/dashboard';

// Re-export entity stores
export { agents } from './agents.svelte';
export { instances } from './instances.svelte';
export { permissions } from './permissions.svelte';
export { projects } from './projects.svelte';
export { questions } from './questions.svelte';
export { tasks } from './tasks.svelte';
export { ui } from './ui.svelte';

// Re-export cross-store derivations
export { stores } from './derived.svelte';

// Re-export message handlers
export { handleMessageCreated, handleMessageStream } from './sdk-message-handler';

// Import stores for WebSocket event wiring
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { permissions } from './permissions.svelte';
import { projects } from './projects.svelte';
import { questions } from './questions.svelte';
import { handleMessageCreated, handleMessageStream } from './sdk-message-handler';
import { tasks } from './tasks.svelte';

// river.ts — use pre-built schema and WebSocket adapter from core
import { RiverSocketAdapter } from 'river.ts/websocket';
import { dashboardEvents } from '@agentdeck/core/dashboard';

// ============================================
// WEBSOCKET CONNECTION
// ============================================

// Connection state (reactive)
export const connection = $state({
  status: 'disconnected' as 'connecting' | 'connected' | 'disconnected' | 'error'
});

// HMR-persistent client references
declare global {
  var __wsSocket: WebSocket | null;
  var __wsAdapter: RiverSocketAdapter<typeof dashboardEvents> | null;
  var __wsReconnectTimeout: ReturnType<typeof setTimeout> | null;
  var __wsReconnectAttempts: number;
  var __wsBaseUrl: string;
  var __wsDisposing: boolean;
}
globalThis.__wsSocket ??= null;
globalThis.__wsAdapter ??= null;
globalThis.__wsReconnectTimeout ??= null;
globalThis.__wsReconnectAttempts ??= 0;
globalThis.__wsBaseUrl ??= '';
globalThis.__wsDisposing ??= false;

// HMR: Invalidate stale adapter on module reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Flag to prevent ws.onclose from triggering reconnect during HMR
    globalThis.__wsDisposing = true;
    if (globalThis.__wsReconnectTimeout) {
      clearTimeout(globalThis.__wsReconnectTimeout);
      globalThis.__wsReconnectTimeout = null;
    }
    if (globalThis.__wsSocket) {
      // Null out handlers before closing to prevent orphan onclose/onmessage callbacks
      globalThis.__wsSocket.onclose = null;
      globalThis.__wsSocket.onmessage = null;
      globalThis.__wsSocket.onerror = null;
      globalThis.__wsSocket.close();
      globalThis.__wsSocket = null;
    }
    if (globalThis.__wsAdapter) {
      globalThis.__wsAdapter.clearPendingRequests();
      globalThis.__wsAdapter = null;
    }
  });
}

// ============================================
// WEBSOCKET EVENT HANDLERS
// ============================================

function setupEventHandlers(adapter: RiverSocketAdapter<typeof dashboardEvents>): void {
  // Agent events
  adapter.on('agent:connected', (data) => agents.handleConnected(data));
  adapter.on('agent:disconnected', (data) => agents.handleDisconnected(data));
  adapter.on('agent:reconnecting', (data) => agents.handleReconnecting(data));
  adapter.on('agent:updated', (data) => agents.handleUpdated(data));

  // Instance events
  adapter.on('instance:created', (data) => instances.handleCreated(data));
  adapter.on('instance:started', (data) => instances.handleStarted(data));
  adapter.on('instance:stopped', (data) => instances.handleStopped(data));
  adapter.on('instance:sleeping', (data) => instances.handleSleeping(data));
  adapter.on('instance:error', (data) => {
    instances.handleError(data);
    if (data.error) {
      // Detect invalid session errors — show special recoverable error
      const isSessionError = data.error.includes('No conversation found with session ID');
      instances.addMessage(data.instanceId, {
        type: isSessionError ? 'ui.session_error' : 'ui.error',
        content: isSessionError
          ? 'The previous session could not be found. This can happen when session data was lost or corrupted.'
          : data.error,
        timestamp: new Date(),
        metadata: isSessionError ? { originalError: data.error } : undefined,
      });
    }
  });
  adapter.on('instance:resumed', (data) => instances.handleResumed(data));
  adapter.on('instance:token_usage', (data) => instances.handleTokenUsage(data));
  adapter.on('instance:model-changed', (data) => instances.handleModelChanged(data));
  adapter.on('instance:viewMode-changed', (data) => instances.handleViewModeChanged(data));
  adapter.on('instance:thinking-changed', (data) => instances.handleThinkingChanged(data));
  adapter.on('instance:turn', (data) => instances.handleTurnEvent(data));

  // Canonical messages + streaming events
  adapter.on('message:created', (data) => handleMessageCreated(data));
  adapter.on('message:stream', (data) => handleMessageStream(data));
  adapter.on('sdk:message', (data) => instances.handleSdkMessage(data));

  // Task events
  adapter.on('task:created', (data) => tasks.handleCreated(data));
  adapter.on('task:updated', (data) => tasks.handleUpdated(data));
  adapter.on('task:completed', (data) => tasks.handleCompleted(data));

  // Permission events
  adapter.on('permission:request', (data) => permissions.handleRequest(data));

  // Question events
  adapter.on('question:request', (data) => questions.handleRequest(data));

  // Project events
  adapter.on('project:created', (data) => projects.handleCreated(data));
  adapter.on('project:updated', (data) => projects.handleUpdated(data));
  adapter.on('project:deleted', (data) => projects.handleDeleted(data));

  // Connection confirmation from server
  adapter.on('connected', (data) => {
    connection.status = 'connected';
    globalThis.__wsReconnectAttempts = 0;
    console.log('[WS] Connected to hub, clientId:', data.clientId);
  });
}

// ============================================
// WEBSOCKET CONNECTION FUNCTIONS
// ============================================

/**
 * Connect to WebSocket and wire handlers via river.ts adapter.
 */
export function setupWSAndConnect(baseUrl: string = ''): void {
  globalThis.__wsBaseUrl = baseUrl;
  globalThis.__wsDisposing = false;

  // Cancel any pending reconnect to prevent duplicate connections
  if (globalThis.__wsReconnectTimeout) {
    clearTimeout(globalThis.__wsReconnectTimeout);
    globalThis.__wsReconnectTimeout = null;
  }

  // Close existing connection (null out handlers first to prevent orphan callbacks)
  if (globalThis.__wsSocket) {
    globalThis.__wsSocket.onclose = null;
    globalThis.__wsSocket.onmessage = null;
    globalThis.__wsSocket.onerror = null;
    globalThis.__wsSocket.close();
    globalThis.__wsSocket = null;
  }
  if (globalThis.__wsAdapter) {
    globalThis.__wsAdapter.clearPendingRequests();
    globalThis.__wsAdapter = null;
  }

  connection.status = 'connecting';

  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const wsUrl = `${protocol}//${host}/ws/dashboard`;
  console.log('[WS] Connecting to:', wsUrl);

  const ws = new WebSocket(wsUrl);
  const adapter = new RiverSocketAdapter(dashboardEvents, { debug: false });

  setupEventHandlers(adapter);

  ws.onopen = () => {
    console.log('[WS] WebSocket opened');
  };

  ws.onmessage = (event) => {
    adapter.handleMessage(event.data);
  };

  ws.onclose = (event) => {
    console.log('[WS] WebSocket closed:', event.code, event.reason);
    connection.status = 'disconnected';
    adapter.clearPendingRequests();
    // Don't reconnect if we're being disposed by HMR or intentional disconnect
    if (!globalThis.__wsDisposing) {
      attemptReconnect();
    }
  };

  ws.onerror = (error) => {
    console.error('[WS] WebSocket error:', error);
    connection.status = 'error';
  };

  globalThis.__wsSocket = ws;
  globalThis.__wsAdapter = adapter;
}

function attemptReconnect(): void {
  const maxAttempts = 10;
  if (globalThis.__wsReconnectAttempts < maxAttempts) {
    const delay = Math.min(1000 * Math.pow(2, globalThis.__wsReconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${globalThis.__wsReconnectAttempts + 1}/${maxAttempts})`);
    globalThis.__wsReconnectTimeout = setTimeout(() => {
      globalThis.__wsReconnectAttempts++;
      setupWSAndConnect(globalThis.__wsBaseUrl);
    }, delay);
  } else {
    console.error('[WS] Max reconnect attempts reached');
    connection.status = 'error';
  }
}

export function disconnectWS(): void {
  globalThis.__wsDisposing = true;
  if (globalThis.__wsReconnectTimeout) {
    clearTimeout(globalThis.__wsReconnectTimeout);
    globalThis.__wsReconnectTimeout = null;
  }
  if (globalThis.__wsAdapter) {
    globalThis.__wsAdapter.clearPendingRequests();
    globalThis.__wsAdapter = null;
  }
  if (globalThis.__wsSocket) {
    globalThis.__wsSocket.onclose = null;
    globalThis.__wsSocket.onmessage = null;
    globalThis.__wsSocket.onerror = null;
    globalThis.__wsSocket.close();
    globalThis.__wsSocket = null;
  }
  connection.status = 'disconnected';
}

export function reconnectWS(): void {
  disconnectWS();
  globalThis.__wsReconnectAttempts = 0;
  setupWSAndConnect(globalThis.__wsBaseUrl);
}

// ============================================
// WEBSOCKET COMMANDS (RPC-style via river.ts)
// ============================================

import type {
  SpawnInstanceRequest,
  SpawnInstanceResponse,
  SendMessageRequest,
  SendMessageResponse,
  StopInstanceRequest,
  StopInstanceResponse,
  PermissionResponseRequest,
  PermissionResponseResponse,
  QuestionResponseRequest,
  QuestionResponseResponse,
  UpdateInstancePreferencesRequest,
  UpdateInstancePreferencesResponse,
  SetThinkingRequest,
  SetThinkingResponse,
} from '@agentdeck/core/dashboard';

export class WebSocketNotConnectedError extends Error {
  constructor() {
    super('WebSocket not connected');
    this.name = 'WebSocketNotConnectedError';
  }
}

function getConnectedWs(): { ws: WebSocket; adapter: RiverSocketAdapter<typeof dashboardEvents> } {
  const ws = globalThis.__wsSocket;
  const adapter = globalThis.__wsAdapter;

  if (!ws || ws.readyState !== WebSocket.OPEN || !adapter) {
    throw new WebSocketNotConnectedError();
  }

  return { ws, adapter };
}

export async function spawnInstance(params: SpawnInstanceRequest): Promise<SpawnInstanceResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.spawn', params, (msg) => ws.send(msg), 30000);
}

export async function sendInstanceMessage(params: SendMessageRequest): Promise<SendMessageResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.send', params, (msg) => ws.send(msg), 30000);
}

export async function stopInstance(params: StopInstanceRequest): Promise<StopInstanceResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.stop', params, (msg) => ws.send(msg), 30000);
}

export async function sendPermissionResponse(params: PermissionResponseRequest): Promise<PermissionResponseResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('permission.response', params, (msg) => ws.send(msg), 30000);
}

export async function sendQuestionResponse(params: QuestionResponseRequest): Promise<QuestionResponseResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('question.response', params, (msg) => ws.send(msg), 30000);
}

export async function updateInstancePreferences(params: UpdateInstancePreferencesRequest): Promise<UpdateInstancePreferencesResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.updatePreferences', params, (msg) => ws.send(msg), 30000);
}

export async function setInstanceThinking(params: SetThinkingRequest): Promise<SetThinkingResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.setThinking', params, (msg) => ws.send(msg), 30000);
}

// ============================================
// SSR INITIALIZATION
// ============================================

/**
 * Initialize all stores from SSR-loaded data.
 * Called in +layout.svelte after query() functions return.
 */
export function initializeFromSSR(
  agentsData: Array<{
    machineId: string;
    hostname?: string;
    os?: string;
    status: 'online' | 'offline' | 'reconnecting';
    tailscaleIp?: string;
    connectedAt?: string;
    lastPing?: string;
  }>,
  instancesData: Array<{
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
  }>,
  projectsData: Array<{
    id: string;
    name: string;
    description?: string;
    rootPath?: string;
    machineId?: string;
    createdAt: string;
    updatedAt: string;
  }>
): void {
  agents.initializeFromSSR(agentsData);
  instances.initializeFromSSR(instancesData);
  projects.initializeFromSSR(projectsData);
}

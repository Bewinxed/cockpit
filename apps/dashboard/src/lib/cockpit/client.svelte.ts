/**
 * The browser end of the Envelope spine: one WebSocket to the hub, the frames
 * it returns folded into per-instance UI state (NEW.md §6).
 */
import type {
  ControlPayload,
  Envelope,
  FramePayload,
  PermissionResult,
  PermissionUpdate,
  SendPayload,
  SpawnPayload,
  StopPayload,
} from '@cockpit/core';
import { RESOLVE_PERMISSION } from '@cockpit/core';
import type { Message } from '$lib/stores/types';
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_ATTEMPTS, WS_RECONNECT_MAX_DELAY } from '$lib/config';
import { applyToolResult, errorMessage, localUserMessage, mapFrame } from './frames';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** A machine from the hub registry (`GET /api/agents`). */
export interface Machine {
  machineId: string;
  hostname: string;
  os: string;
  status: string;
  lastSeenAt: string;
}

/** A session the hub knows about (`GET /api/instances`). */
export interface InstanceRow {
  id: string;
  machineId: string;
  cwd: string;
  status: string;
  sessionId: string | null;
}

export interface PendingPermission {
  requestId: string;
  instanceId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
}

/** Everything one session view needs. */
export interface SessionState {
  instanceId: string;
  machineId: string;
  cwd: string;
  messages: Message[];
  pending: PendingPermission[];
  /** Partial assistant text, between `stream_event`s and the final message. */
  streaming: string;
  /** A turn is in flight (sent, no `result` yet). */
  busy: boolean;
  /** The `system.init` banner is re-emitted every turn; render it once. */
  initialized: boolean;
}

const state = $state({
  status: 'disconnected' as ConnectionStatus,
  machines: [] as Machine[],
  instances: [] as InstanceRow[],
  sessions: {} as Record<string, SessionState>,
});

// HMR-persistent socket references, so a module reload never leaves an orphan.
declare global {
  var __cockpitSocket: WebSocket | null;
  var __cockpitReconnectTimeout: ReturnType<typeof setTimeout> | null;
  var __cockpitReconnectAttempts: number;
  var __cockpitDisposing: boolean;
}
globalThis.__cockpitSocket ??= null;
globalThis.__cockpitReconnectTimeout ??= null;
globalThis.__cockpitReconnectAttempts ??= 0;
globalThis.__cockpitDisposing ??= false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    globalThis.__cockpitDisposing = true;
    teardown();
  });
}

function teardown(): void {
  if (globalThis.__cockpitReconnectTimeout) {
    clearTimeout(globalThis.__cockpitReconnectTimeout);
    globalThis.__cockpitReconnectTimeout = null;
  }
  const socket = globalThis.__cockpitSocket;
  if (!socket) return;
  // Null the handlers first, or the close fires a reconnect we just cancelled.
  socket.onclose = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.close();
  globalThis.__cockpitSocket = null;
}

function session(instanceId: string): SessionState {
  const existing = state.sessions[instanceId];
  if (existing) return existing;

  const created: SessionState = {
    instanceId,
    machineId: '',
    cwd: '',
    messages: [],
    pending: [],
    streaming: '',
    busy: false,
    initialized: false,
  };
  state.sessions[instanceId] = created;
  return created;
}

/** Fills in what the registry knows about a session this browser did not spawn. */
function hydrate(target: SessionState): void {
  if (target.machineId) return;
  const known = state.instances.find((row) => row.id === target.instanceId);
  if (!known) return;
  target.machineId = known.machineId;
  target.cwd = known.cwd;
}

/** Opens a session's view state — the route's half of arriving at `/session/[id]`. */
export function openSession(instanceId: string): void {
  hydrate(session(instanceId));
}

async function load<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } catch (error) {
    console.error(`[cockpit] ${path} failed:`, error);
    return null;
  }
}

/** Registry reads: on connect and again after every reconnect. */
async function refresh(): Promise<void> {
  const [machines, instances, pending] = await Promise.all([
    load<Machine[]>('/api/agents'),
    load<InstanceRow[]>('/api/instances'),
    load<Envelope<FramePayload>[]>('/api/pending'),
  ]);

  if (machines) state.machines = machines;
  if (instances) {
    state.instances = instances;
    for (const target of Object.values(state.sessions)) hydrate(target);
  }
  if (pending) {
    for (const envelope of pending) handleFrame(envelope.payload);
  }
}

function handleFrame(frame: FramePayload): void {
  if (frame.kind === 'error') {
    const { instanceId, message } = frame;
    if (instanceId) session(instanceId).messages.push(errorMessage(instanceId, message));
    else console.error('[cockpit] hub error:', message);
    return;
  }

  const target = session(frame.instanceId);

  switch (frame.kind) {
    case 'sdk': {
      const mapping = mapFrame(frame.instanceId, frame.message);
      for (const message of mapping.messages) {
        if (message.type === 'system.init') {
          if (target.initialized) continue;
          target.initialized = true;
        }
        target.messages.push(message);
      }
      for (const result of mapping.toolResults) applyToolResult(target.messages, result);
      if (mapping.delta) target.streaming += mapping.delta;
      if (mapping.clearsStream) target.streaming = '';
      if (mapping.endsTurn) target.busy = false;
      break;
    }

    case 'permission_request': {
      if (target.pending.some((p) => p.requestId === frame.requestId)) break;
      target.pending.push({
        requestId: frame.requestId,
        instanceId: frame.instanceId,
        toolName: frame.toolName,
        input: frame.input,
        suggestions: frame.suggestions,
      });
      break;
    }

    case 'control_result': {
      if (!frame.ok) {
        target.messages.push(errorMessage(frame.instanceId, frame.error ?? 'control call failed'));
      }
      break;
    }
  }
}

function send(envelope: Envelope): void {
  const socket = globalThis.__cockpitSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('not connected to the hub');
  }
  socket.send(JSON.stringify(envelope));
}

function scheduleReconnect(): void {
  if (globalThis.__cockpitReconnectAttempts >= WS_RECONNECT_MAX_ATTEMPTS) {
    console.error('[cockpit] max reconnect attempts reached');
    state.status = 'error';
    return;
  }
  const delay = Math.min(
    WS_RECONNECT_BASE_DELAY * 2 ** globalThis.__cockpitReconnectAttempts,
    WS_RECONNECT_MAX_DELAY
  );
  globalThis.__cockpitReconnectTimeout = setTimeout(() => {
    globalThis.__cockpitReconnectAttempts++;
    connect();
  }, delay);
}

function connect(): void {
  globalThis.__cockpitDisposing = false;
  teardown();
  state.status = 'connecting';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/dashboard`);

  socket.onopen = () => {
    state.status = 'connected';
    globalThis.__cockpitReconnectAttempts = 0;
    void refresh();
  };

  socket.onmessage = (event) => {
    const envelope = JSON.parse(String(event.data)) as Envelope<FramePayload>;
    if (envelope.verb !== 'frames') return;
    handleFrame(envelope.payload);
  };

  socket.onclose = () => {
    state.status = 'disconnected';
    if (!globalThis.__cockpitDisposing) scheduleReconnect();
  };

  socket.onerror = () => {
    state.status = 'error';
  };

  globalThis.__cockpitSocket = socket;
}

/** What routes call on mount: the socket is app-scoped, not page-scoped. */
export function ensureConnected(): void {
  const socket = globalThis.__cockpitSocket;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  connect();
}

function userMessage(text: string): SendPayload['message'] {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}

/** Starts a session on `machineId` and returns the id its route lives at. */
export function spawnSession({
  machineId,
  cwd,
  prompt,
}: {
  machineId: string;
  cwd: string;
  prompt?: string;
}): string {
  const instanceId = crypto.randomUUID();
  const payload: SpawnPayload = { instanceId, cwd, options: {} };
  send({ verb: 'spawn', machineId, instanceId, payload });

  const created = session(instanceId);
  created.machineId = machineId;
  created.cwd = cwd;

  if (prompt?.trim()) sendText(instanceId, machineId, prompt.trim());
  void refresh();
  return instanceId;
}

export function sendText(instanceId: string, machineId: string, text: string): void {
  const payload: SendPayload = { instanceId, message: userMessage(text) };
  send({ verb: 'send', machineId, instanceId, payload });

  const target = session(instanceId);
  target.messages.push(localUserMessage(instanceId, text));
  target.busy = true;
}

export function stopSession(instanceId: string, machineId: string): void {
  const payload: StopPayload = { instanceId };
  send({ verb: 'stop', machineId, instanceId, payload });
  session(instanceId).busy = false;
  void refresh();
}

function control(instanceId: string, machineId: string, method: string, args: unknown[]): void {
  const payload: ControlPayload = { instanceId, requestId: crypto.randomUUID(), method, args };
  send({ verb: 'control', machineId, instanceId, requestId: payload.requestId, payload });
}

export function interrupt(instanceId: string, machineId: string): void {
  control(instanceId, machineId, 'interrupt', []);
  session(instanceId).busy = false;
}

export function resolvePermission(
  instanceId: string,
  machineId: string,
  requestId: string,
  result: PermissionResult
): void {
  const payload: ControlPayload = {
    instanceId,
    requestId,
    method: RESOLVE_PERMISSION,
    args: [requestId, result],
  };
  send({ verb: 'control', machineId, instanceId, requestId, payload });

  const target = session(instanceId);
  target.pending = target.pending.filter((p) => p.requestId !== requestId);
}

export const cockpit = {
  get status() {
    return state.status;
  },
  get machines() {
    return state.machines;
  },
  get onlineMachines() {
    return state.machines.filter((machine) => machine.status === 'online');
  },
  get instances() {
    return state.instances;
  },
  get runningInstances() {
    return state.instances.filter((instance) => instance.status !== 'stopped');
  },
  session: (instanceId: string): SessionState | null => state.sessions[instanceId] ?? null,
};

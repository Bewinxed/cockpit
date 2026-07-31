/**
 * The browser end of the Envelope spine: one WebSocket to the hub, the frames
 * it returns folded into per-instance UI state (NEW.md §6).
 */
import type {
  ControlPayload,
  Envelope,
  FramePayload,
  Options,
  PermissionResult,
  PermissionUpdate,
  SDKSessionInfo,
  SendPayload,
  SessionMessage,
  SpawnPayload,
  StopPayload,
} from '@cockpit/core';
import { RESOLVE_PERMISSION } from '@cockpit/core';
import type { Message } from './types';
import {
  SESSION_CATALOG_LIMIT,
  WS_RECONNECT_BASE_DELAY,
  WS_RECONNECT_MAX_ATTEMPTS,
  WS_RECONNECT_MAX_DELAY,
} from '$lib/config';
import { applyToolResult, errorMessage, localUserMessage, mapFrame, mapTranscript } from './frames';

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

/** Everything one session view needs — live or browsed from storage. */
export interface SessionState {
  /** The id this view lives at: a spawned instance, or the SDK session browsed. */
  instanceId: string;
  machineId: string;
  cwd: string;
  /** The SDK session behind this view, once one is known. */
  sessionId: string | null;
  messages: Message[];
  pending: PendingPermission[];
  /** Partial assistant text, between `stream_event`s and the final message. */
  streaming: string;
  /** A turn is in flight (sent, no `result` yet). */
  busy: boolean;
  /** A stored transcript is being fetched. */
  loading: boolean;
  /** The `system.init` banner is re-emitted every turn; render it once. */
  initialized: boolean;
}

const state = $state({
  status: 'disconnected' as ConnectionStatus,
  machines: [] as Machine[],
  instances: [] as InstanceRow[],
  sessions: {} as Record<string, SessionState>,
  /** Stored sessions per machine, newest first (`listSessions` through the tunnel). */
  catalog: {} as Record<string, SDKSessionInfo[]>,
});

interface Waiter {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** Control calls awaiting their `control_result`, keyed by the SDK `requestId`. */
const inflight = new Map<string, Waiter>();

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

function abandonInflight(reason: string): void {
  for (const waiter of inflight.values()) waiter.reject(new Error(reason));
  inflight.clear();
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
  abandonInflight('connection closed');
}

function session(instanceId: string): SessionState {
  const existing = state.sessions[instanceId];
  if (existing) return existing;

  const created: SessionState = {
    instanceId,
    machineId: '',
    cwd: '',
    sessionId: null,
    messages: [],
    pending: [],
    streaming: '',
    busy: false,
    loading: false,
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
  target.sessionId = known.sessionId;
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

/** Every online machine's stored sessions — the sidebar's contents on arrival. */
async function refreshCatalogs(): Promise<void> {
  for (const machine of state.machines) {
    if (machine.status === 'online') void loadCatalog(machine.machineId);
  }
}

/** Answers the promise a `requestId` belongs to; false when nobody is waiting. */
function settle(requestId: string | undefined, answer: (waiter: Waiter) => void): boolean {
  if (!requestId) return false;
  const waiter = inflight.get(requestId);
  if (!waiter) return false;
  inflight.delete(requestId);
  answer(waiter);
  return true;
}

function handleFrame(frame: FramePayload): void {
  if (frame.kind === 'error') {
    const { instanceId, message } = frame;
    if (settle(frame.requestId, (waiter) => waiter.reject(new Error(message)))) return;
    if (instanceId) session(instanceId).messages.push(errorMessage(instanceId, message));
    else console.error('[cockpit] hub error:', message);
    return;
  }

  if (frame.kind === 'control_result') {
    const answered = settle(frame.requestId, (waiter) =>
      frame.ok
        ? waiter.resolve(frame.result)
        : waiter.reject(new Error(frame.error ?? 'control call failed'))
    );
    if (answered) return;
    // Fire-and-forget controls (interrupt, permission replies) still report failure.
    if (!frame.ok && frame.instanceId) {
      session(frame.instanceId).messages.push(
        errorMessage(frame.instanceId, frame.error ?? 'control call failed')
      );
    }
    return;
  }

  const target = session(frame.instanceId);

  switch (frame.kind) {
    case 'sdk': {
      const mapping = mapFrame(frame.instanceId, frame.message);
      for (const message of mapping.messages) {
        if (message.type === 'system.init') {
          target.sessionId = message.metadata?.sessionId ?? target.sessionId;
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
    void refresh().then(refreshCatalogs);
  };

  socket.onmessage = (event) => {
    const envelope = JSON.parse(String(event.data)) as Envelope<FramePayload>;
    if (envelope.verb !== 'frames') return;
    handleFrame(envelope.payload);
  };

  socket.onclose = () => {
    state.status = 'disconnected';
    abandonInflight('connection lost');
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

/** Spawns a session on `machineId` and registers the view it streams into. */
function start(machineId: string, cwd: string, options: Options): SessionState {
  const instanceId = crypto.randomUUID();
  const payload: SpawnPayload = { instanceId, cwd, options };
  send({ verb: 'spawn', machineId, instanceId, payload });

  const created = session(instanceId);
  created.machineId = machineId;
  created.cwd = cwd;
  return created;
}

/** Starts a session on `machineId` and returns the id its route lives at. */
export function spawnSession({
  machineId,
  cwd,
  prompt,
  options = {},
}: {
  machineId: string;
  cwd: string;
  prompt?: string;
  options?: Options;
}): string {
  const created = start(machineId, cwd, options);
  if (prompt?.trim()) sendText(created.instanceId, machineId, prompt.trim());
  void refresh();
  return created.instanceId;
}

/**
 * Re-opens a stored session as a live one. The transcript already on screen is
 * seeded into the new view, so the conversation reads as one continuous thread.
 */
export function resumeSession({
  machineId,
  cwd,
  sessionId,
  history = [],
  options = {},
}: {
  machineId: string;
  cwd: string;
  sessionId: string;
  history?: Message[];
  options?: Options;
}): string {
  const created = start(machineId, cwd, { ...options, resume: sessionId });
  created.sessionId = sessionId;
  created.messages = history.map((message) => ({ ...message, instanceId: created.instanceId }));
  void refresh();
  return created.instanceId;
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

/**
 * A control call about the machine rather than a session — the SDK's module-level
 * session functions. The reply is correlated by `requestId`, which the hub routes
 * back to this socket alone.
 */
export function machineControl<T>(machineId: string, method: string, args: unknown[] = []): Promise<T> {
  const requestId = crypto.randomUUID();
  const payload: ControlPayload = { requestId, method, args };
  return new Promise<T>((resolve, reject) => {
    inflight.set(requestId, { resolve: resolve as (result: unknown) => void, reject });
    try {
      send({ verb: 'control', machineId, requestId, payload });
    } catch (error) {
      inflight.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** The machine's stored sessions, newest first. */
export async function loadCatalog(machineId: string): Promise<void> {
  try {
    state.catalog[machineId] = await machineControl<SDKSessionInfo[]>(machineId, 'listSessions', [
      { limit: SESSION_CATALOG_LIMIT },
    ]);
  } catch (error) {
    console.error(`[cockpit] listSessions on ${machineId} failed:`, error);
  }
}

/** Loads a stored session's transcript into the view it is being browsed under. */
export async function openTranscript({
  viewId,
  machineId,
  sessionId,
  cwd,
}: {
  viewId: string;
  machineId: string;
  sessionId: string;
  cwd: string;
}): Promise<void> {
  const target = session(viewId);
  target.machineId = machineId;
  target.cwd = cwd;
  target.sessionId = sessionId;
  if (target.messages.length > 0 || target.loading) return;

  target.loading = true;
  try {
    const transcript = await machineControl<SessionMessage[]>(machineId, 'getSessionMessages', [
      sessionId,
      { dir: cwd || undefined },
    ]);
    target.messages = mapTranscript(viewId, transcript);
  } catch (error) {
    target.messages = [
      errorMessage(viewId, `could not read transcript: ${error instanceof Error ? error.message : error}`),
    ];
  } finally {
    target.loading = false;
  }
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
  /** Live sessions on one machine — what the sidebar groups under it. */
  runningOn: (machineId: string): InstanceRow[] =>
    state.instances.filter((row) => row.machineId === machineId && row.status !== 'stopped'),
  /** Stored sessions on one machine, as `listSessions` returned them. */
  catalogOf: (machineId: string): SDKSessionInfo[] => state.catalog[machineId] ?? [],
  session: (instanceId: string): SessionState | null => state.sessions[instanceId] ?? null,
};

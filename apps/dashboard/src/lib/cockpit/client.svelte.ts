/**
 * The browser end of the Envelope spine: one WebSocket to the hub, the frames
 * it returns folded into per-instance UI state (NEW.md §6).
 */
import type {
  ControlPayload,
  Envelope,
  FramePayload,
  FsPayload,
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
import type { SubagentState } from '$lib/utils/flow-types';
import type { Activity } from './activity';
import { activityOf } from './activity';
import type { Message } from './types';
import {
  CONTROL_TIMEOUT_MS,
  DISCARD_TIMEOUT_MS,
  SESSION_CATALOG_LIMIT,
  WS_RECONNECT_BASE_DELAY,
  WS_RECONNECT_MAX_ATTEMPTS,
  WS_RECONNECT_MAX_DELAY,
} from '$lib/config';
import type { ToolGlance } from './frames';
import {
  applyBranchEvent,
  applyToolResult,
  branchFor,
  errorMessage,
  localUserMessage,
  mapFrame,
  mapTranscript,
} from './frames';

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
  /** Set when the session was started from a project page. */
  projectId?: string | null;
  /** `scratch` for a side quest; absent from a hub that predates the column. */
  kind?: string;
}

/** A project the hub knows about (`GET /api/projects`). */
export interface ProjectRow {
  id: string;
  machineId: string;
  name: string;
  cwd: string;
  createdAt: string;
}

/** Only a session the hub can still reach is live; the rest is history. */
const isLive = (row: InstanceRow): boolean =>
  row.status === 'running' || row.status === 'starting';

/**
 * A session whose daemon went away mid-flight. It may or may not still be alive
 * on its machine — the hub cannot tell — so it is kept, but never as a live row.
 */
const isStale = (row: InstanceRow): boolean => row.status === 'unknown';

/** A side quest's worktree sits under the project's checkout, so it counts as in it. */
const under = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

export interface PendingPermission {
  requestId: string;
  instanceId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
}

/** A permission parked anywhere in the fleet, with the context to act on it. */
export interface BlockedRequest {
  instanceId: string;
  machineId: string;
  hostname: string;
  cwd: string;
  request: PendingPermission;
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
  /** Subagent branches, keyed by the Task `tool_use_id` that spawned them. */
  subagents: Record<string, SubagentState>;
  pending: PendingPermission[];
  /** Partial assistant text, between `stream_event`s and the final message. */
  streaming: string;
  /** A turn is in flight (sent, no `result` yet). */
  busy: boolean;
  /** The main loop's tool in flight, cleared by its result or the turn's end. */
  currentTool: ToolGlance | null;
  lastActivityAt: Date | null;
  /** A stored transcript is being fetched. */
  loading: boolean;
  /** The `system.init` banner is re-emitted every turn; render it once. */
  initialized: boolean;
  /** A side quest (NEW.md §1) — kept visually apart until it is kept or discarded. */
  scratch: boolean;
  /** Spawned with `persistSession: false`: the SDK is writing no transcript for it. */
  ephemeral: boolean;
}

const state = $state({
  status: 'disconnected' as ConnectionStatus,
  machines: [] as Machine[],
  instances: [] as InstanceRow[],
  projects: [] as ProjectRow[],
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

/** Frames held back while a late-joined session reads its transcript, by instance. */
const backfilling = new Map<string, FramePayload[]>();
/** Instances whose transcript has been read back — it is only ever read once. */
const backfilled = new Set<string>();

// Lets the store be asserted from the console while developing.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(globalThis, { __cockpitDebug: { state, inflight } });
}

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
    subagents: {},
    pending: [],
    streaming: '',
    busy: false,
    currentTool: null,
    lastActivityAt: null,
    loading: false,
    initialized: false,
    scratch: false,
    ephemeral: false,
  };
  state.sessions[instanceId] = created;
  // Read it back: the literal above is the raw target, and `$state` writes land
  // on the proxy's signals, never on it. Handing out the raw object would give
  // callers a view the UI stops tracking the moment it first renders one.
  const target = state.sessions[instanceId];
  // A session this browser never opened — a permission replayed from `/api/pending`
  // is the usual way — still has to name its machine on the fleet view.
  hydrate(target);
  return target;
}

/** Fills in what the registry knows about a session this browser did not spawn. */
function hydrate(target: SessionState): void {
  if (target.machineId) return;
  const known = state.instances.find((row) => row.id === target.instanceId);
  if (!known) return;
  target.machineId = known.machineId;
  target.cwd = known.cwd;
  target.sessionId = known.sessionId;
  // The row records the kind, not the SDK option behind it — every side quest
  // this app spawns is ephemeral, so the row answers for both after a reload.
  target.scratch = known.kind === 'scratch';
  target.ephemeral = target.scratch;
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
  const [machines, instances, projects, pending] = await Promise.all([
    load<Machine[]>('/api/agents'),
    load<InstanceRow[]>('/api/instances'),
    load<ProjectRow[]>('/api/projects'),
    load<Envelope<FramePayload>[]>('/api/pending'),
  ]);

  if (machines) state.machines = machines;
  if (projects) state.projects = projects;
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

  // A backfill owns the transcript until it lands. Frames that arrive meanwhile
  // are held and replayed after it, so none is lost and none arrives twice.
  const held = backfilling.get(frame.instanceId);
  if (held) {
    held.push(frame);
    return;
  }

  switch (frame.kind) {
    case 'sdk': {
      const mapping = mapFrame(frame.instanceId, frame.message);
      if (mapping.branch) applyBranchEvent(target.subagents, frame.instanceId, mapping.branch);

      // A subagent's turns belong to its branch, not to the main transcript —
      // interleaving them is what buries the conversation the user is reading.
      const sink = mapping.agentId
        ? branchFor(target.subagents, frame.instanceId, mapping.agentId).messages
        : target.messages;

      for (const message of mapping.messages) {
        if (message.type === 'system.init') {
          target.sessionId = message.metadata?.sessionId ?? target.sessionId;
          if (target.initialized) continue;
          target.initialized = true;
        }
        sink.push(message);
      }
      for (const result of mapping.toolResults) applyToolResult(sink, result);

      if (mapping.currentTool) target.currentTool = mapping.currentTool;
      const answered = target.currentTool?.toolId;
      if (mapping.toolResults.some((result) => result.toolId === answered)) {
        target.currentTool = null;
      }
      if (mapping.delta) target.streaming += mapping.delta;
      if (mapping.clearsStream) target.streaming = '';
      if (mapping.endsTurn) {
        target.busy = false;
        target.currentTool = null;
      }
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

  target.lastActivityAt = new Date();
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
  // A navigation is a fresh user intent — earlier exhausted retries don't apply.
  globalThis.__cockpitReconnectAttempts = 0;
  connect();
}

/** Resolves once the app socket is OPEN, connecting it if needed. */
function waitForOpen(timeoutMs = 5000): Promise<void> {
  ensureConnected();
  const socket = globalThis.__cockpitSocket;
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const current = globalThis.__cockpitSocket;
      if (current && current.readyState === WebSocket.OPEN) return resolve();
      if (Date.now() > deadline) return reject(new Error('hub connection timed out'));
      setTimeout(poll, 100);
    };
    poll();
  });
}

function userMessage(text: string): SendPayload['message'] {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}

/** Spawns a session on `machineId` and registers the view it streams into. */
function start(
  machineId: string,
  cwd: string,
  options: Options,
  scratch?: SpawnPayload['scratch'],
  projectId?: string
): SessionState {
  const instanceId = crypto.randomUUID();
  const payload: SpawnPayload = { instanceId, cwd, options, scratch, projectId };
  send({ verb: 'spawn', machineId, instanceId, payload });

  const created = session(instanceId);
  created.machineId = machineId;
  created.cwd = cwd;
  created.ephemeral = options.persistSession === false;
  created.scratch = created.ephemeral || Boolean(scratch);
  return created;
}

/** Starts a session on `machineId` and returns the id its route lives at. */
export function spawnSession({
  machineId,
  cwd,
  prompt,
  options = {},
  scratch,
  projectId,
}: {
  machineId: string;
  cwd: string;
  prompt?: string;
  options?: Options;
  scratch?: SpawnPayload['scratch'];
  projectId?: string;
}): string {
  const created = start(machineId, cwd, options, scratch, projectId);
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

/**
 * Branches a side quest off a session (NEW.md §1): the same context, a new SDK
 * session, and nothing written to disk — a fork exists to be thrown away. The
 * transcript on screen is seeded so the branch reads on from where it left.
 */
export function forkSession({
  machineId,
  cwd,
  sessionId,
  history = [],
}: {
  machineId: string;
  cwd: string;
  sessionId: string;
  history?: Message[];
}): string {
  const created = start(machineId, cwd, {
    resume: sessionId,
    forkSession: true,
    persistSession: false,
  });
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

  settleStopped(instanceId);
  void refresh();
}

/**
 * Throws a side quest away: the session stops and the agent tears down whatever
 * the spawn created for it. Resolves once the agent confirms the teardown, so a
 * worktree that could not be removed is reported rather than silently left.
 */
export async function discardSession(instanceId: string, machineId: string): Promise<void> {
  const requestId = crypto.randomUUID();
  const payload: StopPayload = { instanceId, discard: true, requestId };
  settleStopped(instanceId);

  try {
    await ask<void>(requestId, 'discard', DISCARD_TIMEOUT_MS, () =>
      send({ verb: 'stop', machineId, instanceId, requestId, payload })
    );
  } finally {
    delete state.sessions[instanceId];
    await refresh();
  }
}

/** Promotes a side quest to mainline work — the UI stops setting it apart. */
export async function keepSession(instanceId: string): Promise<void> {
  const response = await fetch(`/api/instances/${instanceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'mainline' }),
  });
  if (!response.ok) throw new Error(`could not keep session: ${response.status}`);

  session(instanceId).scratch = false;
  await refresh();
}

/** The view state a session leaves behind once it is no longer running. */
function settleStopped(instanceId: string): void {
  const target = session(instanceId);
  target.busy = false;
  target.currentTool = null;
  // The agent denies whatever was parked as it tears the session down, so these
  // answer to nobody — leaving them would pin a dead session to the fleet rail.
  target.pending = [];
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
export async function machineControl<T>(
  machineId: string,
  method: string,
  args: unknown[] = [],
  replyTimeoutMs = CONTROL_TIMEOUT_MS
): Promise<T> {
  await waitForOpen();
  const requestId = crypto.randomUUID();
  const payload: ControlPayload = { requestId, method, args };
  return ask<T>(requestId, method, replyTimeoutMs, () =>
    send({ verb: 'control', machineId, requestId, payload })
  );
}

/**
 * The `fs` verb (NEW.md §6): a machine's files, for the docs rail and the light
 * markdown editing on top of it. Answered by `requestId` like a control call.
 */
export async function machineFs<T>(
  machineId: string,
  op: FsPayload['op'],
  path: string,
  content?: string
): Promise<T> {
  await waitForOpen();
  const requestId = crypto.randomUUID();
  const payload: FsPayload = { requestId, op, path, content };
  return ask<T>(requestId, `fs ${op} ${path}`, CONTROL_TIMEOUT_MS, () =>
    send({ verb: 'fs', machineId, requestId, payload })
  );
}

/** Names a machine + directory so it can be opened as a project home. */
export async function createProject(project: {
  name: string;
  cwd: string;
  machineId: string;
}): Promise<ProjectRow> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error(`could not save project: ${response.status}`);
  const created = (await response.json()) as ProjectRow;
  await refresh();
  return created;
}

/** Forgets the project; the sessions started from it stay, just unattached. */
export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`could not delete project: ${response.status}`);
  await refresh();
}

/** Sends something the agent answers by `requestId`, and waits for that answer. */
function ask<T>(
  requestId: string,
  label: string,
  timeoutMs: number,
  dispatch: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (inflight.delete(requestId)) reject(new Error(`${label} timed out`));
    }, timeoutMs);
    inflight.set(requestId, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      dispatch();
    } catch (error) {
      clearTimeout(timer);
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
    const { messages, subagents } = mapTranscript(viewId, transcript);
    target.messages = messages;
    target.subagents = subagents;
  } catch (error) {
    target.messages = [
      errorMessage(viewId, `could not read transcript: ${error instanceof Error ? error.message : error}`),
    ];
  } finally {
    target.loading = false;
  }
}

/**
 * Seeds a live session this browser joined late. Frames only carry what happens
 * from now on, so a session already under way renders as an empty transcript
 * until what it has already said is read back out of SDK session storage.
 */
export async function backfillSession(instanceId: string): Promise<void> {
  if (backfilled.has(instanceId) || backfilling.has(instanceId)) return;
  const target = session(instanceId);
  if (target.messages.length > 0 || target.loading) return;
  const { machineId, sessionId, cwd } = target;
  if (!machineId || !sessionId) return;

  backfilled.add(instanceId);
  backfilling.set(instanceId, []);
  target.loading = true;
  try {
    const transcript = await machineControl<SessionMessage[]>(machineId, 'getSessionMessages', [
      sessionId,
      { dir: cwd || undefined },
    ]);
    const { messages, subagents } = mapTranscript(instanceId, transcript);
    target.messages = messages;
    target.subagents = subagents;
    target.streaming = '';
    replayHeld(instanceId, new Set(transcript.map((entry) => entry.uuid)));
  } catch (error) {
    replayHeld(instanceId, new Set());
    console.error(`[cockpit] backfilling ${instanceId} failed:`, error);
  } finally {
    target.loading = false;
  }
}

/** Hands the held frames back to the store, minus what the transcript already had. */
function replayHeld(instanceId: string, seeded: Set<string>): void {
  const held = backfilling.get(instanceId) ?? [];
  backfilling.delete(instanceId);
  for (const frame of held) {
    if (frame.kind === 'sdk') {
      // A partial paints text whose final message may already be seeded. The
      // turn's own frames land right behind it, so dropping these costs nothing.
      if (frame.message.type === 'stream_event') continue;
      const uuid = 'uuid' in frame.message ? frame.message.uuid : undefined;
      if (uuid && seeded.has(uuid)) continue;
    }
    handleFrame(frame);
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

/**
 * Every permission waiting on the user, across every machine. This is the
 * question the fleet view exists to answer, so it is derived from the sessions
 * themselves rather than tracked separately.
 */
function blockedRequests(): BlockedRequest[] {
  const stopped = new Set(
    state.instances.filter((row) => !isLive(row)).map((row) => row.id)
  );

  const rows: BlockedRequest[] = [];
  for (const target of Object.values(state.sessions)) {
    if (target.pending.length === 0 || stopped.has(target.instanceId)) continue;
    const machine = state.machines.find((row) => row.machineId === target.machineId);
    for (const request of target.pending) {
      rows.push({
        instanceId: target.instanceId,
        machineId: target.machineId,
        hostname: machine?.hostname ?? target.machineId,
        cwd: target.cwd,
        request,
      });
    }
  }
  return rows;
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
    return state.instances.filter(isLive);
  },
  /** Sessions the hub lost track of — shown apart, never as live work. */
  get staleInstances(): InstanceRow[] {
    return state.instances.filter(isStale);
  },
  /** Live mainline sessions on one machine — what the sidebar groups under it. */
  runningOn: (machineId: string): InstanceRow[] =>
    state.instances.filter(
      (row) => row.machineId === machineId && isLive(row) && row.kind !== 'scratch'
    ),
  /** Live side quests across the fleet — kept in their own section, not per machine. */
  get scratchInstances(): InstanceRow[] {
    return state.instances.filter((row) => isLive(row) && row.kind === 'scratch');
  },
  /** Stored sessions on one machine, as `listSessions` returned them. */
  catalogOf: (machineId: string): SDKSessionInfo[] => state.catalog[machineId] ?? [],
  get projects() {
    return state.projects;
  },
  projectsOn: (machineId: string): ProjectRow[] =>
    state.projects.filter((project) => project.machineId === machineId),
  project: (id: string): ProjectRow | null =>
    state.projects.find((project) => project.id === id) ?? null,
  /** Live sessions a project owns: started from it, or running in its checkout. */
  liveIn: (project: ProjectRow): InstanceRow[] =>
    state.instances.filter(
      (row) =>
        isLive(row) &&
        (row.projectId === project.id ||
          (row.machineId === project.machineId && under(project.cwd, row.cwd)))
    ),
  /** Stored sessions the SDK recorded somewhere inside the project's checkout. */
  storedIn: (project: ProjectRow): SDKSessionInfo[] =>
    (state.catalog[project.machineId] ?? []).filter(
      (info) => info.cwd && under(project.cwd, info.cwd)
    ),
  session: (instanceId: string): SessionState | null => state.sessions[instanceId] ?? null,
  /** What a session needs from you — `idle` for one nothing has been heard from. */
  activityOf: (instanceId: string): Activity => {
    const target = state.sessions[instanceId];
    return target ? activityOf(target) : 'idle';
  },
  currentToolOf: (instanceId: string): ToolGlance | null =>
    state.sessions[instanceId]?.currentTool ?? null,
  get blocked(): BlockedRequest[] {
    return blockedRequests();
  },
  get blockedCount(): number {
    return blockedRequests().length;
  },
};

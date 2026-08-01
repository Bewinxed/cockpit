/**
 * The browser end of the Envelope spine: one WebSocket to the hub, the frames
 * it returns folded into per-instance UI state (NEW.md §6).
 */
import type {
  AgentRow,
  ControlPayload,
  Envelope,
  FramePayload,
  FsPayload,
  InstanceRow,
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  SDKSessionInfo,
  SendPayload,
  SessionMessage,
  SpawnPayload,
  StopPayload,
} from '@cockpit/core';
import { COCKPIT_SCRATCH_TAG, RESOLVE_PERMISSION } from '@cockpit/core';
import type { SubagentState } from '$lib/utils/flow-types';
import type { Activity } from './activity';
import { activityOf } from './activity';
import type { Message } from './types';
import {
  CONTROL_TIMEOUT_MS,
  DISCARD_TIMEOUT_MS,
  SESSION_CATALOG_LIMIT,
  TRANSCRIPT_CHUNK_SIZE,
  TRANSCRIPT_CHUNK_THRESHOLD,
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
  turnBoundaries,
} from './frames';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** A machine from the hub registry (`GET /api/agents`, and `instances` frames). */
export type Machine = AgentRow;

/** A session the hub knows about (`GET /api/instances`, and `instances` frames). */
export type { InstanceRow };

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

/** A session that died of something stays on the board until the user discards it. */
const isListed = (row: InstanceRow): boolean => isLive(row) || row.status === 'error';

/**
 * A session whose daemon went away mid-flight. It may or may not still be alive
 * on its machine — the hub cannot tell — so it is kept, but never as a live row.
 */
const isStale = (row: InstanceRow): boolean => row.status === 'unknown';

/** A side quest's worktree sits under the project's checkout, so it counts as in it. */
const under = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * A side quest is history nobody asked for until they keep it, and the agent
 * tags its SDK session on the way out to say so. The tag is the whole test —
 * the directory a session ran in says nothing about whether it was a quest.
 */
const listedInHistory = (info: SDKSessionInfo): boolean => info.tag !== COCKPIT_SCRATCH_TAG;

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
  /** The older chunks of a long transcript are still being prepended. */
  hydrating: boolean;
  /** The `system.init` banner is re-emitted every turn; render it once. */
  initialized: boolean;
  /**
   * How the session answers tool permissions, as far as this browser knows: set
   * from what it spawned, moved by a switch the agent confirmed. Nothing reports
   * it back, so a session another tab started reads as `default` here.
   */
  permissionMode: PermissionMode;
  /**
   * Which model answers the next turn: named by every `system.init`, moved
   * optimistically by a switch and corrected by the init the next turn opens
   * with. `null` until the session has started and said what it is running.
   */
  model: string | null;
  /** Started again in place for a mode it could not switch into; ends at the next init. */
  relaunching: boolean;
  /** A side quest (NEW.md §1) — kept visually apart until it is kept or discarded. */
  scratch: boolean;
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
/** The current transcript read per view; a chunk loop stops once it is not it. */
const hydrations = new Map<string, number>();

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
  abandonInflight('The connection to the hub closed before that finished.');
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
    hydrating: false,
    initialized: false,
    permissionMode: 'default',
    model: null,
    relaunching: false,
    scratch: false,
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
  target.scratch = known.kind === 'scratch';
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

/**
 * Takes the hub's word on what is running — whether it was asked for or pushed.
 * Views this browser opened for a session it did not spawn learn their machine
 * from it, so a snapshot is also how a bare `/session/[id]` fills itself in.
 */
function adoptInstances(instances: InstanceRow[]): void {
  state.instances = instances;
  for (const target of Object.values(state.sessions)) hydrate(target);
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
  if (instances) adoptInstances(instances);
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
  if (frame.kind === 'instances') {
    // The machines ride along so a daemon registering — the moment its auth
    // state is decided — reaches the rail without a re-fetch.
    state.machines = frame.agents;
    adoptInstances(frame.instances);
    return;
  }

  if (frame.kind === 'error') {
    const { instanceId, message } = frame;
    if (settle(frame.requestId, (waiter) => waiter.reject(new Error(message)))) return;
    if (instanceId) {
      const target = session(instanceId);
      // A relaunch that never came up has no init frame to end its wait.
      target.relaunching = false;
      target.messages.push(errorMessage(instanceId, message));
    } else console.error('[cockpit] hub error:', message);
    return;
  }

  if (frame.kind === 'control_result') {
    const answered = settle(frame.requestId, (waiter) =>
      frame.ok
        ? waiter.resolve(frame.result)
        : waiter.reject(new Error(frame.error ?? 'The machine could not carry out that request.'))
    );
    if (answered) return;
    // Fire-and-forget controls (interrupt, permission replies) still report failure.
    if (!frame.ok && frame.instanceId) {
      session(frame.instanceId).messages.push(
        errorMessage(frame.instanceId, frame.error ?? 'The machine could not carry out that request.')
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
          // Re-emitted every turn, so this is also what confirms a switch — or
          // puts the picker back if the agent ignored one.
          target.model = message.metadata?.model ?? target.model;
          // The process behind a relaunch is up: this is the frame it opens with.
          target.relaunching = false;
          if (target.initialized) continue;
          target.initialized = true;
        }
        // The settle that precedes a relaunch ends the old turn with an error
        // result the reader asked for — a quiet note, not a red card.
        if (target.relaunching && message.type === 'result.error') {
          sink.push({
            ...message,
            type: 'system.status',
            content: 'Turn stopped to change the permission mode.',
            metadata: {},
          });
          continue;
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
      } else if (
        mapping.delta ||
        mapping.currentTool ||
        mapping.messages.some((message) => message.type === 'assistant')
      ) {
        // A tab that joined after the turn started never sent anything, so nothing
        // ever set `busy` — the frames themselves are the evidence it is working.
        target.busy = true;
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
    throw new Error('Not connected to the hub. Check that it is running, then try again.');
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
    abandonInflight('The connection to the hub dropped before that finished.');
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
      if (Date.now() > deadline) {
        return reject(new Error('Could not reach the hub. Check that it is running, then try again.'));
      }
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
function start({ machineId, ...spawn }: Omit<SpawnPayload, 'instanceId'> & { machineId: string }): SessionState {
  const instanceId = crypto.randomUUID();
  const payload: SpawnPayload = { instanceId, ...spawn };
  send({ verb: 'spawn', machineId, instanceId, payload });

  const created = session(instanceId);
  created.machineId = machineId;
  created.cwd = spawn.cwd;
  created.permissionMode = spawn.permissionMode ?? 'default';
  created.scratch = Boolean(spawn.scratch);
  return created;
}

/** Starts a session on `machineId` and returns the id its route lives at. */
export function spawnSession({
  machineId,
  cwd,
  prompt,
  options = {},
  permissionMode,
  scratch,
  bootstrap,
  projectId,
}: {
  machineId: string;
  cwd: string;
  prompt?: string;
  options?: Options;
  permissionMode?: PermissionMode;
  scratch?: SpawnPayload['scratch'];
  bootstrap?: SpawnPayload['bootstrap'];
  projectId?: string;
}): string {
  const created = start({ machineId, cwd, options, permissionMode, scratch, bootstrap, projectId });
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
  const created = start({ machineId, cwd, options: { ...options, resume: sessionId } });
  created.sessionId = sessionId;
  created.messages = history.map((message) => ({ ...message, instanceId: created.instanceId }));
  void refresh();
  return created.instanceId;
}

/**
 * Branches a side quest off a session (NEW.md §1): the same context carried into
 * a new SDK session, kept apart from mainline work until it is kept or
 * discarded. The transcript on screen is seeded so the branch reads on from
 * where it left.
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
  const created = start({
    machineId,
    cwd,
    options: { resume: sessionId, forkSession: true },
    scratch: {},
  });
  created.messages = history.map((message) => ({ ...message, instanceId: created.instanceId }));
  void refresh();
  return created.instanceId;
}

/** What a turn carries besides its typed text — pastes turned into chips, images. */
export type SendExtras = Pick<SendPayload, 'attachments' | 'images'>;

export function sendText(
  instanceId: string,
  machineId: string,
  text: string,
  extras: SendExtras = {}
): void {
  const payload: SendPayload = { instanceId, message: userMessage(text), ...extras };
  send({ verb: 'send', machineId, instanceId, payload });

  const target = session(instanceId);
  target.messages.push(localUserMessage(instanceId, text, extras));
  target.busy = true;
}

/**
 * The other half of durability: a message to a dead session revives it first.
 * The daemon respawns the same instance with `resume`, then the text goes
 * through as usual — the reader never has to know the process died.
 */
export async function sendOrRevive(
  instanceId: string,
  machineId: string,
  text: string,
  extras?: SendExtras
): Promise<void> {
  const target = session(instanceId);
  const row = state.instances.find((candidate) => candidate.id === instanceId);
  const dead = row && (row.status === 'error' || row.status === 'stopped');
  if (dead && target.sessionId) {
    const requestId = crypto.randomUUID();
    const payload: SpawnPayload = {
      instanceId,
      cwd: target.cwd,
      options: { resume: target.sessionId },
      scratch: target.scratch ? {} : undefined,
      permissionMode: target.permissionMode,
      requestId,
    };
    target.relaunching = true;
    try {
      await ask<void>(requestId, 'revive', CONTROL_TIMEOUT_MS, () =>
        send({ verb: 'spawn', machineId, instanceId, requestId, payload })
      );
    } finally {
      target.relaunching = false;
    }
    void refresh();
  }
  sendText(instanceId, machineId, text, extras);
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
    // The view this session's chunks were being prepended to is gone with it.
    hydrations.delete(instanceId);
    modelLists.delete(instanceId);
    await refresh();
  }
}

/**
 * Promotes a side quest to mainline work: the UI stops setting it apart, and
 * the tag that kept its transcript out of the machine's catalog comes off, so
 * the session joins the history it was being hidden from.
 */
export async function keepSession(instanceId: string): Promise<void> {
  const target = session(instanceId);
  const response = await fetch(`/api/instances/${instanceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'mainline' }),
  });
  if (!response.ok) {
    throw new Error(`Could not keep this session — the hub answered ${response.status}. Try again.`);
  }

  target.scratch = false;
  if (target.sessionId && target.machineId) {
    // `null` is how the SDK clears a tag; the catalog is re-read for the entry
    // that has just stopped being hidden.
    await machineControl(target.machineId, 'tagSession', [
      target.sessionId,
      null,
      { dir: target.cwd || undefined },
    ]);
    await loadCatalog(target.machineId);
  }
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
  if (!response.ok) {
    throw new Error(`Could not save this project — the hub answered ${response.status}. Try again.`);
  }
  const created = (await response.json()) as ProjectRow;
  await refresh();
  return created;
}

/** Forgets the project; the sessions started from it stay, just unattached. */
export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Could not forget this project — the hub answered ${response.status}. Try again.`);
  }
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
      if (inflight.delete(requestId)) {
        reject(new Error(`${label} got no answer in time. The machine may be offline.`));
      }
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

/**
 * Publishes a stored transcript into a session view, newest first. A short one
 * lands in one pass. A long one paints its last turns on their own — mapping the
 * whole of it, and handing the view thousands of messages at once, is what the
 * reader would wait through — and the rest are prepended a chunk at a time with
 * the event loop free in between. `onPublished` runs once the last turns are on
 * screen, and the loop stops early if a later read for this view supersedes it.
 */
async function ingestTranscript(
  viewId: string,
  target: SessionState,
  transcript: SessionMessage[],
  epoch: number,
  onPublished?: () => void
): Promise<void> {
  if (transcript.length <= TRANSCRIPT_CHUNK_THRESHOLD) {
    const { messages, subagents } = mapTranscript(viewId, transcript);
    target.messages = messages;
    target.subagents = subagents;
    onPublished?.();
    return;
  }

  const bounds = turnBoundaries(transcript, TRANSCRIPT_CHUNK_SIZE);
  const newest = mapTranscript(viewId, transcript.slice(bounds[bounds.length - 1]));
  target.messages = newest.messages;
  target.subagents = newest.subagents;
  target.hydrating = true;
  target.loading = false;
  onPublished?.();

  for (let i = bounds.length - 2; i >= 0; i--) {
    // Mapping a chunk is the blocking work, so the loop hands the event loop
    // back between them — this is what the reader scrolls and types through.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (hydrations.get(viewId) !== epoch) return;
    const older = mapTranscript(viewId, transcript.slice(bounds[i], bounds[i + 1]));
    target.messages = [...older.messages, ...target.messages];
    // Branches are keyed by the Task `tool_use_id` that opened them, so an older
    // chunk mostly adds keys — except where a compacted transcript re-emits the
    // same call, and then its turns belong in front of the ones already read
    // back for it.
    for (const [toolUseId, branch] of Object.entries(older.subagents)) {
      const known = target.subagents[toolUseId];
      if (known) known.messages = [...branch.messages, ...known.messages];
      else target.subagents[toolUseId] = branch;
    }
  }
}

/** Starts a read of this view's transcript, superseding whatever was reading it. */
function claimTranscript(viewId: string): number {
  const epoch = (hydrations.get(viewId) ?? 0) + 1;
  hydrations.set(viewId, epoch);
  return epoch;
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
  // Re-opening what is already read — or still hydrating, which has published
  // its newest turns by now — must not start a second read over the top of it.
  if (target.messages.length > 0 || target.loading) return;

  const epoch = claimTranscript(viewId);
  target.loading = true;
  try {
    const transcript = await machineControl<SessionMessage[]>(machineId, 'getSessionMessages', [
      sessionId,
      { dir: cwd || undefined },
    ]);
    await ingestTranscript(viewId, target, transcript, epoch);
  } catch (error) {
    // The newest turns may already be on screen; a failure reading the rest
    // joins them rather than taking the transcript down with it.
    target.messages = [
      errorMessage(viewId, `could not read transcript: ${error instanceof Error ? error.message : error}`),
      ...target.messages,
    ];
  } finally {
    target.loading = false;
    target.hydrating = false;
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
  const epoch = claimTranscript(instanceId);
  target.loading = true;
  try {
    const transcript = await machineControl<SessionMessage[]>(machineId, 'getSessionMessages', [
      sessionId,
      { dir: cwd || undefined },
    ]);
    const seeded = new Set(transcript.map((entry) => entry.uuid));
    await ingestTranscript(instanceId, target, transcript, epoch, () => {
      target.streaming = '';
      // What was held belongs to the end of the transcript, which is now on
      // screen: it appends while the older chunks prepend, so neither waits.
      replayHeld(instanceId, seeded);
    });
  } catch (error) {
    replayHeld(instanceId, new Set());
    console.error(`[cockpit] backfilling ${instanceId} failed:`, error);
  } finally {
    target.loading = false;
    target.hydrating = false;
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

/**
 * Changes how a live session answers permissions, from now on. Unlike the other
 * instance controls this one is awaited: the view already shows the mode that
 * was asked for, so a machine that refuses has to be able to put it back.
 */
export async function setPermissionMode(
  instanceId: string,
  machineId: string,
  mode: PermissionMode
): Promise<void> {
  const target = session(instanceId);
  const previous = target.permissionMode;
  target.permissionMode = mode;

  const requestId = crypto.randomUUID();
  const payload: ControlPayload = {
    instanceId,
    requestId,
    method: 'setPermissionMode',
    args: [mode],
  };
  try {
    await ask<void>(requestId, 'setPermissionMode', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'control', machineId, instanceId, requestId, payload })
    );
  } catch (error) {
    target.permissionMode = previous;
    throw error;
  }
}

/** What a machine answered `supportedModels` with, by instance — asked once. */
const modelLists = new Map<string, ModelInfo[]>();

/**
 * The models this session's machine will accept. `supportedModels` is a `Query`
 * method, so it is only answerable while the session is up; the list does not
 * change under a running session, and it is read the first time it is asked for.
 */
export async function loadModels(instanceId: string, machineId: string): Promise<ModelInfo[]> {
  const cached = modelLists.get(instanceId);
  if (cached) return cached;

  const requestId = crypto.randomUUID();
  const payload: ControlPayload = { instanceId, requestId, method: 'supportedModels', args: [] };
  const models = await ask<ModelInfo[]>(requestId, 'supportedModels', CONTROL_TIMEOUT_MS, () =>
    send({ verb: 'control', machineId, instanceId, requestId, payload })
  );
  modelLists.set(instanceId, models);
  return models;
}

/**
 * Points the session at another model from the next turn on. Awaited like the
 * permission mode and for the same reason: the header already shows the choice,
 * so a machine that refuses has to be able to put it back.
 */
export async function setModel(
  instanceId: string,
  machineId: string,
  model: string
): Promise<void> {
  const target = session(instanceId);
  const previous = target.model;
  target.model = model;

  const requestId = crypto.randomUUID();
  const payload: ControlPayload = { instanceId, requestId, method: 'setModel', args: [model] };
  try {
    await ask<void>(requestId, 'setModel', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'control', machineId, instanceId, requestId, payload })
    );
  } catch (error) {
    target.model = previous;
    throw error;
  }
}

/**
 * `bypassPermissions` is a launch decision — the SDK refuses to switch a running
 * session into it — so a session that wants it now is started again in place:
 * same instance id, same hub row, its own SDK session resumed, so the new
 * process reads the whole conversation back. A side quest relaunches the same
 * way; the agent keeps it in the checkout it was already working in.
 */
export async function relaunchSession(
  instanceId: string,
  machineId: string,
  permissionMode: PermissionMode
): Promise<void> {
  const target = session(instanceId);
  if (!target.sessionId) {
    throw new Error('This session has not named itself yet. Try again in a moment.');
  }

  const requestId = crypto.randomUUID();
  const payload: SpawnPayload = {
    instanceId,
    cwd: target.cwd,
    options: { resume: target.sessionId },
    // A relaunch is a spawn like any other, so it has to say what it is: a quest
    // that stayed silent about it would come back as mainline work, untagged.
    scratch: target.scratch ? {} : undefined,
    permissionMode,
    requestId,
  };

  const previous = target.permissionMode;
  // Work the relaunch interrupts must resume on its own: the reader unblocked
  // the session, they should not also have to nudge it.
  const hadWork = target.busy || target.pending.length > 0;
  target.permissionMode = permissionMode;
  target.relaunching = true;
  // Whatever was in flight belongs to the process being replaced.
  settleStopped(instanceId);
  try {
    await ask<void>(requestId, 'relaunch', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'spawn', machineId, instanceId, requestId, payload })
    );
    if (hadWork) {
      sendText(
        instanceId,
        machineId,
        `The permission mode is now "${permissionMode}". Continue the interrupted work.`
      );
    }
  } catch (error) {
    target.permissionMode = previous;
    throw error;
  } finally {
    target.relaunching = false;
    void refresh();
  }
}

/** The answers a permission card offers — the keyboard has one key for each. */
export type PermissionAnswer = 'allow' | 'deny' | 'always';

/**
 * What an answer means on the wire. `always` hands the SDK's own suggestions
 * back as `updatedPermissions`: they are what stops the next identical call
 * from asking again, and the SDK is the only one that knows how to phrase them.
 */
export function permissionAnswer(
  request: PendingPermission,
  answer: PermissionAnswer
): PermissionResult {
  if (answer === 'deny') return { behavior: 'deny', message: 'User denied permission' };
  return {
    behavior: 'allow',
    updatedInput: request.input,
    ...(answer === 'always' && { updatedPermissions: request.suggestions }),
  };
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
  /** Mainline sessions on one machine — what the sidebar groups under it. */
  runningOn: (machineId: string): InstanceRow[] =>
    state.instances.filter(
      (row) => row.machineId === machineId && isListed(row) && row.kind !== 'scratch'
    ),
  /** Side quests across the fleet — kept in their own section, not per machine. */
  get scratchInstances(): InstanceRow[] {
    return state.instances.filter((row) => isListed(row) && row.kind === 'scratch');
  },
  /** Stored sessions on one machine, minus the side quests hiding among them. */
  catalogOf: (machineId: string): SDKSessionInfo[] =>
    (state.catalog[machineId] ?? []).filter(listedInHistory),
  get projects() {
    return state.projects;
  },
  projectsOn: (machineId: string): ProjectRow[] =>
    state.projects.filter((project) => project.machineId === machineId),
  project: (id: string): ProjectRow | null =>
    state.projects.find((project) => project.id === id) ?? null,
  /** Sessions a project owns: started from it, or running in its checkout.
   *  Failed ones stay listed here too — same board rule as the sidebar. */
  liveIn: (project: ProjectRow): InstanceRow[] =>
    state.instances.filter(
      (row) =>
        isListed(row) &&
        (row.projectId === project.id ||
          (row.machineId === project.machineId && under(project.cwd, row.cwd)))
    ),
  /** Stored sessions the SDK recorded somewhere inside the project's checkout. */
  storedIn: (project: ProjectRow): SDKSessionInfo[] =>
    (state.catalog[project.machineId] ?? []).filter(
      (info) => listedInHistory(info) && info.cwd && under(project.cwd, info.cwd)
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

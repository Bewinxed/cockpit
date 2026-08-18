/**
 * The browser end of the Envelope spine: one WebSocket to the hub, the frames
 * it returns folded into per-instance UI state (NEW.md §6).
 */
import type {
  AgentRow,
  AvailableCommand,
  ClaudeLimits,
  ControlPayload,
  EffortLevel,
  Envelope,
  FramePayload,
  FsPayload,
  HarnessKind,
  InstanceRow,
  McpServerStatus,
  ModelInfo,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  SDKSessionInfo,
  SDKStatus,
  SendPayload,
  SessionMessage,
  SessionPulse,
  SlashCommand,
  SpawnPayload,
  StopPayload,
  UsageLimitsReading,
} from '@cockpit/core';
import {
  classifyCommand,
  COCKPIT_SCRATCH_TAG,
  RESOLVE_PERMISSION,
  RESTART_RESUMABLE,
} from '@cockpit/core';
import type { SubagentState } from '$lib/utils/flow-types';
import type { Activity } from './activity';
import { activityOf, runningSubagents } from './activity';
import type { DelegateAskEvent, DelegateEvent, Message } from './types';
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
import { newId } from './id';
import {
  applyBranchEvent,
  applyToolResult,
  branchFor,
  errorMessage,
  foldDelegateEvent,
  localUserMessage,
  mapFrame,
  mapTranscript,
  mergePeerMessage,
  routedToParent,
  suppressesTaskLine,
  turnBoundaries,
} from './frames';
import { invalidateTasks, refreshTasks, TASK_LEDGER_TOOLS } from './tasks.svelte';
import { workingSet } from './working-set.svelte';

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

/**
 * A session whose process is gone but whose conversation is not: sleeping, not
 * failed. Exactly the rows {@link ensureAlive} can bring back — dead, with an
 * SDK session to resume from — narrowed to the ones that did not die of
 * something: a daemon restart, or nothing said at all. A bad cwd, a pump that
 * crashed, a clone that failed all leave a reason of their own, and a reason of
 * its own is what a real failure has.
 */
export const isResumable = (row: InstanceRow): boolean =>
  (row.status === 'error' || row.status === 'stopped') &&
  Boolean(row.sessionId) &&
  (!row.lastError || row.lastError === RESTART_RESUMABLE);

/** A session that died of something, and is not coming back by being opened. */
export const isFailed = (row: InstanceRow): boolean =>
  row.status === 'error' && !isResumable(row);

/** A side quest's worktree sits under the project's checkout, so it counts as in it. */
/** The last path segment — how the rail names a session, and how a hand-off does. */
const leafOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

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
  /** Set when the hub routed the ask to its parent rather than to the user. */
  routedTo?: 'parent';
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
/**
 * What the session's own context window looks like right now — the SDK's
 * `getContextUsage`, which is what Claude Code's `/context` reads. Categories
 * come through in the SDK's order and carry its colours; the dashboard shows
 * the numbers, not a second opinion about them.
 */
export interface ContextUsage {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  categories: { name: string; tokens: number; color: string }[];
  /** When this reading was taken, so a stale one can say so instead of lying. */
  readAt: number;
}

/**
 * What one session answers behind `/` (NEW.md §11), from its two sources: every
 * `system.init` lists the names and says which of them are skills, and
 * `supportedCommands` — asked once, when somebody first opens the menu — adds
 * the prose. Per instance, because two machines rarely have the same skills
 * installed and a session only ever offers its own.
 */
export interface CommandState {
  /** Names as the session lists them, without the leading slash. */
  names: string[];
  /** The subset of `names` that are skills — {@link classifyCommand}'s evidence. */
  skills: string[];
  /** Descriptions and argument hints, `null` until something has asked. */
  detailed: Map<string, SlashCommand> | null;
}

export interface SessionState {
  /** The id this view lives at: a spawned instance, or the SDK session browsed. */
  instanceId: string;
  machineId: string;
  cwd: string;
  /** The SDK session behind this view, once one is known. */
  sessionId: string | null;
  /** Which harness owns {@link sessionId} — what a resume and a catalog read route on. */
  harness: HarnessKind;
  messages: Message[];
  /** Subagent branches, keyed by the Task `tool_use_id` that spawned them. */
  subagents: Record<string, SubagentState>;
  pending: PendingPermission[];
  /** Partial assistant text, between `stream_event`s and the final message. */
  streaming: string;
  /**
   * Which content block the main loop has open right now, from the partials —
   * `null` between blocks and outside a turn. This is the only evidence of what
   * the session is doing while it does it, and the tail says nothing the
   * partials have not shown.
   */
  openBlock: 'thinking' | 'text' | 'tool' | null;
  /**
   * What the open thinking block has reasoned so far. Left standing when the
   * block closes — the trace stays readable until the transcript's own thinking
   * message supersedes it — and `''` for a redacted block, which streams
   * nothing and is still thinking.
   */
  thinkingStream: string;
  /** The SDK signed the thinking block: it is wrapping up, not still going. */
  thinkingClosing: boolean;
  /**
   * When the open thinking block started, epoch ms. Measured at
   * `content_block_start`, consumed when the settled thinking message lands —
   * the one clock that survives "thinking then a tool call in one frame",
   * where both mapped messages share a timestamp and adjacency measures 0.
   */
  thinkingSince: number | null;
  /** A turn is in flight (sent, no `result` yet). */
  busy: boolean;
  /**
   * When this stretch of work began, epoch ms, or `null` while the session is
   * idle. Stamped by the local send before a single frame has come back — the
   * wait for the first one is exactly the silence the transcript's presence line
   * exists to fill — and left alone for the rest of the turn, so a permission
   * answered halfway through does not restart the clock.
   */
  workingSince: number | null;
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
   * How the session answers tool permissions: named by every `system.init`,
   * moved optimistically by a switch and corrected by the init the next turn
   * opens with. `null` until something has said — see {@link adoptSettings}.
   */
  permissionMode: PermissionMode | null;
  /** Which model answers the next turn, learnt and corrected the same way. */
  model: string | null;
  /**
   * How hard that model thinks. Learnt the same way with one difference that
   * matters: no `init` reports effort back, so nothing ever corrects this — it
   * is the last level asked for, and `null` means nobody has asked, not that the
   * session is running at the API default.
   */
  effort: EffortLevel | null;
  /** Started again in place for a mode it could not switch into; ends at the next init. */
  relaunching: boolean;
  /** A side quest (NEW.md §1) — kept visually apart until it is kept or discarded. */
  scratch: boolean;
  /** The last context reading, `null` until one has been asked for. */
  context: ContextUsage | null;
  /** A `getContextUsage` call is out; the meter keeps its last number meanwhile. */
  contextPending: boolean;
  /** What this session offers behind `/` — see {@link commandsOf}. */
  commands: CommandState;
  /** A `supportedCommands` call is out; the names from `init` are the menu meanwhile. */
  commandsPending: boolean;
  /** The session's MCP servers (`mcpServerStatus`), null until asked; [] when the ask failed or found none. */
  mcp: McpServerStatus[] | null;
  mcpPending: boolean;
  /**
   * The last turn came back an error — the SDK's `is_error`, not a reading of
   * what it said. Paired with the machine's auth state, this is what tells a
   * "cannot answer" apart from an answer nobody liked.
   */
  lastTurnFailed: boolean;
  /**
   * The cumulative cost the latest `result` frame reported, in dollars.
   * `undefined` until a turn has closed with one. Frames, not transcript
   * scraping: a successful turn's cost has no transcript line.
   */
  totalCost?: number;
  /**
   * The session's own word on what it is doing: `compacting` while it rewrites
   * its context — the only live signal, since the boundary frame lands after
   * the work — `requesting` while it waits on the model.
   */
  sdkStatus: SDKStatus;
  /**
   * What the last compaction did, from the `compact_boundary` the SDK emits when
   * one finishes. Kept on the session rather than only in the transcript so the
   * dock can say it happened without the reader scrolling to find the line.
   */
  lastCompaction: {
    at: number;
    preTokens: number;
    trigger: 'manual' | 'auto';
    result?: 'success' | 'failed';
    error?: string;
  } | null;
}

const state = $state({
  status: 'disconnected' as ConnectionStatus,
  /** When the next reconnect attempt fires, so the banner can count it down. */
  retryAt: null as number | null,
  machines: [] as Machine[],
  /**
   * Sessions that have been handed work and have not yet taken a turn on it.
   * Keyed by the target: the question the rail answers is what *that* session
   * is carrying. A hand-off whose arrival is invisible is one you have to go
   * and check for, which is the thing it was supposed to replace.
   */
  handoffs: {} as Record<string, { from: string; at: number }>,
  instances: [] as InstanceRow[],
  projects: [] as ProjectRow[],
  sessions: {} as Record<string, SessionState>,
  /**
   * Each instance's coarse now-state, pushed by the daemon ~1/sec (broadcast).
   * The rail reads this for sessions it has not subscribed to — the ones whose
   * frame-fed {@link SessionState} is either absent or frozen at the last frame
   * before the tab closed.
   */
  pulses: {} as Record<string, SessionPulse>,
  /**
   * The hub's record of every delegate's asks, answers and reports, keyed by
   * the delegate they are about and oldest first. Kept apart from the session
   * it belongs to because the reader of this traffic is the *parent* — a
   * delegate card renders its child's exchange, not its own.
   */
  delegateEvents: {} as Record<string, DelegateEvent[]>,
  /** Stored sessions per machine, newest first (`listSessions` through the tunnel). */
  catalog: {} as Record<string, SDKSessionInfo[]>,
  /**
   * Each machine's latest Claude limit reading, by machineId — folded in from
   * the `kind: 'usage'` frame so the pill updates live rather than polling
   * (USAGE-SPEC.md §7.1). Empty until a machine has reported.
   */
  usageLimits: {} as Record<string, ClaudeLimits>,
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
  /** The wake listeners are document-wide; bind them once across HMR reloads. */
  var __cockpitWakeBound: boolean;
}
globalThis.__cockpitSocket ??= null;
globalThis.__cockpitReconnectTimeout ??= null;
globalThis.__cockpitReconnectAttempts ??= 0;
globalThis.__cockpitDisposing ??= false;
globalThis.__cockpitWakeBound ??= false;

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

/** Mainline sessions the rail lists for one machine: live work and what stopped. */
const listedOn = (machineId: string): InstanceRow[] =>
  state.instances.filter(
    (row) => row.machineId === machineId && isListed(row) && row.kind !== 'scratch'
  );

function session(instanceId: string): SessionState {
  const existing = state.sessions[instanceId];
  if (existing) return existing;

  const created: SessionState = {
    instanceId,
    machineId: '',
    cwd: '',
    sessionId: null,
    harness: 'claude',
    messages: [],
    subagents: {},
    pending: [],
    streaming: '',
    openBlock: null,
    thinkingStream: '',
    thinkingClosing: false,
    thinkingSince: null,
    busy: false,
    workingSince: null,
    currentTool: null,
    lastActivityAt: null,
    loading: false,
    hydrating: false,
    initialized: false,
    permissionMode: null,
    model: null,
    effort: null,
    relaunching: false,
    scratch: false,
    context: null,
    contextPending: false,
    commands: { names: [], skills: [], detailed: null },
    commandsPending: false,
    mcp: null,
    mcpPending: false,
    lastTurnFailed: false,
    sdkStatus: null,
    lastCompaction: null,
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
  const known = state.instances.find((row) => row.id === target.instanceId);
  if (!known) return;
  adoptSettings(target, known);
  if (target.machineId) return;
  target.machineId = known.machineId;
  target.cwd = known.cwd;
  target.sessionId = known.sessionId;
  target.harness = (known.harness as HarnessKind) ?? 'claude';
  target.scratch = known.kind === 'scratch';
}

/**
 * Seeds the permission mode and model this view shows from what the hub stored.
 *
 * Precedence, highest first: the newest `system.init` — the session's own word,
 * re-emitted every turn, so it also corrects a setting changed by something that
 * is not this dashboard; then a switch this browser made and the daemon
 * confirmed, until that next init; then this row, which is all a view has before
 * the session's first turn; then the default the header falls back to. The row
 * therefore only ever fills a blank: it can be older than what the session has
 * since said, and a broadcast must not walk a live value back to it.
 */
function adoptSettings(target: SessionState, row: InstanceRow): void {
  // Only a spawn, a confirmed switch or an init ever wrote the column, so its
  // word on a mode is the SDK's — which is wider than the picker's four.
  if (target.permissionMode === null && row.permissionMode) {
    target.permissionMode = row.permissionMode as PermissionMode;
  }
  if (target.model === null && row.model) target.model = row.model;
  // The row is the *only* source for effort — no init carries it — so this is
  // not a blank being filled ahead of the session's own word, it is the record.
  if (target.effort === null && row.effort) target.effort = row.effort as EffortLevel;
}

/**
 * Writes back a setting the session has confirmed, so the next cold load starts
 * from what it is running rather than from what this browser once asked for.
 * Only what the row does not already say — an init repeats itself every turn.
 */
async function persistSettings(
  instanceId: string,
  settings: { permissionMode?: PermissionMode; model?: string; effort?: EffortLevel }
): Promise<void> {
  const row = state.instances.find((candidate) => candidate.id === instanceId);
  if (!row) return;

  const patch: typeof settings = {};
  if (settings.permissionMode && settings.permissionMode !== row.permissionMode) {
    patch.permissionMode = settings.permissionMode;
  }
  if (settings.model && settings.model !== row.model) patch.model = settings.model;
  if (settings.effort && settings.effort !== row.effort) patch.effort = settings.effort;
  if (Object.keys(patch).length === 0) return;

  try {
    const response = await fetch(`/api/instances/${instanceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  } catch (error) {
    // The session is already answering this way; only the row is behind, and
    // the next init will try again — nothing the reader needs to act on.
    console.error(`[cockpit] persisting ${instanceId} settings failed:`, error);
  }
}

/** Opens a session's view state — the route's half of arriving at `/session/[id]`. */
export function openSession(instanceId: string): void {
  hydrate(session(instanceId));
  void loadDelegateEvents(instanceId);
  // Opening a view is the moment its frames become this browser's to render.
  // (The working-set effect in the route layout already names it; this makes
  // the direct route the only trigger the store needs to know about.)
  syncSubscriptions();
}

/** Views whose delegates' traffic has been read back — it is read once. */
const delegatesRead = new Set<string>();

/**
 * What this session's delegates asked it, and what it answered, before the tab
 * opened. Broadcast as it happens *and* readable here, for the same reason the
 * hand-offs are: an exchange that settled an hour ago is still the record, and
 * a settled ask is never pushed again. A read that fails leaves the delegate
 * cards on the transcript markers, and the next open tries again.
 */
async function loadDelegateEvents(instanceId: string): Promise<void> {
  if (delegatesRead.has(instanceId)) return;
  delegatesRead.add(instanceId);
  const events = await load<DelegateEvent[]>(`/api/delegate-events?parent=${instanceId}`);
  if (!events) {
    delegatesRead.delete(instanceId);
    return;
  }
  for (const event of events) recordDelegateEvent(event);
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

/** Replaces the whole limits map with the hub's word — a full snapshot, not a patch. */
function adoptUsageLimits(readings: { machineId: string; limits: ClaudeLimits }[]): void {
  const next: Record<string, ClaudeLimits> = {};
  for (const reading of readings) next[reading.machineId] = reading.limits;
  state.usageLimits = next;
}

/** The `kind: 'usage'` frame's readings, mapped down to a machine → limits table. */
function usageLimitReadings(readings: UsageLimitsReading[]): Record<string, ClaudeLimits> {
  const next: Record<string, ClaudeLimits> = {};
  for (const reading of readings) next[reading.machineId] = reading.payload;
  return next;
}

/** Registry reads: on connect and again after every reconnect. */
async function refresh(): Promise<void> {
  const [machines, instances, projects, pending, handoffs, usage] = await Promise.all([
    load<Machine[]>('/api/agents'),
    load<InstanceRow[]>('/api/instances'),
    load<ProjectRow[]>('/api/projects'),
    load<Envelope<FramePayload>[]>('/api/pending'),
    // Read on connect, not only broadcast on change: a dashboard opened after
    // a hand-off went out has missed every broadcast it will ever get.
    load<Record<string, { from: string; at: number }>>('/api/handoffs'),
    // Same reason: a dashboard opened between reports has missed the frames.
    load<{ machines: { machineId: string; limits: ClaudeLimits }[] }>('/api/usage/limits'),
  ]);

  if (handoffs) state.handoffs = handoffs;
  if (machines) state.machines = machines;
  if (projects) state.projects = projects;
  if (instances) adoptInstances(instances);
  if (usage) adoptUsageLimits(usage.machines);
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

/**
 * The hub's delegate-traffic push (`publishDelegateEvent`, packages/hub). It is
 * none of core's `FramePayload` kinds — the hub sends it to dashboards only —
 * so it is read off the frame structurally, the way `routedTo` and `handoffs`
 * are.
 */
function delegateEventOf(frame: FramePayload): DelegateEvent | null {
  const candidate: { kind: string; event?: unknown } = frame;
  if (candidate.kind !== 'delegate_event') return null;
  const event = candidate.event;
  if (typeof event !== 'object' || event === null) return null;
  return event as DelegateEvent;
}

/** Files one event under the delegate it is about, pushed or freshly read. */
function recordDelegateEvent(event: DelegateEvent): void {
  // Written, then read back: a `$state` write lands on the proxy and never on
  // the literal, so folding into the literal would file the row where the UI
  // cannot see it.
  state.delegateEvents[event.instanceId] ??= [];
  foldDelegateEvent(state.delegateEvents[event.instanceId], event);
}

/**
 * Keeps {@link SessionState.workingSince} in step with what the session is
 * doing. Anything that can change {@link activityOf} calls this: the clock
 * starts at the first sign of work and stops only where the session goes idle,
 * so a turn that is merely blocked or waiting on a tool keeps counting.
 */
function trackWorking(target: SessionState): void {
  if (activityOf(target) === 'idle') target.workingSince = null;
  else target.workingSince ??= Date.now();
}

/**
 * Forgets the live turn phase. Called wherever the partials that painted it
 * stop being the truth: the turn ended, the process behind it was replaced, or
 * a stored transcript has taken the transcript's place.
 */
function clearTurnPhase(target: SessionState): void {
  target.openBlock = null;
  target.thinkingStream = '';
  target.thinkingClosing = false;
  target.thinkingSince = null;
}

/** Which tool a result answers, from the call it lands on. */
const nameOfCall = (messages: Message[], toolId: string): string =>
  messages.findLast((message) => message.metadata?.toolId === toolId)?.metadata?.toolName ?? '';

function handleFrame(frame: FramePayload): void {
  if (frame.kind === 'instances') {
    // The machines ride along so a daemon registering — the moment its auth
    // state is decided — reaches the rail without a re-fetch.
    state.machines = frame.agents;
    // The hub's own record of what each session is carrying. Kept there rather
    // than learnt by watching, so it is the same on every device and survives a
    // reload — a hand-off only this tab saw is one your phone never knows about.
    state.handoffs = (frame as { handoffs?: Record<string, { from: string; at: number }> })
      .handoffs ?? {};
    adoptInstances(frame.instances);
    return;
  }

  if (frame.kind === 'usage') {
    // The small limits frame the hub pushes on each report (USAGE-SPEC.md §6.4).
    state.usageLimits = usageLimitReadings(frame.limits);
    return;
  }

  if (frame.kind === 'pulse') {
    // The daemon's coarse now-state, broadcast — this is the whole of what the
    // rail knows about a session this browser has not subscribed to.
    state.pulses[frame.instanceId] = frame.pulse;
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

  // The hub's own record of what a delegate asked and was answered. Filed
  // before the session below, not behind it: the reader of this traffic is the
  // parent's delegate card, so it has no business waiting out the delegate's
  // own backfill.
  const delegateEvent = delegateEventOf(frame);
  if (delegateEvent) {
    recordDelegateEvent(delegateEvent);
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
    case 'frame': {
      target.harness = frame.harness;
      const mapping = mapFrame(frame.instanceId, frame.message);
      if (mapping.branch) applyBranchEvent(target.subagents, frame.instanceId, mapping.branch);
      // Cost rides every result frame, cumulative across the run. It has no
      // transcript line on success, so it lives on the session instead.
      if (mapping.cost !== undefined) target.totalCost = mapping.cost;

      // A subagent's turns belong to its branch, not to the main transcript —
      // interleaving them is what buries the conversation the user is reading.
      const sink = mapping.agentId
        ? branchFor(target.subagents, frame.instanceId, mapping.agentId).messages
        : target.messages;

      for (const message of mapping.messages) {
        if (message.type === 'system.init') {
          target.sessionId = message.metadata?.sessionId ?? target.sessionId;
          // Re-emitted every turn and the session's own word on both settings,
          // so this confirms a switch, puts the picker back if the agent ignored
          // one, and catches a `/model` or `/permissions` run somewhere else.
          // Harvested before the banner is deduplicated, or only the first would.
          target.model = message.metadata?.model ?? target.model;
          target.permissionMode = message.metadata?.permissionMode ?? target.permissionMode;
          void persistSettings(frame.instanceId, {
            permissionMode: message.metadata?.permissionMode,
            model: message.metadata?.model,
          });
          // The `/` menu, from the same re-emitted frame and for the same
          // reason: a skill installed since the last turn is in this list.
          target.commands.names = message.metadata?.slashCommands ?? target.commands.names;
          target.commands.skills = message.metadata?.skills ?? target.commands.skills;
          // A relaunch can change the MCP set; null makes the header ask again.
          target.mcp = null;
          // The process behind a relaunch is up: this is the frame it opens with.
          target.relaunching = false;
          target.initialized = true;
          // Anything still parked belongs to a process that is gone.
          //
          // A permission blocks the turn that asked it, so a session cannot
          // reach its next `init` with one outstanding — an init arriving on top
          // of pending questions means the process holding their resolvers died
          // and a new one opened the session. Answering those reaches a daemon
          // that never asked, which is the "no permission request <id>" the
          // reader gets for clicking a button the app was still showing them.
          if (target.pending.length > 0) target.pending = [];
          // Never a transcript line. `init` is re-emitted every single turn, so
          // any attempt to render it once relies on a flag that survives every
          // reload, reconnect and daemon restart — and each time that flag is
          // missed the reader gets "Session started" in the middle of a
          // conversation that plainly never stopped. Everything it carries is
          // already on screen: the model in the header, the servers behind it.
          continue;
        }
        // A compaction just landed. The transcript has its own line for it; the
        // dock needs the fact and the size, and a fresh reading because the
        // window it is metering just changed underneath it.
        if (message.type === 'system.compact_boundary') {
          target.lastCompaction = {
            at: Date.now(),
            preTokens: message.metadata?.preTokens ?? 0,
            trigger: message.metadata?.trigger === 'manual' ? 'manual' : 'auto',
          };
          if (target.machineId) void refreshContext(frame.instanceId, target.machineId);
        }
        // An id the SDK took but could not honour: the init that opened this
        // turn still names what was asked for, so the picker follows this
        // instead rather than going on claiming a model that is not answering.
        if (message.type === 'system.model_fallback') {
          target.model = message.metadata?.model ?? target.model;
          void persistSettings(frame.instanceId, { model: message.metadata?.model });
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
        // A hand-off brief arrives twice — the uuid-less live echo and the
        // uuid-bearing stored copy, both mapping to `user.peer` — and identical
        // body text means it is one brief, not two.
        if (mergePeerMessage(sink, message)) continue;
        // A real subagent's `task_notification` names a `tool_use_id` whose
        // branch already exists — its completion is the branch card. The branch
        // event above ran first, so the registry already answers whether this
        // line is redundant; a plain tool task has no branch and keeps its line.
        if (suppressesTaskLine(target.subagents, message, mapping.branch?.toolUseId)) continue;
        sink.push(message);
      }
      // The frame for a turn the reader typed: stamp their local copy with the
      // SDK's uuid so edit/fork can anchor on it without a transcript re-read.
      // Oldest unstamped copy first — frames arrive in send order — preferring
      // an exact text match when two sends are in flight.
      if (mapping.echo && !mapping.agentId) {
        const copies = target.messages.filter((m) => m.type === 'user' && !m.sdkUuid);
        const copy = copies.find((m) => m.content === mapping.echo?.text) ?? copies[0];
        if (copy) copy.sdkUuid = mapping.echo.uuid;
      }
      for (const result of mapping.toolResults) {
        applyToolResult(sink, result);
        // The ledger on disk just moved. The result says only that it did —
        // what it now says is read back from the files, never parsed out of
        // here. Answered against `sink`, so a subagent editing the plan
        // invalidates the session the same way the main loop does; searched
        // backwards because a result answers one of the last calls made.
        if (TASK_LEDGER_TOOLS.has(nameOfCall(sink, result.toolId))) {
          invalidateTasks(frame.instanceId);
        }
        // The Task call's own result is the authoritative end of the subagent it
        // spawned: branches are keyed by that `tool_use_id`. Progress frames can
        // re-open a branch that already reported itself finished, and nothing
        // closes it again — which is how every subagent ends up reading
        // "running" forever, whether it is working or was done an hour ago.
        const branch = target.subagents[result.toolId];
        if (!branch) continue;
        branch.status = result.isError ? 'error' : 'complete';
        branch.completedAt ??= new Date();
        // The tool_result carries the full report; task_notification only had
        // a short summary, so this overwrites unconditionally.
        if (result.isError) branch.error = result.result;
        else branch.result = result.result;
      }

      // A push the SDK sends when the commands on disk changed: the full list,
      // so it replaces what was cached — including the names, which are now
      // fresher than the init that listed them.
      if (mapping.commands) {
        target.commands = {
          ...target.commands,
          names: mapping.commands.map((command) => command.name),
          detailed: detailsOf(mapping.commands),
        };
      }

      // `undefined` is "this frame said nothing about it"; `null` is the session
      // saying it stopped. Only the latter clears the meter's label.
      if (mapping.status !== undefined) target.sdkStatus = mapping.status;
      if (mapping.compaction) {
        target.lastCompaction = {
          at: Date.now(),
          preTokens: target.lastCompaction?.preTokens ?? 0,
          trigger: target.lastCompaction?.trigger ?? 'auto',
          result: mapping.compaction.result,
          error: mapping.compaction.error,
        };
        if (target.machineId) void refreshContext(frame.instanceId, target.machineId);
      }

      if (mapping.currentTool && !mapping.agentId) target.currentTool = mapping.currentTool;
      // What the partials say the model is writing right now. Only ever the
      // main loop's — `mapFrame` files nothing here for a subagent's frames.
      if (mapping.blockStart) {
        target.openBlock = mapping.blockStart;
        // A fresh block of reasoning, not a continuation of the last one.
        if (mapping.blockStart === 'thinking') {
          target.thinkingStream = '';
          target.thinkingClosing = false;
          target.thinkingSince = Date.now();
        }
      }
      if (mapping.thinkingDelta) target.thinkingStream += mapping.thinkingDelta;
      if (mapping.thinkingClosing) target.thinkingClosing = true;
      if (mapping.blockStop) target.openBlock = null;
      // The glance is empty until the full frame lands, so it never overwrites
      // one that already has the arguments in it.
      if (mapping.toolStarting && !target.currentTool) target.currentTool = mapping.toolStarting;
      // The turn's own thinking message has landed in the transcript, which is
      // where the reasoning is read from now — same frame, so the live trace
      // gives way without a gap between the two. Before it does, the measured
      // start of that block becomes the message's duration: two blocks of one
      // frame share a mapped timestamp, so adjacency reads 0 there and only
      // this clock knows. One thinking message consumes it; more than one in a
      // frame shares no honest split, so none of them gets a number.
      if (frame.message.type === 'assistant' && !mapping.agentId) {
        if (target.thinkingSince !== null) {
          const settled = mapping.messages.filter((message) => message.type === 'thinking');
          if (settled.length === 1 && settled[0].metadata) {
            settled[0].metadata.thinkingDurationMs = Date.now() - target.thinkingSince;
          }
        }
        clearTurnPhase(target);
      }
      const answered = target.currentTool?.toolId;
      if (mapping.toolResults.some((result) => result.toolId === answered)) {
        target.currentTool = null;
      }
      // A subagent's deltas feed its branch's buffer, not the main loop's.
      if (mapping.agentId) {
        const branch = branchFor(target.subagents, frame.instanceId, mapping.agentId);
        if (mapping.delta) branch.streaming += mapping.delta;
        if (mapping.clearsStream) branch.streaming = '';
      } else {
        if (mapping.delta) target.streaming += mapping.delta;
        if (mapping.clearsStream) target.streaming = '';
      }
      if (mapping.failedTurn !== undefined) target.lastTurnFailed = mapping.failedTurn;
      if (mapping.endsTurn) {
        target.busy = false;
        target.currentTool = null;
        target.sdkStatus = null;
        clearTurnPhase(target);
        // The turn just changed how full the window is; ask rather than guess.
        if (target.machineId) void refreshContext(frame.instanceId, target.machineId);
      } else if (
        mapping.delta ||
        mapping.currentTool ||
        // A turn that opens on a long reasoning block sends neither text nor a
        // tool call for minutes; the block itself is the evidence.
        mapping.blockStart ||
        mapping.thinkingDelta ||
        mapping.messages.some(
          (message) => message.type === 'assistant' || message.type === 'thinking'
        )
      ) {
        // A tab that joined after the turn started never sent anything, so nothing
        // ever set `busy` — the frames themselves are the evidence it is working.
        target.busy = true;
      }
      break;
    }

    case 'permission_request': {
      const routedTo = (frame as { routedTo?: 'parent' }).routedTo;
      const existing = target.pending.find((p) => p.requestId === frame.requestId);
      if (existing) {
        // A re-broadcast (the parent died) clears the tag, so the ask returns
        // to the user's queue; a fresh arrival keeps it out. Either way the
        // stored entry follows the latest word from the hub.
        existing.routedTo = routedTo;
        break;
      }
      target.pending.push({
        requestId: frame.requestId,
        instanceId: frame.instanceId,
        toolName: frame.toolName,
        input: frame.input,
        suggestions: frame.suggestions,
        routedTo,
      });
      break;
    }
  }

  trackWorking(target);
  target.lastActivityAt = new Date();
}

/** The session the board is peeking — subscribed for frames, like an open tab. */
let peekedId = $state<string | null>(null);

/**
 * Delegates whose cards are expanded. A delegate is a full instance, but its
 * parent's transcript is what the reader is in — so it is not in the working
 * set, and without this it receives no frames and its expanded card stays empty.
 * Watching on expand (and stopping on collapse) is what feeds the card its
 * transcript without opening the session as a tab.
 */
const watchedDelegates = new Set<string>();

/** A session is "open" when a tab or the peek pane is actively watching it. */
function isSubscribed(instanceId: string): boolean {
  return workingSet.order.includes(instanceId) || peekedId === instanceId;
}

/** The full set of instance ids this dashboard wants `frame` frames for. */
function subscriptionIds(): string[] {
  const ids = new Set(workingSet.order);
  if (peekedId) ids.add(peekedId);
  for (const id of watchedDelegates) ids.add(id);
  return [...ids];
}

/** The last subscription set sent, so an unchanged working set stays quiet. */
let lastSubscriptionKey = '';

/**
 * Re-sends the whole subscription set. Replace-whole-set on every change; a
 * no-op when the set is unchanged since the last send, and nothing at all when
 * the socket is not open — the reconnect path re-sends.
 */
export function syncSubscriptions(): void {
  const socket = globalThis.__cockpitSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const ids = subscriptionIds().sort();
  const key = ids.join('\u0000');
  if (key === lastSubscriptionKey) return;
  lastSubscriptionKey = key;
  socket.send(
    JSON.stringify({ verb: 'subscribe', machineId: '', payload: { instanceIds: ids } })
  );
}

/** The board peeking a session subscribes it for frames; `null` closes the peek. */
export function setPeeked(id: string | null): void {
  if (peekedId === id) return;
  peekedId = id;
  syncSubscriptions();
}

/** A delegate card expanded: watch this instance's frames so its card can render them. */
export function watchDelegate(instanceId: string): void {
  watchedDelegates.add(instanceId);
  syncSubscriptions();
}

/** A delegate card collapsed: stop watching, so the instance's frames no longer stream. */
export function unwatchDelegate(instanceId: string): void {
  if (!watchedDelegates.delete(instanceId)) return;
  syncSubscriptions();
}

function send(envelope: Envelope): void {
  const socket = globalThis.__cockpitSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('Not connected to the hub. Check that it is running, then try again.');
  }
  socket.send(JSON.stringify(envelope));
}

/**
 * Backs off, but never gives up. A dashboard is a window somebody leaves open:
 * the hub restarting, a laptop sleeping or a dev server reloading all end with
 * the hub coming back, and a client that has stopped trying by then shows stale
 * rows behind a status dot until the tab is reloaded by hand. The delay is
 * capped instead of the attempts, so a long outage costs one poll per
 * `WS_RECONNECT_MAX_DELAY` and no more.
 *
 * `WS_RECONNECT_MAX_ATTEMPTS` now only decides when to stop growing the delay.
 */
function scheduleReconnect(): void {
  const attempt = globalThis.__cockpitReconnectAttempts;
  const delay = Math.min(
    WS_RECONNECT_BASE_DELAY * 2 ** Math.min(attempt, WS_RECONNECT_MAX_ATTEMPTS),
    WS_RECONNECT_MAX_DELAY
  );
  state.retryAt = Date.now() + delay;
  globalThis.__cockpitReconnectTimeout = setTimeout(() => {
    globalThis.__cockpitReconnectAttempts++;
    connect();
  }, delay);
}

/**
 * Reconnects now instead of waiting out the backoff. What the reconnect banner
 * calls, and what a tab that just came back to the foreground calls: the delay
 * was chosen while nobody was watching, and a user looking at the window is
 * evidence worth more than the schedule.
 */
export function reconnectNow(): void {
  const socket = globalThis.__cockpitSocket;
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  if (globalThis.__cockpitReconnectTimeout) clearTimeout(globalThis.__cockpitReconnectTimeout);
  globalThis.__cockpitReconnectAttempts = 0;
  state.retryAt = null;
  connect();
}

/**
 * Whether this module instance has claimed the socket on `globalThis`. Claiming
 * happens once: the adoption below reads the registry, and reading the registry
 * goes through `waitForOpen`, which calls back in here. Without the latch that
 * is not a slow path, it is a loop that re-enters itself for every catalog it
 * loads and never returns.
 */
let claimed = false;

function connect(): void {
  globalThis.__cockpitDisposing = false;
  teardown();
  state.status = 'connecting';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/dashboard`);

  socket.onopen = () => {
    state.status = 'connected';
    state.retryAt = null;
    globalThis.__cockpitReconnectAttempts = 0;
    void refresh().then(refreshCatalogs);
    // Re-state the subscription on every (re)connect — the hub's registry forgot
    // this dashboard the moment the socket dropped.
    lastSubscriptionKey = '';
    syncSubscriptions();
  };

  bind(socket);
  // This module made it, so it already owns it: `ensureConnected` has nothing
  // left to adopt, and `onopen` above is what refreshes.
  claimed = true;
  globalThis.__cockpitSocket = socket;
}

/**
 * Points a socket's handlers at *this* module's state.
 *
 * The socket is stored on `globalThis` so a module reload never orphans it, but
 * `state` is per module instance. A reloaded module that inherits a live socket
 * therefore inherits handlers that still write to the state nobody is rendering
 * any more: frames keep arriving, the old instance keeps up, and the instance on
 * screen sits at its initial `disconnected` for good. Re-binding is what makes
 * the inherited socket belong to whoever is rendering.
 */
function bind(socket: WebSocket): void {
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
    // Always followed by `onclose`, which schedules the retry — this only
    // records that the last attempt failed, never that trying has stopped.
    state.status = 'error';
  };
}

/** What routes call on mount: the socket is app-scoped, not page-scoped. */
export function ensureConnected(): void {
  const socket = globalThis.__cockpitSocket;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    if (claimed) return;
    // Adopt it rather than assume somebody else is still listening: `onopen`
    // has already fired for an open socket and will never fire again, so the
    // status has to be read off the socket instead of waited for.
    claimed = true;
    bind(socket);
    if (socket.readyState === WebSocket.OPEN) {
      state.status = 'connected';
      state.retryAt = null;
      void refresh().then(refreshCatalogs);
      lastSubscriptionKey = '';
      syncSubscriptions();
    } else {
      state.status = 'connecting';
    }
    return;
  }
  // A navigation is a fresh user intent — earlier exhausted retries don't apply.
  globalThis.__cockpitReconnectAttempts = 0;
  connect();
}

/**
 * The three moments worth more than the backoff schedule: the machine says its
 * network is back, the tab comes to the foreground after a sleep, and the
 * window regains focus. Each means the outage may be over right now, and the
 * timer was set when none of that was known. Registered once per document.
 */
if (typeof window !== 'undefined' && !globalThis.__cockpitWakeBound) {
  globalThis.__cockpitWakeBound = true;
  const wake = () => {
    if (document.visibilityState === 'hidden') return;
    reconnectNow();
  };
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
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
    // Stamped, not implied. The SDK treats an unstamped message as
    // unattributed and fails it closed at the gates that ask whether a human
    // said this — so a typed sentence has to say that it was typed.
    origin: { kind: 'human' },
  };
}

/**
 * A message one session sends another. Two things make it a hand-off rather
 * than a second reader talking:
 *
 * - `origin: peer` marks it as reported speech, so the receiving agent weighs
 *   it as another agent's word and not as its user's authority.
 * - `shouldQuery: false` appends it without starting a turn. The target is
 *   usually mid-work; the note lands in its transcript now and is picked up
 *   when it next answers, instead of derailing what it was asked to do.
 */
function peerMessage(text: string, from: { id: string; name: string }): SendPayload['message'] {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    origin: { kind: 'peer', from: from.id, name: from.name, fromSession: from.id },
    shouldQuery: false,
  };
}

/** Spawns a session on `machineId` and registers the view it streams into. */
function start({ machineId, ...spawn }: Omit<SpawnPayload, 'instanceId'> & { machineId: string }): SessionState {
  const instanceId = newId();
  const payload: SpawnPayload = { instanceId, ...spawn };
  send({ verb: 'spawn', machineId, instanceId, payload });

  const created = session(instanceId);
  created.machineId = machineId;
  created.cwd = spawn.cwd;
  created.harness = spawn.harness ?? 'claude';
  created.permissionMode = spawn.permissionMode ?? null;
  // What the form chose, so the header shows it during the wait for the first
  // init — which then corrects it to whatever the harness resolved it to.
  created.model = spawn.model ?? null;
  created.effort = spawn.effort ?? null;
  created.scratch = Boolean(spawn.scratch);
  return created;
}

/** Starts a session on `machineId` and returns the id its route lives at. */
export function spawnSession({
  machineId,
  cwd,
  prompt,
  harness,
  permissionMode,
  model,
  effort,
  scratch,
  bootstrap,
  projectId,
}: {
  machineId: string;
  cwd: string;
  prompt?: string;
  harness?: HarnessKind;
  permissionMode?: PermissionMode;
  model?: string;
  effort?: EffortLevel;
  scratch?: SpawnPayload['scratch'];
  bootstrap?: SpawnPayload['bootstrap'];
  projectId?: string;
}): string {
  const created = start({
    machineId,
    cwd,
    harness,
    permissionMode,
    model,
    effort,
    scratch,
    bootstrap,
    projectId,
  });
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
  harness = 'claude',
  history = [],
}: {
  machineId: string;
  cwd: string;
  sessionId: string;
  harness?: HarnessKind;
  history?: Message[];
}): string {
  // Already running? Then this is not a resume, it is a way back to it.
  const live = state.instances.find((row) => row.sessionId === sessionId && isLive(row));
  if (live) {
    const existing = session(live.id);
    existing.machineId ||= live.machineId;
    existing.cwd ||= live.cwd;
    existing.sessionId = sessionId;
    existing.harness = (live.harness as HarnessKind) ?? harness;
    return live.id;
  }

  const created = start({ machineId, cwd, harness, resume: { sessionKey: sessionId } });
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
  harness = 'claude',
  history = [],
  at,
}: {
  machineId: string;
  cwd: string;
  sessionId: string;
  harness?: HarnessKind;
  history?: Message[];
  /** Branch from this assistant turn rather than from the end — see {@link rewindPoint}. */
  at?: string;
}): string {
  const created = start({
    machineId,
    cwd,
    harness,
    resume: { sessionKey: sessionId, fork: true, ...(at && { atMessage: at }) },
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
  // Before any frame: the whole point of the clock is the wait for the first one.
  trackWorking(target);
}

/**
 * The other half of durability: a message to a dead session revives it first.
 * The daemon respawns the same instance with `resume`, then the text goes
 * through as usual — the reader never has to know the process died.
 */
/**
 * Brings a dead-but-resumable session back before anything is asked of it.
 * A process can die between one action and the next — a daemon restart, a
 * crash — and the reader should not have to know which of their actions
 * happens to revive it. Returns once the session can take work again.
 */
export async function ensureAlive(instanceId: string, machineId: string): Promise<void> {
  const target = session(instanceId);
  const row = state.instances.find((candidate) => candidate.id === instanceId);
  const dead = row && (row.status === 'error' || row.status === 'stopped');
  if (dead && target.sessionId) {
    const requestId = newId();
    const payload: SpawnPayload = {
      instanceId,
      cwd: target.cwd,
      harness: target.harness,
      resume: { sessionKey: target.sessionId },
      scratch: target.scratch ? {} : undefined,
      // The new process answers the way the old one did: a revive nobody asked
      // for is not the moment to hand the session back on other settings.
      //
      // Falls back to the row, because the store learns these from a running
      // session and a dead one has told it nothing — a tab opened after the
      // process died holds `null` for both, and sending nothing is how a
      // session comes back asking permission for everything.
      permissionMode: (target.permissionMode ?? row?.permissionMode ?? undefined) as
        | PermissionMode
        | undefined,
      model: target.model ?? row?.model ?? undefined,
      effort: (target.effort ?? row?.effort ?? undefined) as EffortLevel | undefined,
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
}

export async function sendOrRevive(
  instanceId: string,
  machineId: string,
  text: string,
  extras?: SendExtras
): Promise<void> {
  await ensureAlive(instanceId, machineId);
  sendText(instanceId, machineId, text, extras);
}

/**
 * Hands a note to another session. The target is usually busy, so this never
 * interrupts it: the note lands in its transcript at once and is answered when
 * it next takes a turn (see {@link peerMessage}).
 *
 * A sleeping target is revived first. The alternative is a message that goes
 * nowhere and a sender told it was delivered — and a hand-off you cannot trust
 * to arrive is worse than no hand-off, because you stop checking.
 */
export async function sendToPeer(
  target: { instanceId: string; machineId: string },
  from: { instanceId: string; label: string },
  text: string
): Promise<void> {
  await ensureAlive(target.instanceId, target.machineId);
  const payload: SendPayload = {
    instanceId: target.instanceId,
    message: peerMessage(text, { id: from.instanceId, name: from.label }),
  };
  send({
    verb: 'send',
    machineId: target.machineId,
    instanceId: target.instanceId,
    payload,
  });
}

/** Sessions this one can hand work to: every other live session in the fleet. */
export function peerTargets(exceptInstanceId: string): InstanceRow[] {
  return state.instances.filter((row) => row.id !== exceptInstanceId && isLive(row));
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
  const requestId = newId();
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
    // `null` is how the harness clears a tag; the catalog is re-read for the
    // entry that has just stopped being hidden.
    await machineControl(
      target.machineId,
      'tagSession',
      [target.sessionId, null, { dir: target.cwd || undefined }],
      CONTROL_TIMEOUT_MS,
      target.harness
    );
    await loadCatalog(target.machineId);
  }
}

/** The view state a session leaves behind once it is no longer running. */
function settleStopped(instanceId: string): void {
  const target = session(instanceId);
  target.busy = false;
  target.currentTool = null;
  clearTurnPhase(target);
  // The agent denies whatever was parked as it tears the session down, so these
  // answer to nobody — leaving them would pin a dead session to the fleet rail.
  target.pending = [];
  trackWorking(target);
}

function control(instanceId: string, machineId: string, method: string, args: unknown[]): void {
  const payload: ControlPayload = { instanceId, requestId: newId(), method, args };
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
  replyTimeoutMs = CONTROL_TIMEOUT_MS,
  harness?: HarnessKind
): Promise<T> {
  await waitForOpen();
  const requestId = newId();
  const payload: ControlPayload = { requestId, method, args, ...(harness && { harness }) };
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
  const requestId = newId();
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
  // A transcript that already has turns in it is a session that already
  // started, so the banner announcing the start has had its moment. The SDK
  // re-emits `system.init` every turn; without this, every reload re-arms the
  // flag and the next turn opens with "Session started" as if the process had
  // just come up — which is exactly what it does *not* mean.
  if (transcript.length > 0) target.initialized = true;

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
  harness = 'claude',
}: {
  viewId: string;
  machineId: string;
  sessionId: string;
  cwd: string;
  harness?: HarnessKind;
}): Promise<void> {
  const target = session(viewId);
  target.machineId = machineId;
  target.cwd = cwd;
  target.sessionId = sessionId;
  target.harness = harness;
  // A stored session's plan is still on its machine, and no frame will ever
  // arrive to say so — opening it is the only moment there is to ask.
  refreshTasks(viewId);
  // Re-opening what is already read — or still hydrating, which has published
  // its newest turns by now — must not start a second read over the top of it.
  if (target.messages.length > 0 || target.loading) return;

  const epoch = claimTranscript(viewId);
  target.loading = true;
  try {
    const transcript = await machineControl<SessionMessage[]>(
      machineId,
      'getSessionMessages',
      [sessionId, { dir: cwd || undefined }],
      CONTROL_TIMEOUT_MS,
      harness
    );
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
  // Deliberately not "it already has messages, so it is loaded".
  //
  // This browser watches every session, not just the one on screen, so a
  // session left in another tab quietly collects the frames of whatever it did
  // meanwhile. Treating those few as a transcript meant switching to it showed
  // the last thing it said and nothing before — and `backfilled` latched that
  // for the rest of the tab, which is why only a hard refresh fixed it. Live
  // frames are the tail of a conversation, never the whole of one.
  if (target.loading) return;
  const { machineId, sessionId, cwd } = target;
  if (!machineId || !sessionId) return;

  backfilled.add(instanceId);
  backfilling.set(instanceId, []);
  // Whatever this session said while the reader was elsewhere. The transcript
  // that is about to arrive replaces the message list wholesale, so these are
  // kept and re-applied behind it — deduplicated against it by uuid, exactly
  // like the frames that land *during* the fetch.
  const live = target.messages.slice();
  const epoch = claimTranscript(instanceId);
  target.loading = true;
  try {
    const transcript = await machineControl<SessionMessage[]>(
      machineId,
      'getSessionMessages',
      [sessionId, { dir: cwd || undefined }],
      CONTROL_TIMEOUT_MS,
      target.harness
    );
    const seeded = new Set(transcript.map((entry) => entry.uuid));
    await ingestTranscript(instanceId, target, transcript, epoch, () => {
      target.streaming = '';
      clearTurnPhase(target);
      // Anything seen live that the stored transcript does not carry yet — the
      // newest turn is written to disk a moment after it is streamed, so this
      // is what stops the last thing on screen vanishing on a switch.
      const absorbed = new Set<Message>();
      for (const message of live) {
        if (message.sdkUuid && seeded.has(message.sdkUuid)) continue;
        if (target.messages.some((existing) => existing.id === message.id)) continue;
        // An unstamped local echo of a turn the transcript already carries.
        // Its stamping frame is about to be dropped by replayHeld (the uuid is
        // seeded), so left here it would double the stored turn — the "first
        // prompt shows twice" bug. Absorbed one-to-one by content so a genuine
        // repeated send keeps both bubbles.
        const echoOfStored =
          message.type === 'user' &&
          !message.sdkUuid &&
          target.messages.find(
            (m) =>
              m.type === 'user' && m.sdkUuid && !absorbed.has(m) && m.content === message.content
          );
        if (echoOfStored) {
          absorbed.add(echoOfStored);
          continue;
        }
        if (mergePeerMessage(target.messages, message)) continue;
        target.messages.push(message);
      }
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
    if (frame.kind === 'frame') {
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
  const target = session(instanceId);
  target.busy = false;
  // The block the partials were painting is not being finished, and a session
  // with a subagent still out stays "working" — long enough for a trace nobody
  // is writing any more to read as one that is.
  clearTurnPhase(target);
  trackWorking(target);
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
  // Switching a setting on a session whose process died must not fail:
  // revive it first, then apply.
  await ensureAlive(instanceId, machineId);
  const target = session(instanceId);
  const previous = target.permissionMode;
  target.permissionMode = mode;

  const requestId = newId();
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
  // Only once the daemon has taken it: a refused switch never reaches the row.
  void persistSettings(instanceId, { permissionMode: mode });
}

/**
 * How full the session's context window is, straight from the SDK — the same
 * reading `/context` shows, so the dock never has to estimate it from token
 * counts it saw go past. A `Query` method, so only a live session can answer;
 * a dead one keeps its last number rather than dropping to zero, which would
 * read as "empty" when it means "nobody asked".
 */
export async function refreshContext(instanceId: string, machineId: string): Promise<void> {
  const target = session(instanceId);
  if (target.contextPending) return;
  target.contextPending = true;
  const requestId = newId();
  const payload: ControlPayload = { instanceId, requestId, method: 'getContextUsage', args: [] };
  try {
    const usage = await ask<{
      totalTokens: number;
      maxTokens: number;
      percentage: number;
      categories: { name: string; tokens: number; color: string }[];
    }>(requestId, 'getContextUsage', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'control', machineId, instanceId, requestId, payload })
    );
    target.context = {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      // "Free space" is the remainder, not a consumer: showing it as a slice
      // would make every session look mostly full of nothing.
      categories: (usage.categories ?? []).filter((row) => row.name !== 'Free space'),
      readAt: Date.now(),
    };
  } catch {
    // A session that cannot answer keeps the last reading; the meter says when.
  } finally {
    target.contextPending = false;
  }
}

/**
 * The models this session offers. `supportedModels` is a `Query` method, so it
 * is only answerable while the session is up — the answer is the same account's
 * either way, so `models.svelte.ts` asks once through whoever is running and
 * keeps it for the whole app.
 */
export async function loadModels(instanceId: string, machineId: string): Promise<ModelInfo[]> {
  const requestId = newId();
  const payload: ControlPayload = { instanceId, requestId, method: 'supportedModels', args: [] };
  return ask<ModelInfo[]>(requestId, 'supportedModels', CONTROL_TIMEOUT_MS, () =>
    send({ verb: 'control', machineId, instanceId, requestId, payload })
  );
}

/** A `SlashCommand[]` answer as the lookup the menu reads its prose from. */
const detailsOf = (commands: SlashCommand[]): Map<string, SlashCommand> =>
  new Map(commands.map((command) => [command.name, command]));

/**
 * What each of this session's commands does. `supportedCommands` is a `Query`
 * method, so only a live session can answer — and only the prose is at stake:
 * the names come free on every init, so a session that cannot answer still has
 * a menu. Asked once, the first time somebody opens it; a `commands_changed`
 * push replaces the answer.
 */
export async function loadCommands(instanceId: string, machineId: string): Promise<void> {
  const target = session(instanceId);
  if (target.commands.detailed || target.commandsPending) return;
  target.commandsPending = true;

  const requestId = newId();
  const payload: ControlPayload = { instanceId, requestId, method: 'supportedCommands', args: [] };
  try {
    const commands = await ask<SlashCommand[]>(
      requestId,
      'supportedCommands',
      CONTROL_TIMEOUT_MS,
      () => send({ verb: 'control', machineId, instanceId, requestId, payload })
    );
    target.commands = { ...target.commands, detailed: detailsOf(commands) };
  } catch (error) {
    // The menu is still every name the init frame listed, undescribed, and the
    // next opening asks again — nothing the reader needs to act on.
    console.error(`[cockpit] supportedCommands on ${instanceId} failed:`, error);
  } finally {
    target.commandsPending = false;
  }
}

/** The bare `mcpServerStatus` call; what the caller does with a refusal differs. */
function askMcp(instanceId: string, machineId: string): Promise<McpServerStatus[]> {
  const requestId = newId();
  const payload: ControlPayload = { instanceId, requestId, method: 'mcpServerStatus', args: [] };
  return ask<McpServerStatus[]>(requestId, 'mcpServerStatus', CONTROL_TIMEOUT_MS, () =>
    send({ verb: 'control', machineId, instanceId, requestId, payload })
  );
}

/**
 * Which MCP servers this session runs, for the header's chips. `mcpServerStatus`
 * is a Query method, so only a live session answers. A failed ask stores `[]`
 * rather than staying null: null is what re-triggers the asking effect, and a
 * machine that cannot answer must not be asked in a loop.
 */
export async function loadMcpServers(instanceId: string, machineId: string): Promise<void> {
  const target = session(instanceId);
  if (target.mcp !== null || target.mcpPending) return;
  target.mcpPending = true;

  try {
    target.mcp = await askMcp(instanceId, machineId);
  } catch (error) {
    console.error(`[cockpit] mcpServerStatus on ${instanceId} failed:`, error);
    target.mcp = [];
  } finally {
    target.mcpPending = false;
  }
}

/** The same question again after a restart or a stop, cache ignored. */
export async function refreshMcpServers(instanceId: string, machineId: string): Promise<void> {
  const target = session(instanceId);
  if (target.mcpPending) return;
  target.mcpPending = true;

  try {
    target.mcp = await askMcp(instanceId, machineId);
  } catch (error) {
    // A failed refresh keeps the stale list: blanking chips that were fine is a
    // worse answer than showing the reading from a moment ago.
    console.error(`[cockpit] mcpServerStatus on ${instanceId} failed:`, error);
  } finally {
    target.mcpPending = false;
  }
}

/** Connects one MCP server again — what a `failed` or `needs-auth` chip offers. */
export async function restartMcpServer(
  instanceId: string,
  machineId: string,
  name: string
): Promise<void> {
  const requestId = newId();
  const payload: ControlPayload = {
    instanceId,
    requestId,
    method: 'reconnectMcpServer',
    args: [name],
  };
  await ask<void>(requestId, 'reconnectMcpServer', CONTROL_TIMEOUT_MS, () =>
    send({ verb: 'control', machineId, instanceId, requestId, payload })
  );
  await refreshMcpServers(instanceId, machineId);
}

/** Takes one MCP server out of this session's tool set, or puts it back. */
export async function setMcpServerEnabled(
  instanceId: string,
  machineId: string,
  name: string,
  enabled: boolean
): Promise<void> {
  const requestId = newId();
  const payload: ControlPayload = {
    instanceId,
    requestId,
    method: 'toggleMcpServer',
    args: [name, enabled],
  };
  await ask<void>(requestId, 'toggleMcpServer', CONTROL_TIMEOUT_MS, () =>
    send({ verb: 'control', machineId, instanceId, requestId, payload })
  );
  await refreshMcpServers(instanceId, machineId);
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
  // Switching a setting on a session whose process died must not fail:
  // revive it first, then apply.
  await ensureAlive(instanceId, machineId);
  const target = session(instanceId);
  const previous = target.model;
  target.model = model;

  const requestId = newId();
  const payload: ControlPayload = { instanceId, requestId, method: 'setModel', args: [model] };
  try {
    await ask<void>(requestId, 'setModel', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'control', machineId, instanceId, requestId, payload })
    );
  } catch (error) {
    target.model = previous;
    throw error;
  }
  // Only once the daemon has taken it: a refused switch never reaches the row.
  void persistSettings(instanceId, { model });
}

/**
 * Changes how hard the session thinks, from the next turn on. Awaited like the
 * model and the permission mode, and for the same reason — but with one more:
 * the row is the only record effort has, so a switch the machine refused must
 * not be written down as one it took.
 */
export async function setEffort(
  instanceId: string,
  machineId: string,
  effort: EffortLevel
): Promise<void> {
  // Switching a setting on a session whose process died must not fail:
  // revive it first, then apply.
  await ensureAlive(instanceId, machineId);
  const target = session(instanceId);
  const previous = target.effort;
  target.effort = effort;

  const requestId = newId();
  const payload: ControlPayload = { instanceId, requestId, method: 'setEffort', args: [effort] };
  try {
    await ask<void>(requestId, 'setEffort', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'control', machineId, instanceId, requestId, payload })
    );
  } catch (error) {
    target.effort = previous;
    throw error;
  }
  void persistSettings(instanceId, { effort });
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

  const requestId = newId();
  const payload: SpawnPayload = {
    instanceId,
    cwd: target.cwd,
    harness: target.harness,
    resume: { sessionKey: target.sessionId },
    // A relaunch is a spawn like any other, so it has to say what it is: a quest
    // that stayed silent about it would come back as mainline work, untagged.
    scratch: target.scratch ? {} : undefined,
    permissionMode,
    // Only the mode is being changed, so the model the session was answering on
    // and the level it was thinking at both carry over — the spawn is the row's
    // new word on all three.
    model: target.model ?? undefined,
    effort: target.effort ?? undefined,
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

/**
 * Where a rewind lands: the turn `resumeSessionAt` names, and how much of the
 * transcript survives it.
 *
 * The SDK resumes "up to and including" an `SDKAssistantMessage.uuid`, so the
 * anchor has to be an assistant frame — and one that ended in words. A frame
 * whose blocks include a tool call would resume into a `tool_use` with no
 * result behind it, which the API refuses outright, so the search walks past
 * those to the last turn that closed.
 */
function rewindPoint(target: SessionState, sdkUuid: string): { at: string; cut: number } | null {
  const edited = target.messages.findIndex((message) => message.sdkUuid === sdkUuid);
  if (edited < 0) return null;
  const calls = toolFrames(target.messages);
  for (let index = edited - 1; index >= 0; index--) {
    const { type, sdkUuid: uuid } = target.messages[index];
    if (type !== 'assistant' || !uuid || calls.has(uuid)) continue;
    // One assistant turn is several messages under one uuid; the whole frame
    // the anchor belongs to stays, because the SDK keeps all of it too.
    let cut = index + 1;
    while (cut < edited && target.messages[cut].sdkUuid === uuid) cut++;
    return { at: uuid, cut };
  }
  return null;
}

/** The uuids of assistant frames that asked for a tool — never a rewind anchor. */
function toolFrames(messages: Message[]): Set<string | undefined> {
  return new Set(
    messages
      .filter((message) => message.type === 'tool.use' || message.type === 'tool.handoff')
      .map((message) => message.sdkUuid)
  );
}

/**
 * Which of a session's turns can be rewound to, by uuid — what decides whether
 * the transcript offers the edit and fork affordances at all. One pass over the
 * transcript, because every message on screen asks the same question.
 */
export function rewindableTurns(instanceId: string): Set<string> {
  const turns = new Set<string>();
  const target = state.sessions[instanceId];
  if (!target) return turns;
  const calls = toolFrames(target.messages);
  let anchored = false;
  for (const message of target.messages) {
    if (message.type === 'user' && message.sdkUuid && anchored) turns.add(message.sdkUuid);
    if (message.type === 'assistant' && message.sdkUuid && !calls.has(message.sdkUuid)) {
      anchored = true;
    }
  }
  return turns;
}

/**
 * Says a turn again, differently. The session is started back up in place at
 * the answer before the edited message — same instance id, same SDK session,
 * `resumeSessionAt` cutting the conversation there — and the new wording goes
 * through as an ordinary turn, so everything the old one led to is gone from
 * both the screen and the session the next process reads back.
 */
export async function editAndResend(
  instanceId: string,
  sdkUuid: string,
  content: string
): Promise<void> {
  const target = session(instanceId);
  const machineId = target.machineId;
  if (!target.sessionId || !machineId) {
    throw new Error('This session has not named itself yet. Try again in a moment.');
  }
  const point = rewindPoint(target, sdkUuid);
  if (!point) {
    throw new Error('There is no answered turn behind this message to go back to.');
  }

  const requestId = newId();
  const payload: SpawnPayload = {
    instanceId,
    cwd: target.cwd,
    harness: target.harness,
    resume: { sessionKey: target.sessionId, atMessage: point.at },
    // The same four a relaunch carries: a rewind changes what the session has
    // said, not what it is.
    scratch: target.scratch ? {} : undefined,
    permissionMode: target.permissionMode ?? undefined,
    model: target.model ?? undefined,
    effort: target.effort ?? undefined,
    requestId,
  };

  // Cut on screen before the process is cut, so the rewind reads as the reader
  // asked for it — and put every bit of it back if the spawn never lands, or
  // they are left with a transcript shorter than the conversation behind it.
  const transcript = target.messages;
  const branches = target.subagents;
  const read = backfilled.has(instanceId);
  target.messages = transcript.slice(0, point.cut);
  const spawned = new Set(target.messages.map((message) => message.metadata?.toolId));
  target.subagents = Object.fromEntries(
    Object.entries(branches).filter(([toolUseId]) => spawned.has(toolUseId))
  );
  target.streaming = '';
  // Whatever was in flight belongs to the process being replaced.
  settleStopped(instanceId);
  // What is on screen is no longer the whole of what is on disk: the next join
  // has to read this session back rather than trust the latch.
  backfilled.delete(instanceId);
  target.relaunching = true;
  try {
    await ask<void>(requestId, 'rewind', CONTROL_TIMEOUT_MS, () =>
      send({ verb: 'spawn', machineId, instanceId, requestId, payload })
    );
    sendText(instanceId, machineId, content);
  } catch (error) {
    target.messages = transcript;
    target.subagents = branches;
    if (read) backfilled.add(instanceId);
    throw error;
  } finally {
    target.relaunching = false;
    void refresh();
  }
}

/**
 * A side quest that starts from the middle of a conversation rather than its
 * end: the fork the header offers, resumed at the turn the reader picked. The
 * session it branches from is left running and untouched.
 */
export function forkFrom(instanceId: string, sdkUuid: string): string {
  const target = session(instanceId);
  if (!target.sessionId || !target.machineId) {
    throw new Error('This session has not named itself yet. Try again in a moment.');
  }
  const point = rewindPoint(target, sdkUuid);
  if (!point) {
    throw new Error('There is no answered turn behind this message to branch from.');
  }
  return forkSession({
    machineId: target.machineId,
    cwd: target.cwd,
    sessionId: target.sessionId,
    harness: target.harness,
    history: target.messages.slice(0, point.cut),
    at: point.at,
  });
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
  trackWorking(target);
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
      // A delegate's ask is the parent's to answer, not the user's: it stays on
      // the delegate's own transcript but never lands in this queue.
      if (routedToParent(request)) continue;
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

/** What the palette groups by: what this machine was given, then the harness's own. */
const COMMAND_ORDER: Record<AvailableCommand['type'], number> = {
  skill: 0,
  custom: 1,
  builtin: 2,
  mcp: 3,
};

/**
 * Where a command came from, when its own name says: a plugin component wears
 * its plugin (`plugin:command`), an MCP prompt its server (`mcp__server__prompt`).
 */
function sourceOf(name: string): string | undefined {
  if (name.startsWith('mcp__')) return name.split('__')[1] || undefined;
  const namespace = name.indexOf(':');
  return namespace > 0 ? name.slice(0, namespace) : undefined;
}

/**
 * One session's `/` menu: every name it listed, wearing whatever
 * `supportedCommands` has since said about it. The init frame leads because it
 * arrives on every turn and is free — the descriptions are one lazy call behind
 * it, and are all there is before the first init.
 */
function availableCommands({ names, skills, detailed }: CommandState): AvailableCommand[] {
  const listed = names.length > 0 ? names : [...(detailed?.keys() ?? [])];
  return listed
    .map((name) => {
      const known = detailed?.get(name);
      return {
        name,
        // Both are required strings to the SDK, which sends '' for "none".
        description: known?.description || undefined,
        argumentHint: known?.argumentHint || undefined,
        type: classifyCommand(name, skills),
        source: sourceOf(name),
      };
    })
    .sort((a, b) => COMMAND_ORDER[a.type] - COMMAND_ORDER[b.type] || a.name.localeCompare(b.name));
}

/**
 * A branch is a real subagent iff it was spawned with a `subagent_type` that is
 * not the `branchFor` placeholder default. Background Bash tasks fire
 * `task_started` without a `subagent_type`, so they keep the default and are
 * filtered out of the rail's subagent list.
 */
const isRealSubagent = (branch: SubagentState): boolean =>
  branch.subagentType !== 'subagent';

/** Running first, then starting, then error, then complete; within each, newest activity first. */
const STATUS_RANK: Record<string, number> = { running: 0, starting: 1, error: 2, complete: 3 };
const branchOrder = (a: SubagentState, b: SubagentState): number => {
  const rankA = STATUS_RANK[a.status] ?? 3;
  const rankB = STATUS_RANK[b.status] ?? 3;
  if (rankA !== rankB) return rankA - rankB;
  const timeA = (a.lastEventAt ?? a.startedAt).getTime();
  const timeB = (b.lastEventAt ?? b.startedAt).getTime();
  return timeB - timeA;
};

export const cockpit = {
  get status() {
    return state.status;
  },
  get retryAt() {
    return state.retryAt;
  },
  /** What a session has been handed and not yet answered; `null` for most. */
  handoffFor: (instanceId: string): { from: string; at: number } | null =>
    state.handoffs[instanceId] ?? null,
  get machines() {
    return state.machines;
  },
  get onlineMachines() {
    return state.machines.filter((machine) => machine.status === 'online');
  },
  /** One machine's latest Claude limit reading, or null until it has reported. */
  usageLimitsFor: (machineId: string): ClaudeLimits | null => state.usageLimits[machineId] ?? null,
  /**
   * Any machine's reading. Limits belong to the account, not the host: every
   * machine signed in to the same account reports the same percentages, so the
   * app chrome shows the first real reading it has and prefers one without an
   * error over a machine that is merely signed out.
   */
  usageLimitsAny: (): ClaudeLimits | null => {
    const readings = Object.values(state.usageLimits);
    return readings.find((r) => r.error === null) ?? readings[0] ?? null;
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
  listedOn,
  /** The ones the hub can still reach: what this machine is doing right now. */
  liveOn: (machineId: string): InstanceRow[] => listedOn(machineId).filter(isLive),
  /**
   * The ones whose process is gone — asleep, or failed. A different question
   * from the live list, so it is a different list rather than a heading that
   * changes its mind about what it is over.
   */
  notRunningOn: (machineId: string): InstanceRow[] =>
    listedOn(machineId).filter((row) => !isLive(row)),
  /** Every session the rail lists: live work, plus what failed or fell asleep. */
  get listedInstances(): InstanceRow[] {
    return state.instances.filter(isListed);
  },
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
  /**
   * The hub's record of one delegate's exchange with its parent, oldest first.
   * Empty for a delegate whose traffic predates the table — its card falls back
   * to reading the markers out of the parent's transcript.
   */
  delegateEventsOf: (instanceId: string): DelegateEvent[] =>
    state.delegateEvents[instanceId] ?? [],
  /** The ask a permission requestId belongs to, whichever delegate raised it. */
  delegateAskOf: (requestId: string): DelegateAskEvent | null => {
    for (const events of Object.values(state.delegateEvents)) {
      const ask = events.find((event) => event.kind === 'ask' && event.requestId === requestId);
      if (ask?.kind === 'ask') return ask;
    }
    return null;
  },
  /** What a session needs from you — `idle` for one nothing has been heard from. */
  activityOf: (instanceId: string): Activity => {
    const target = state.sessions[instanceId];
    // Blocked wins everywhere: a parked permission is broadcast, not filtered.
    if (target && target.pending.length > 0) return 'blocked';
    // An open session's frames are live and authoritative; anything else falls
    // back to the daemon's pulse — the only word on a session this browser has
    // not subscribed to, whose frame-fed state is frozen at the tab that closed.
    if (target && isSubscribed(instanceId)) return activityOf(target);
    const pulse = state.pulses[instanceId];
    if (pulse) return pulse.activity;
    return target ? activityOf(target) : 'idle';
  },
  currentToolOf: (instanceId: string): { name: string; glance: string } | null => {
    const target = state.sessions[instanceId];
    if (target && isSubscribed(instanceId)) return target.currentTool;
    return state.pulses[instanceId]?.currentTool ?? null;
  },
  /**
   * When the daemon last pulsed a session, ms epoch — the freshest signal a
   * rail has for an unsubscribed session, since the pulse is broadcast for
   * every session while its transcript frames only flow to a watcher.
   */
  pulseAt: (instanceId: string): number | undefined => state.pulses[instanceId]?.at,
  /** What a session offers behind `/`, grouped the way the palette lists it. */
  commandsOf: (instanceId: string): AvailableCommand[] => {
    const target = state.sessions[instanceId];
    return target ? availableCommands(target.commands) : [];
  },
  /** The subagents a session has out, sorted by state then recency. */
  subagentsOf: (instanceId: string): SubagentState[] =>
    Object.values(state.sessions[instanceId]?.subagents ?? {})
      .filter(isRealSubagent)
      .sort(branchOrder),
  /** Background tasks that are not real subagents. */
  backgroundTasksOf: (instanceId: string): number =>
    Object.values(state.sessions[instanceId]?.subagents ?? {}).filter(
      (branch) => !isRealSubagent(branch)
    ).length,
  /** Just the count of running *real* subagents, for the badge. */
  runningSubagentsOf: (instanceId: string): number => {
    const target = state.sessions[instanceId];
    if (target && isSubscribed(instanceId)) return runningSubagents(target.subagents);
    return state.pulses[instanceId]?.runningSubagents ?? 0;
  },
  get blocked(): BlockedRequest[] {
    return blockedRequests();
  },
  get blockedCount(): number {
    return blockedRequests().length;
  },
};

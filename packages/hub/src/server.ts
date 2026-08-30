import type {
  AgentRow,
  BuildInfo,
  ClaudeLimits,
  ControlPayload,
  DeployInfo,
  DeployKind,
  EffortLevel,
  Envelope,
  FleetConfig,
  FleetHook,
  FleetMcpConfig,
  FleetSyncReport,
  FramePayload,
  FsPayload,
  HarnessKind,
  HarnessReport,
  HookDraft,
  InstanceRow,
  MachineMemorySet,
  NeutralSessionInfo,
  PermissionMode,
  QueuedMessage,
  Rule,
  RuleDraft,
  SendPayload,
  SessionPulse,
  SkillFile,
  SpawnPayload,
  ToolState,
  ToolStatus,
  UsageBlock,
  UsageBucket,
  Verb,
  IngestMark,
  RegisterAckPayload,
} from '@cockpit/core';
import {
  AGENT_BUSY,
  agentProblem,
  ASK_USER_QUESTION,
  CONTROL_GET_SESSION_MESSAGES,
  CONTROL_LIST_SESSIONS,
  deriveTitleFromFirstMessage,
  FLEET_STATUS,
  FLEET_SYNC,
  HOOK_TEMPLATES,
  hookProblem,
  identifyBlocks,
  INSPECT_CONFIG,
  RULE_TEMPLATES,
  ruleProblem,
  memoryDocProblem,
  MESSAGE_DEQUEUED,
  MESSAGE_QUEUED,
  parseAgentFrontMatter,
  READ_MEMORY_FILE,
  READ_SKILL_FILES,
  readProvenance,
  RESOLVE_PERMISSION,
  RESTART_RESUMABLE,
  TOOL_CATALOG,
  toolSpec,
  UPDATE_COCKPIT,
} from '@cockpit/core';
import { Elysia, t } from 'elysia';
import { websocket } from 'elysia/websocket';
import { buildInfo } from './build';
import { HUB_VERSION } from './config';
import { delegateTypesRoutes, makeDelegateTypes } from './delegate-types';
import { RuleEngine } from './rules';
import type { AgentAuth, DbShape, DelegateEvent, InstanceKind } from './db';
import { usageBucketFromRow } from './db';
import type { PendingShape } from './pending';
import type { HubSocket, RegistryShape } from './registry';
import { resolveMarketplacePlugins } from './plugins';
import { hashFiles, resolveSkill } from './skills';
import { createStreamHub, HUB_CAPABILITIES } from './stream';
import type { TelegramBridge } from './telegram';

/** The frame a forwarded `control` comes back as, whoever asked for it. */
type ControlResult = Extract<FramePayload, { kind: 'control_result' }>;

/** A busy probe is polled in a loop before a restart, so it answers fast or not at all. */
const BUSY_TIMEOUT_MS = 5_000;

/**
 * How far back a register will reach to restart a session it finds orphaned.
 *
 * Ours, because nothing in the protocol declares a session worth reviving. A
 * daemon restart — a crash, an update, a `systemctl restart` — puts the machine
 * back inside seconds to a couple of minutes, and the sessions that were alive
 * across that gap are the ones the operator was in the middle of. Half an hour
 * covers that with room to spare while excluding the case that produced the
 * defect this bound exists for: a machine that had been down for a day and a
 * half came back and the hub cheerfully re-spawned every session it had ever
 * held, because an orphan from 36 hours ago and an orphan from 30 seconds ago
 * were treated identically. Older rows are not lost — they settle as `sleeping`
 * and the operator wakes the ones they want.
 */
const RESTORE_HORIZON_MS = 30 * 60_000;

/**
 * And how many, newest first.
 *
 * Ours, because a register is one message and the respawns it triggers all land
 * on one machine at once. Twenty simultaneous harness launches is already a
 * heavy but survivable burst; the 178 rows that motivated this work would have
 * been a fork bomb wearing a recovery hat. Everything past the cap settles as
 * `sleeping`, which is a wake button away.
 */
const RESTORE_MAX = 20;

/**
 * How long a `starting` row is given before a heartbeat that does not list it
 * counts as evidence that the spawn never landed.
 *
 * Ours: three beats at the daemon's 15s `HEARTBEAT_INTERVAL` (`packages/agent/
 * src/daemon.ts`). The race it covers is real and one-sided — the hub writes
 * `starting` the instant it forwards a spawn, and the beat already in flight
 * from that machine cannot possibly know about it — so the grace only has to
 * outlast the round trip plus a harness launch. It applies to `starting` alone:
 * a row that was confirmed `running` and then went unlisted is not racing
 * anything.
 */
const HEARTBEAT_SETTLE_GRACE_MS = 45_000;

/** An update is a pull, an install and a dashboard build — minutes, not seconds. */
const UPDATE_TIMEOUT_MS = 10 * 60_000;

/** Reading one file off a machine: it answers about as fast as a disk does. */
const READ_TIMEOUT_MS = 10_000;

/**
 * How many conversations one naming request may ask about. A reader's open tabs
 * are a couple of dozen at the outside; the cap is what keeps a hand-written
 * body from turning a single request into a fleet-wide transcript sweep.
 */
const TITLE_ASK_LIMIT = 64;

/** Entries per flush of a streamed transcript — small enough to paint, big enough not to thrash. */
const TRANSCRIPT_FLUSH = 25;

/**
 * A rule draft as the wire carries it — shared by create (POST, the hub mints
 * the id) and edit (PUT to an id that already exists). Validated loosely here
 * and strictly by `ruleProblem`, so the form and the hub refuse in the same
 * sentences.
 */
const ruleBody = t.Object({
  name: t.String(),
  enabled: t.Boolean(),
  pattern: t.String(),
  matchKind: t.Union([t.Literal('phrase'), t.Literal('regex')]),
  caseSensitive: t.Boolean(),
  wholeWord: t.Boolean(),
  watch: t.Union([t.Literal('text'), t.Literal('thinking'), t.Literal('both')]),
  reply: t.String(),
  timing: t.Union([t.Literal('turn'), t.Literal('message'), t.Literal('immediate')]),
  interrupt: t.Boolean(),
  requireAck: t.Boolean(),
  scope: t.Object({
    machineId: t.Optional(t.String()),
    projectId: t.Optional(t.String()),
    harness: t.Optional(t.String()),
    model: t.Optional(t.String()),
  }),
});

/**
 * A transcript on its way to a browser, newest entry first, one JSON object per
 * line. Newest first because that is what the reader is looking at: the tail
 * lands in the first flush and the rest fills in behind it, so a long session
 * paints in milliseconds instead of after its last line has crossed the wire.
 * The whole array is already in hand — `getSessionMessages` answers in one
 * `control_result` — so this streams the *delivery*, which is what the reader
 * waits through.
 */
const ndjsonNewestFirst = (rows: unknown[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let cursor = rows.length - 1;
  return new ReadableStream({
    pull(controller) {
      if (cursor < 0) {
        controller.close();
        return;
      }
      let chunk = '';
      for (let n = 0; n < TRANSCRIPT_FLUSH && cursor >= 0; n++, cursor--) {
        chunk += `${JSON.stringify(rows[cursor])}\n`;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });
};

export interface HubServices {
  readonly registry: RegistryShape;
  readonly db: DbShape;
  readonly pending: PendingShape;
  /** Absent unless the hub was given a bot token; every call site guards for it. */
  readonly telegram?: TelegramBridge;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Envelope).verb === 'string' &&
  typeof (value as Envelope).machineId === 'string';

const ack = (envelope: Envelope): Envelope<{ ok: true }> => ({
  verb: envelope.verb,
  machineId: envelope.machineId,
  payload: { ok: true },
});

/**
 * `register`'s ack, carrying the ingest ledger for the instances the daemon
 * says it is holding (sessiond design §7, step 3). Additive on {@link ack}: an
 * agent that predates the field reads `{ ok: true }` exactly as it always did,
 * and this hub gains nothing to explain to it.
 */
const registerAck = (
  envelope: Envelope,
  ingested: Record<string, IngestMark>
): Envelope<RegisterAckPayload> => ({
  verb: envelope.verb,
  machineId: envelope.machineId,
  payload: { ok: true, ingested },
});

/** Sent back as a frame, the only verb a dashboard renders. */
const failure = (
  envelope: Envelope,
  message: string,
): Envelope<{ kind: 'error'; verb: Verb; message: string }> => ({
  verb: 'frames',
  machineId: envelope.machineId,
  instanceId: envelope.instanceId,
  requestId: envelope.requestId,
  payload: { kind: 'error', verb: envelope.verb, message },
});

/**
 * The hub routes on envelope fields and is otherwise payload-opaque (NEW.md
 * §6); `hostname`/`os`/`tools` on register, `cwd`/`options.resume`/`scratch`/
 * `projectId`/`title`/`permissionMode`/`model` on spawn, `discard` on stop,
 * `kind` on a frame, `method`/`args` on a control and a `control_result`'s
 * `result` are the sanctioned peeks.
 */
const peek = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

/** The last path segment — how the rail names a session. */
const leaf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

/**
 * Renders a parked ask readably for the parent session that has to answer it:
 * a question's text and option labels verbatim, or a tool's name and its input
 * summary. The parent reads this off a peer message and answers with the
 * `answer_delegate` tool, so the phrasing has to carry every choice it needs.
 */
const renderDelegateAsk = (payload: unknown): string => {
  const toolName = peek(payload, 'toolName');
  const input = (payload as { input?: unknown } | null)?.input;
  const questions = (input as { questions?: unknown } | null)?.questions;
  if (
    (peek(payload, 'requestKind') === 'question' || toolName === ASK_USER_QUESTION) &&
    Array.isArray(questions) &&
    questions.length > 0
  ) {
    return questions
      .map((question, index) => {
        const q = question as { question?: unknown; options?: unknown };
        const options = Array.isArray(q.options)
          ? q.options
              .map((option) => (option as { label?: unknown }).label)
              .filter((label): label is string => typeof label === 'string')
              .map((label) => `- ${label}`)
              .join('\n')
          : '';
        const text = typeof q.question === 'string' ? q.question : '';
        return `Q${index + 1}: ${text}${options ? `\n${options}` : ''}`;
      })
      .join('\n');
  }
  const summary =
    input === undefined || input === null
      ? ''
      : typeof input === 'string'
        ? input
        : JSON.stringify(input);
  return `${toolName ?? 'a tool'}${summary ? ` — ${summary}` : ''}`;
};

/**
 * The session a `spawn` resumes, so the instance row records what it re-opened.
 * A fork is the exception: it *reads* the origin conversation but creates a new
 * one, so claiming the origin's id here would trip openInstance's
 * one-conversation-one-row guard. Left blank, the fork's own init frame stamps
 * the real id via noteInstanceSession.
 */
const peekResume = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { resume } = payload as { resume?: unknown };
  if (typeof resume !== 'object' || resume === null) return undefined;
  if ((resume as { fork?: unknown }).fork) return undefined;
  const key = (resume as { sessionKey?: unknown }).sessionKey;
  return typeof key === 'string' ? key : undefined;
};

/** A spawn asking for scratch isolation, or for a session that is never stored. */
const peekKind = (payload: unknown): InstanceKind => {
  if (typeof payload !== 'object' || payload === null) return 'mainline';
  const { scratch, persistSession } = payload as { scratch?: unknown; persistSession?: unknown };
  return scratch || persistSession === false ? 'scratch' : 'mainline';
};

/** Which harness a spawn names; absent reads as claude. */
const peekHarness = (payload: unknown): string | undefined => peek(payload, 'harness');

/** The session a spawn is a delegate of, so its row nests under the parent. */
const peekParent = (payload: unknown): { parentInstanceId?: string; parentToolUseId?: string } => {
  if (typeof payload !== 'object' || payload === null) return {};
  const { parent } = payload as { parent?: unknown };
  if (typeof parent !== 'object' || parent === null) return {};
  const { instanceId, toolUseId } = parent as { instanceId?: unknown; toolUseId?: unknown };
  return {
    ...(typeof instanceId === 'string' ? { parentInstanceId: instanceId } : {}),
    ...(typeof toolUseId === 'string' ? { parentToolUseId: toolUseId } : {}),
  };
};

/**
 * A delegate's effective permission mode, resolved to the ROOT of its delegate
 * tree. A delegate spawned by another delegate carries no `permissionMode` of
 * its own (the opencode plugin's `delegate` tool omits it), so the daemon's
 * `autoAllows` would park its tool asks even though the tree's root session
 * runs under `bypassPermissions`. Walk `parentInstanceId` up to the root and
 * inherit its mode, so the child spawns with it explicitly and the row records
 * it. `rows` is the hub's instance table; `parentInstanceId` the spawn's
 * immediate parent. Pure, so it is exercised directly.
 */
export const resolveDelegatePermissionMode = (rows: InstanceRow[], parentInstanceId: string): string | undefined => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  let current: string | undefined = parentInstanceId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = byId.get(current);
    if (!row) break;
    const parent = row.parentInstanceId;
    if (parent && parent !== current) {
      current = parent;
      continue;
    }
    return row.permissionMode ?? undefined;
  }
  return undefined;
};

/** `register`'s word on what each harness adapter on the machine can do. */
const peekHarnesses = (payload: unknown): HarnessReport[] | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as { harnesses?: unknown }).harnesses;
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (report): report is HarnessReport =>
      typeof report === 'object' &&
      report !== null &&
      typeof (report as HarnessReport).harness === 'string'
  );
};

/** The states a daemon is allowed to claim; anything else is a daemon we do not know. */
const AUTH_STATES: readonly AgentAuth[] = [
  'authenticated',
  'unauthenticated',
  'unreadable-credentials',
];

/** `register`'s word on whether the machine can reach Claude Code's credentials. */
const peekAuth = (payload: unknown): AgentAuth => {
  const claimed = peek(payload, 'auth') as AgentAuth | undefined;
  return claimed && AUTH_STATES.includes(claimed) ? claimed : 'unknown';
};

/** `register`'s list of the sessions the daemon still has running. */
const peekInstances = (payload: unknown): string[] => {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = (payload as { instances?: unknown }).instances;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
};

/**
 * THE SESSIONS A REGISTER ACK'S LEDGER MUST COVER (sessiond design §7, step 3).
 *
 * The ledger used to be computed off `instances` alone — the daemon's own live
 * list — which is EMPTY exactly when replay matters: a daemon that just
 * restarted holds nothing, so the ack carried `{}`, every reattach followed
 * from head, and the lines sessiond buffered during the absence were dropped
 * instead of recovered. The at-most-once half of §7 fired; the replay half
 * never did.
 *
 * It cannot be fixed from the daemon's side, because naming those ids in
 * `instances` is what makes `settleInstances` call them live — and then the hub
 * stops sending the `restore` spawns that are the daemon's ONLY source of a
 * surviving child's `cwd`. So the hub answers it instead, from the one place
 * that already knows both halves: the sessions it just told this daemon to
 * restore are precisely the rows the daemon will hand to `reattachFrom`, and a
 * mark for anything else is a mark it could never act on.
 *
 * Union, de-duplicated, order preserved: `reported` covers a live daemon's
 * `reannounce`, `restored` covers the returning one.
 */
export const reattachable = (reported: readonly string[], restored: readonly string[]): string[] => [
  ...new Set([...reported, ...restored]),
];

/**
 * And of the SDK sessions it could resume. Absent from a daemon that could not
 * read its catalog, which is not the same as a machine with nothing to resume.
 */
const peekResumable = (payload: unknown): string[] | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as { resumable?: unknown }).resumable;
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === 'string');
};

/**
 * `register`'s word on the cockpit the daemon is running (NEW.md §12). Absent
 * from a daemon that predates it and from the re-announce, and the row keeps
 * what it had either way.
 */
const peekBuild = (payload: unknown): BuildInfo | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const build = (payload as { build?: unknown }).build;
  if (typeof build !== 'object' || build === null) return undefined;
  return typeof (build as BuildInfo).version === 'string' ? (build as BuildInfo) : undefined;
};

/** The kinds a daemon may claim for its deployment clone; anything else is not one. */
const DEPLOY_KINDS: readonly DeployKind[] = [
  'unmarked',
  'unreachable',
  'current',
  'behind',
  'ahead',
  'diverged',
];

/**
 * A machine's word on its deployment clone (contract C8), off a `register` or
 * off any heartbeat. Absent from a daemon that predates the deployment channel
 * and from one whose watcher has never ticked; a kind this hub does not know is
 * dropped rather than passed through, so a future state cannot arrive at an old
 * board as an unrenderable badge.
 */
const peekDeploy = (payload: unknown): DeployInfo | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const deploy = (payload as { deploy?: unknown }).deploy;
  if (typeof deploy !== 'object' || deploy === null) return undefined;
  const { kind, detail, updated, failure } = deploy as Partial<DeployInfo>;
  if (typeof kind !== 'string' || !DEPLOY_KINDS.includes(kind as DeployKind)) return undefined;
  return {
    kind: kind as DeployKind,
    ...(typeof detail === 'string' ? { detail } : {}),
    ...(updated === true ? { updated: true } : {}),
    ...(typeof failure === 'string' ? { failure } : {}),
  };
};

/**
 * Whether two deploy verdicts say the same thing. Compared field by field
 * rather than by identity: every beat arrives as a fresh object, and
 * republishing the whole board four times a minute per machine because the
 * bytes are new would cost every connected dashboard a full frame for no news.
 */
const sameDeploy = (a: DeployInfo | undefined, b: DeployInfo | undefined): boolean =>
  a?.kind === b?.kind && a?.detail === b?.detail && a?.updated === b?.updated && a?.failure === b?.failure;

/** The states a daemon may claim for a tool; anything else is not a status. */
const TOOL_STATES: readonly ToolState[] = [
  'installed',
  'missing',
  'installing',
  'failed',
  'unsupported',
];

const isToolStatus = (value: unknown): value is ToolStatus =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ToolStatus).id === 'string' &&
  TOOL_STATES.includes((value as ToolStatus).state);

/**
 * `register`'s word on what the machine has of the tool catalog (NEW.md §10).
 * Empty from a daemon that predates the feature, which is not the same as a
 * machine with none of them — the difference is what stops the hub installing
 * the whole catalog onto a daemon that has never been asked.
 */
const peekTools = (payload: unknown): ToolStatus[] => {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = (payload as { tools?: unknown }).tools;
  return Array.isArray(value) ? value.filter(isToolStatus) : [];
};

/** A `control` asking a machine to install a tool, and the tool it names. */
const peekInstall = (payload: unknown): string | undefined => {
  if (peek(payload, 'method') !== 'installTool') return undefined;
  const args = (payload as { args?: unknown }).args;
  const id = Array.isArray(args) ? args[0] : undefined;
  return typeof id === 'string' ? id : undefined;
};

/** A `control` answering a permission, and the ask it answers with what it says. */
const peekAnswer = (payload: unknown): { requestId: string; result: unknown } | undefined => {
  if (peek(payload, 'method') !== RESOLVE_PERMISSION) return undefined;
  const args = (payload as { args?: unknown }).args;
  if (!Array.isArray(args) || typeof args[0] !== 'string') return undefined;
  return { requestId: args[0], result: args[1] };
};

/** The chosen option labels an answer to a question carries, when it is one. */
const peekAnswers = (result: unknown): Record<string, unknown> | undefined => {
  if (typeof result !== 'object' || result === null) return undefined;
  const { updatedInput } = result as { updatedInput?: unknown };
  if (typeof updatedInput !== 'object' || updatedInput === null) return undefined;
  const { answers } = updatedInput as { answers?: unknown };
  return typeof answers === 'object' && answers !== null
    ? (answers as Record<string, unknown>)
    : undefined;
};

/** And what the machine answered it with. */
const peekToolStatus = (payload: unknown): ToolStatus | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  return isToolStatus(result) ? result : undefined;
};

const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null;

/** A sync's three tables of states, which is what tells a report from any other answer. */
const isFleetReport = (value: unknown): value is FleetSyncReport =>
  isRecord(value) &&
  isRecord((value as FleetSyncReport).mcp) &&
  isRecord((value as FleetSyncReport).marketplaces) &&
  isRecord((value as FleetSyncReport).plugins);

/** What a machine answered a `syncFleetConfig` with (NEW.md §11). */
const peekFleetReport = (payload: unknown): FleetSyncReport | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  return isFleetReport(result) ? result : undefined;
};

/** What the CLI will take as an MCP server name — it keys `~/.claude.json` by it. */
const MCP_NAME = /^[A-Za-z0-9_-]+$/;

/** And the names Claude Code keeps for its own servers, which are not the user's to take. */
const RESERVED_MCP_NAMES = [
  'workspace',
  'claude-in-chrome',
  'computer-use',
  'Claude Preview',
  'Claude Browser',
];

/**
 * Why the hub will not store this server, or nothing. The config itself is
 * stored verbatim — what a server means is the CLI's affair — but an entry
 * missing the one field that makes it startable is a row no machine can apply.
 */
const mcpProblem = (name: string, config: Record<string, unknown>): string | undefined => {
  if (!MCP_NAME.test(name)) return `${name} is not a usable MCP server name`;
  if (RESERVED_MCP_NAMES.includes(name)) return `${name} is Claude Code's own`;
  if ('url' in config || config.type === 'http' || config.type === 'sse') {
    return typeof config.type === 'string' && typeof config.url === 'string'
      ? undefined
      : 'a remote MCP server needs both a type and a url';
  }
  return typeof config.command === 'string' ? undefined : 'a stdio MCP server needs a command';
};

/** What a skill may be called: it names a directory under `~/.claude/skills`. */
const SKILL_NAME = /^[A-Za-z0-9._-]+$/;

/** `/home/<user>` or `/Users/<user>` — the prefix every path on a machine shares. */
const HOME_PREFIX = /^(\/(?:home|Users)\/[^/]+)/;

/** Whether a machine's last report says it still has anything of the fleet's on it. */
const holdsFleet = (report: FleetSyncReport | undefined): boolean =>
  report !== undefined &&
  ([report.mcp, report.marketplaces, report.plugins, report.skills, report.memoryDocs].some(
    (states) => Object.values(states ?? {}).some((item) => item.state !== 'removed')
  ) ||
    (report.memory !== undefined && report.memory.state !== 'removed'));

/** What a machine answered `readMemoryFile` with: its own memory set, or nothing. */
type MachineMemory = MachineMemorySet | null;

/**
 * The answer, read defensively — a daemon that predates the set answers with
 * the main file alone, and `docs` absent there is a machine that links none
 * rather than a machine that could not be read.
 */
const peekMemoryFile = (result: unknown): MachineMemory => {
  if (typeof result !== 'object' || result === null) return null;
  const { content, hash, docs } = result as { content?: unknown; hash?: unknown; docs?: unknown };
  if (typeof content !== 'string' || typeof hash !== 'string') return null;

  const read = Array.isArray(docs)
    ? docs.flatMap((doc: unknown) => {
        if (typeof doc !== 'object' || doc === null) return [];
        const { path, content: text, hash: of } = doc as Record<string, unknown>;
        return typeof path === 'string' && typeof text === 'string' && typeof of === 'string'
          ? [{ path, content: text, hash: of }]
          : [];
      })
    : undefined;
  return { content, hash, ...(read ? { docs: read } : {}) };
};

/** A read of a machine's memory, or the status the route should answer with. */
type MemoryRead = { ok: true; copy: MachineMemory } | { ok: false; code: 404 | 500 | 504; said: string };

/**
 * What an `init` frame announces: the SDK session, which is what lets a
 * dashboard that joins a live session late read its transcript back, and the
 * directory the agent really opened it in — the spawn's `cwd` after the agent
 * expanded it.
 */
/**
 * The queue news a `frame` carries, if it carries any: a session announcing a
 * message it was too busy to start, or retiring one it has now read.
 *
 * Read off the frame structurally rather than by narrowing the neutral union,
 * the way `peekInit` above reads an init: a daemon older than these subtypes
 * simply never sends one, and this answers `undefined` for every other frame.
 * The real turn retires its own entry too ({@link QueuedMessage}) — the
 * dequeue frame can race it or be dropped, and a queued row that outlives the
 * message is the same lie the local echo used to tell.
 */
const peekQueue = (
  payload: unknown
): { queued: QueuedMessage } | { retired: string } | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const sdk = message as Record<string, unknown>;
  if (typeof sdk.queueId !== 'string') return undefined;
  if (sdk.type === 'user') return { retired: sdk.queueId };
  if (sdk.type !== 'system') return undefined;
  if (sdk.subtype === MESSAGE_DEQUEUED) return { retired: sdk.queueId };
  if (sdk.subtype !== MESSAGE_QUEUED) return undefined;
  if (typeof sdk.text !== 'string' || typeof sdk.timestamp !== 'string') return undefined;
  return {
    queued: {
      queueId: sdk.queueId,
      text: sdk.text,
      timestamp: sdk.timestamp,
      ...(typeof sdk.images === 'number' ? { images: sdk.images } : {}),
    },
  };
};

const peekInit = (payload: unknown): { sessionId: string; cwd?: string } | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const sdk = message as Record<string, unknown>;
  if (sdk.type !== 'system' || sdk.subtype !== 'init') return undefined;
  if (typeof sdk.session_id !== 'string') return undefined;
  return { sessionId: sdk.session_id, cwd: typeof sdk.cwd === 'string' ? sdk.cwd : undefined };
};

/**
 * What a user turn actually says, as a title could use it: the text the reader
 * typed. A user-shaped message is not always a reader — a tool result comes
 * back on the same channel — so a turn carrying no text of its own reads as
 * nothing here rather than as an empty name.
 */
const userTurnText = (message: unknown): string | undefined => {
  if (typeof message !== 'object' || message === null) return undefined;
  const outer = message as { type?: unknown; message?: { role?: unknown; content?: unknown } };
  if (outer.type !== 'user') return undefined;
  const content = outer.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((block): block is { type: 'text'; text: string } => {
              const b = block as { type?: unknown; text?: unknown };
              return b.type === 'text' && typeof b.text === 'string';
            })
            .map((block) => block.text)
            .join('\n')
        : '';
  return text.trim() ? text : undefined;
};

/**
 * A `send` whose turn carries pasted material. The agent folds attachments into
 * the message it hands the harness, so what the transcript stores is not what
 * the hub saw — and a title derived from the hub's copy would then disagree
 * with the one a loaded transcript derives, which is the disagreement this
 * whole path exists to remove. Such a send names nothing; the transcript will.
 */
const hasAttachments = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  Array.isArray((payload as { attachments?: unknown }).attachments) &&
  (payload as { attachments: unknown[] }).attachments.length > 0;

/** `stop { discard: true }`: the side quest is being thrown away, not paused. */
const peekDiscard = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  (payload as { discard?: unknown }).discard === true;

/**
 * A `send` that is one session addressing another, rather than a reader typing.
 * The hub stays payload-opaque otherwise; this is a sanctioned peek, and it is
 * the only way the fleet can be told a session is carrying handed work.
 */
const peekPeer = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = (payload as { message?: { origin?: { kind?: string; name?: string } } }).message;
  if (message?.origin?.kind !== 'peer') return undefined;
  return message.origin.name ?? 'another session';
};

/**
 * A `send` that starts a turn. A queued hand-off (`shouldQuery: false`) is read
 * when the *next querying message* folds it into a turn — so that send, not any
 * turn ending, is the moment it stops being outstanding. Clearing on turn end
 * was wrong twice over: a turn already in flight when the hand-off landed
 * cleared it unread, and the SDK acknowledges even a queued append with result
 * frames, which cleared it within seconds of arriving.
 */
const isQuerySend = (payload: unknown): boolean => {
  if (typeof payload !== 'object' || payload === null) return false;
  const message = (payload as { message?: { shouldQuery?: unknown } }).message;
  return message?.shouldQuery !== false;
};

export const createServer = ({ registry, db, pending, telegram }: HubServices) => {
  // Honest ground, before anything is served. A fresh process holds no agent
  // sockets, so every row still claiming `online` is a leftover from a hub that
  // was killed before its close handlers could run. The read-time overlay
  // (`withPresence`, below) already makes the API tell the truth regardless —
  // this is for every *other* reader of the stored rows: a migration, a script,
  // a `sqlite3` session at 3am. A column nobody has to remember to distrust is
  // worth one write at startup.
  db.markAllAgentsOffline();

  // And the same honesty for the sessions those machines were carrying. A hub
  // that just started holds no daemon sockets, so it has no basis for any row
  // claiming `running` or `starting`; and rows the previous taxonomy had to file
  // under `error` for the crime of having been restarted are re-read as what
  // they always were — `sleeping`. Idempotent, so this is a boot step and not a
  // migration script somebody has to remember to run.
  const swept = db.sweepBootStatuses(RESTART_RESUMABLE);
  if (swept.toUnknown || swept.toSleeping)
    console.log(
      `[hub] boot sweep: ${swept.toUnknown} session(s) → unknown, ${swept.toSleeping} legacy restart error(s) → sleeping`
    );

  /**
   * What each session is doing right now, as its own daemon last said: memory
   * only, and never a column.
   *
   * A pulse is the daemon's first-hand reading of a live process — working,
   * blocked, idle — and it is worth exactly as long as the process it describes.
   * Persisting it would recreate the defect this whole build exists to close in
   * a second column, so it lives here, keyed by instance, and is dropped the
   * moment the row it belongs to settles or is discarded. A dashboard opening
   * cold gets the map in its first `instances` frame, which is the difference
   * between a rail that knows what is working on connect and one that has to
   * wait for the next pulse to arrive.
   */
  const pulses = new Map<string, SessionPulse>();

  /**
   * Where each machine's deployment clone stands, as that machine last said:
   * memory only, and never a column, for the same reason {@link pulses} is.
   *
   * A deploy verdict is a first-hand reading of a checkout at a moment, and it
   * is worth exactly as long as the socket that asserted it. Stored, it would
   * outlive the daemon and put a stale `current` — or a stale `diverged` an
   * operator has since resolved — on the board of a machine nobody can reach,
   * which is the very failure this build exists to close. So it is dropped when
   * the socket closes, and a machine with no entry carries no `deploy` field at
   * all, exactly as a daemon that predates the channel does.
   */
  const deploys = new Map<string, DeployInfo>();

  /**
   * What this hub was built from, for the frame. `buildInfo()` is async and
   * `instancesFrame` is not, so it is read once at boot and cached; a running
   * hub is whatever it started as, which is the same assumption `buildInfo`
   * itself makes.
   */
  let hubBuild: BuildInfo | undefined;
  void buildInfo().then((info) => {
    hubBuild = info;
  });

  /**
   * Standing instructions, enforced on the frame stream this server already
   * carries. Constructed here so it shares the request's `db` and reaches
   * machines through the same registry every other injection uses.
   */
  const ruleEngine = new RuleEngine({
    db,
    agent: (machineId) => registry.agent(machineId),
  });

  /**
   * Drops a dead process's parked questions, telling whoever carried them
   * elsewhere that they are over — a Telegram message whose buttons still work
   * after the session behind them is gone is a message that lies.
   */
  const forgetPending = (instanceId: string): void => {
    for (const parked of pending.list())
      if (parked.instanceId === instanceId && parked.requestId)
        telegram?.onSettled(parked.requestId);
    pending.forget(instanceId);
    // Nor is it doing anything any more: a pulse outliving its process is the
    // same stale-liveness lie in memory instead of in a column.
    pulses.delete(instanceId);
    // A session that died before it ever said anything is never going to name
    // itself; nothing should still be waiting to hear its first words.
    awaitingFirstTurn.delete(instanceId);
    // Nor is anything it was holding ever going to run. A queued row that
    // outlives the process holding it is the same lie in a quieter font.
    forgetQueue(instanceId);
  };

  /**
   * A parent session just died while a routed ask was still parked for one of
   * its delegates. The user is the fallback: re-broadcast the ask untagged so
   * it returns to the attention queue, and let Telegram hear it like any other.
   * A routed ask must never sit unanswerable and invisible.
   */
  const escalateRoutedAsks = (parentInstanceId: string): void => {
    for (const parked of pending.list()) {
      const payload = parked.payload as { kind?: unknown; routedTo?: unknown };
      if (payload.kind !== 'permission_request' || payload.routedTo !== 'parent') continue;
      const delegate = parked.instanceId
        ? db.listInstances().find((r) => r.id === parked.instanceId)
        : undefined;
      if (delegate?.parentInstanceId !== parentInstanceId) continue;
      delete payload.routedTo;
      registry.broadcast(parked);
      telegram?.onAsk(parked);
    }
  };

  /**
   * Delivers a delegate's ask to its parent as a queued peer message, in the
   * same shape the auto-report block uses: the parent reads it when its current
   * turn ends and answers with the `answer_delegate` tool. The final line is
   * machine-readable so the parent's model can copy the ids verbatim.
   */
  const deliverDelegateAsk = (
    delegate: { id: string; machineId: string; cwd: string },
    parent: { id: string; machineId: string },
    ask: { requestId?: string; payload: unknown }
  ): void => {
    const label = `${leaf(delegate.cwd)}#${delegate.id.slice(0, 8)}`;
    const body = renderDelegateAsk(ask.payload);
    const marker = `[delegate-ask instance=${delegate.id} request=${ask.requestId}]`;
    const instruction =
      'Answer it with the answer_delegate tool: answer_delegate(target, requestId, answers) — ' +
      'answers are keyed by the exact question text and the value is the chosen option label ' +
      '(pass deny=true to refuse it).';
    registry.agent(parent.machineId)?.send({
      verb: 'send',
      machineId: parent.machineId,
      instanceId: parent.id,
      payload: {
        instanceId: parent.id,
        message: {
          type: 'user',
          message: {
            role: 'user',
            content: `[Delegate ask from ${label}]\n\n${body}\n\n${marker}\n\n${instruction}`,
          },
          parent_tool_use_id: null,
          origin: { kind: 'peer', from: delegate.id, name: leaf(delegate.cwd), fromSession: delegate.id },
          shouldQuery: false,
        },
      },
    });
    handoffs.set(parent.id, { from: leaf(delegate.cwd), at: Date.now() });
    publishInstances(parent.machineId);

    const toolName = peek(ask.payload, 'toolName');
    publishDelegateEvent(
      delegate.machineId,
      db.recordDelegateEvent({
        instanceId: delegate.id,
        parentInstanceId: parent.id,
        kind: 'ask',
        requestId: ask.requestId,
        toolName,
        requestKind:
          peek(ask.payload, 'requestKind') === 'question' || toolName === ASK_USER_QUESTION
            ? 'question'
            : 'tool',
        payload: { input: (ask.payload as { input?: unknown } | null)?.input },
        status: 'pending',
      })
    );
  };

  /**
   * Sessions that have been handed work and have not answered it yet, kept here
   * rather than in a browser: a hand-off learnt by whichever tab happened to be
   * watching is invisible on every other device, and gone after a reload.
   */
  const handoffs = new Map<string, { from: string; at: number }>();
  /**
   * What each session is holding but has not started, oldest first — folded
   * from the `message_queued` / `message_dequeued` frames going past.
   *
   * Kept here for the same reason the hand-offs above are: a queue only the
   * sending tab knows about is invisible on every other device and gone after
   * a reload, which is exactly how a message sent to a busy session came to be
   * lost. Published with the instances and readable on connect, so a dashboard
   * that opens mid-queue sees what is waiting rather than an empty transcript.
   */
  const queues = new Map<string, QueuedMessage[]>();

  /** Files one queue entry under the session holding it; false if it was already there. */
  const enqueue = (instanceId: string, entry: QueuedMessage): boolean => {
    const held = queues.get(instanceId);
    if (!held) {
      queues.set(instanceId, [entry]);
      return true;
    }
    if (held.some((queued) => queued.queueId === entry.queueId)) return false;
    held.push(entry);
    return true;
  };

  /** And retires it — by the dequeue frame, or by the real turn that carries its id. */
  const dequeue = (instanceId: string, queueId: string): boolean => {
    const held = queues.get(instanceId);
    if (!held) return false;
    const left = held.filter((queued) => queued.queueId !== queueId);
    if (left.length === held.length) return false;
    if (left.length === 0) queues.delete(instanceId);
    else queues.set(instanceId, left);
    return true;
  };

  /**
   * The session is gone (stopped, discarded, failed, or relaunched under the
   * same id). Nothing it was holding will ever run, and a queued row that
   * outlives its process is a message the reader is still waiting for.
   */
  const forgetQueue = (instanceId: string): boolean => queues.delete(instanceId);
  /**
   * Each delegate session's assistant texts, accumulated while its turn runs
   * so the report delivered to its parent carries everything it said — not
   * just the last assistant message (a turn can produce several).
   */
  const lastAssistant = new Map<string, string[]>();
  /**
   * Installs somebody is waiting on, by `requestId`: what keeps a machine from
   * being sent the same install twice while the first is still running, and
   * what tells a `control_result` that it is carrying a tool's status.
   */
  const pendingInstalls = new Map<string, { machineId: string; toolId: string }>();
  /**
   * Fleet syncs somebody is waiting on, by `requestId` → the machine running
   * one: what tells a `control_result` that it is carrying a machine's own
   * account of the fleet config rather than an answer for whoever asked.
   */
  const pendingFleet = new Map<string, string>();
  /**
   * Controls a REST call is waiting on, by `requestId`. A dashboard's control is
   * answered over the socket it asked on; a route has nothing to hold the reply
   * against but this.
   */
  const waiting = new Map<string, (frame: ControlResult) => void>();

  /**
   * Asks a machine something and waits for the frame that answers it. A machine
   * that is not connected and one that will not answer are told apart on
   * purpose: the first is the fleet's own state, the second is a machine that
   * has something wrong with it.
   */
  const callAgent = (
    machineId: string,
    method: string,
    args: unknown[],
    timeoutMs: number,
    harness?: HarnessKind
  ): Promise<ControlResult | 'offline' | 'timeout'> => {
    const agent = registry.agent(machineId);
    if (!agent) return Promise.resolve('offline');

    const requestId = crypto.randomUUID();
    const payload: ControlPayload = { requestId, method, args, ...(harness && { harness }) };
    agent.send({ verb: 'control', machineId, payload } satisfies Envelope<ControlPayload>);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        resolve('timeout');
      }, timeoutMs);
      waiting.set(requestId, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  };

  /** Relays a dashboard envelope to its machine; reports back if nobody is home. */
  const forward = (envelope: Envelope, dashboard: HubSocket): boolean => {
    const agent = registry.agent(envelope.machineId);
    if (!agent) {
      dashboard.send(failure(envelope, `machine ${envelope.machineId} is not connected`));
      return false;
    }
    agent.send(envelope);
    return true;
  };

  /**
   * Every row, to every dashboard, after any one of them moves — a session
   * opening, failing, settling or being discarded is fleet news, and a rail
   * that only learns it by re-fetching is a rail that lies until you reload.
   * The whole table because it is small and a snapshot cannot drift.
   */
  /**
   * Starts a settled session again on the daemon that just registered.
   *
   * Deliberately not a revive-on-demand: a session the user left running was
   * left running on purpose, and a restart they did not ask for should not be
   * something they have to repair one row at a time. Bounded at the call site
   * (see {@link RESTORE_HORIZON_MS} / {@link RESTORE_MAX}) — this function does
   * one session and asks no questions about how many came before it.
   *
   * The row it writes is `starting`, never `running`: this sends a spawn and
   * returns, and a spawn in flight is not a process. The daemon's next word —
   * the session's `init` frame, or the heartbeat listing the id — is what
   * promotes it. That single distinction is most of the difference between a
   * board that reports 178 live sessions and one that reports 42.
   */
  const restore = (agent: HubSocket, row: InstanceRow): void => {
    const payload: SpawnPayload = {
      instanceId: row.id,
      cwd: row.cwd,
      ...(row.sessionId ? { resume: { sessionKey: row.sessionId } } : {}),
      ...(row.harness ? { harness: row.harness as SpawnPayload['harness'] } : {}),
      ...(row.permissionMode ? { permissionMode: row.permissionMode as PermissionMode } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.effort ? { effort: row.effort as EffortLevel } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
    };
    agent.send({ verb: 'spawn', machineId: row.machineId, instanceId: row.id, payload });
    db.openInstance({
      id: row.id,
      machineId: row.machineId,
      cwd: row.cwd,
      sessionId: row.sessionId ?? undefined,
      harness: row.harness ?? undefined,
      projectId: row.projectId ?? undefined,
      kind: row.kind === 'scratch' ? 'scratch' : 'mainline',
      permissionMode: row.permissionMode ?? undefined,
      model: row.model ?? undefined,
      effort: row.effort ?? undefined,
    });
  };

  /**
   * Presence is the registry's; history is the database's.
   *
   * The `agents.status` column is a *log* of presence transitions, not a
   * statement of the present: it is written `'online'` at register and
   * `'offline'` only from the socket close handler. Nothing writes it when this
   * process was not the one holding the socket — a hub restart, a crash, a
   * daemon killed while the hub was down — so a row can sit at `'online'` for
   * days while no socket for that machine exists anywhere. That is precisely
   * the window in which the board showed three green machines and every send
   * came back `machine <id> is not connected`, because routing has always asked
   * the registry (`registry.agent(machineId)`) and only the *display* asked the
   * column. Two sources of truth for one fact, and the operator was shown the
   * wrong one.
   *
   * So the read is derived, not stored: `status` is answered from the live
   * socket registry at the moment of the read, and everything else on the row —
   * `lastSeenAt`, `build`, `harnesses`, `fleet`, `auth` — is passed through from
   * the database untouched. After this, "online" means exactly one thing, and it
   * is the same thing routing means: *the hub is holding a socket for it right
   * now*. A machine that is merely recently-seen reads `offline` and says so, and
   * a script polling `/api/agents` can discover an unreachable machine instead of
   * being told a comfortable lie.
   *
   * Applied at the only two places a machine's status is emitted to a reader:
   * the `/api/agents` route and {@link instancesFrame}. The other
   * `db.listAgents()` callers are fleet/config lookups that never read `status`,
   * and are deliberately left alone.
   */
  const withPresence = (rows: AgentRow[]): AgentRow[] =>
    rows.map((row) => ({
      ...row,
      status: registry.agent(row.machineId) ? 'online' : 'offline',
      // Additive and live, like `status` above: present only for a machine that
      // has actually reported one on this connection.
      ...(deploys.get(row.machineId) ? { deploy: deploys.get(row.machineId) } : {}),
    }));

  /**
   * The same law, applied to sessions — the instance of it the codebase was
   * violating.
   *
   * `instances.status` is written on lifecycle events and read back by every
   * rail as if it were a statement about now. It is not: the hub cannot see a
   * process, only the daemon can, and when the hub is not holding that daemon's
   * socket there is no one to ask. Measured in exactly that state:
   * `/api/instances` reported 178 sessions `running` on a machine carrying 42
   * `claude` processes, all of them idling at ≤1.5% CPU and 36–44 hours old,
   * with two rows touched in the last hour and a half. Every one of those
   * `running` values was true when written and had been true of nothing since.
   *
   * So a row whose machine is absent from the socket registry is served
   * `unknown`, which is precisely what the hub knows about it: not that it
   * failed, not that it is fine — that there is currently no way to find out.
   * The stored column is left alone; it is history, and history is allowed to
   * say what last happened.
   *
   * The overlay covers the values that *claim* something about a live process —
   * `running`, `starting`, `sleeping` (which claims a session is there to be
   * woken, and waking it needs the machine). `stopped`, `error` and `discarded`
   * pass through untouched: they are records of something that already
   * finished, and an unreachable machine does not make a session that was
   * deliberately stopped any less stopped. Serving `unknown` for those would
   * trade a fact for a shrug.
   *
   * Applied at the two places a session's status reaches a reader: the
   * `/api/instances` route and {@link instancesFrame}.
   */
  const withSessionPresence = <Row extends { machineId: string; status: string }>(
    rows: Row[]
  ): Row[] =>
    rows.map((row) =>
      registry.agent(row.machineId) ||
      (row.status !== 'running' && row.status !== 'starting' && row.status !== 'sleeping')
        ? row
        : { ...row, status: 'unknown' }
    );


  /**
   * The whole board as one message: every row, every machine, and what each
   * session is holding. Built in one place so the snapshot a dashboard is
   * handed on connect and the snapshot it is pushed on every move are the same
   * object by construction.
   *
   * `capabilities` is the hub's handshake (PLAN.md, Ledger Protocol): an
   * additive optional field a legacy dashboard ignores, and the only thing that
   * tells a new one it may follow the sequenced stream instead of watching
   * frames go past.
   */
  const instancesFrame = (machineId: string): Envelope => ({
    verb: 'frames',
    machineId,
    payload: {
      kind: 'instances',
      instances: withSessionPresence(db.listInstances()),
      agents: withPresence(db.listAgents()),
      handoffs: Object.fromEntries(handoffs),
      queues: Object.fromEntries(queues),
      // Additive, both of them: a dashboard that predates either reads the
      // frame exactly as it always did. `pulses` seeds the rail's now-state on
      // connect instead of leaving it blank until the next beat; `hubBuild`
      // lets a client tell a hub that is behind from a machine that is.
      pulses: Object.fromEntries(pulses),
      ...(hubBuild ? { hubBuild } : {}),
      capabilities: [...HUB_CAPABILITIES],
    },
  });

  const publishInstances = (machineId: string): void => {
    // A session's model, project or harness can move under a live rule; every
    // move republishes, so this is the one place that has to drop the cache.
    ruleEngine.forgetFacts();
    registry.broadcast(instancesFrame(machineId));
  };

  /**
   * Sessions this hub started fresh and has not yet heard a word from. A title
   * derived from a live turn is only the session's *first* message while this
   * holds the id — a resumed session's next turn is somewhere in the middle of
   * a conversation, and naming the row after it would be a wrong name that then
   * outranks the transcript's own. Those get named from the transcript instead,
   * where the first message is unambiguous.
   */
  const awaitingFirstTurn = new Set<string>();

  /**
   * Names an unnamed row after what its session was first asked to do, using
   * core's cleaning so the string is identical to the one the dashboard derives
   * from the transcript. Write-once and never over a given title, so this can
   * be called from every path that might see the first message first.
   */
  const nameFromFirstTurn = (machineId: string, instanceId: string, raw: string): string => {
    const derived = deriveTitleFromFirstMessage(raw);
    if (derived && db.noteDerivedTitle(instanceId, derived)) publishInstances(machineId);
    return derived;
  };

  /**
   * A live turn for a session the hub started: if it is the first thing said,
   * it is the session's name. Consumed either way — the second turn is not a
   * first message, and a turn with no text of its own never was.
   */
  /**
   * The words a stored transcript opens with: its oldest user turn that says
   * anything. A transcript starts with the reader's own ask, so this is what
   * the conversation is called — and it is the same entry the dashboard's
   * folding layer picks when it names a session client-side.
   */
  const firstTurnOf = (transcript: unknown[]): string | undefined => {
    for (const entry of transcript) {
      const text = userTurnText(entry);
      if (text) return text;
    }
    return undefined;
  };

  /**
   * Names the machine's stored conversations that nothing has ever named, off
   * the catalog the machine keeps anyway — a catalog entry carries the session's
   * first prompt, so this costs one control call and no transcript reads.
   *
   * Offered when a daemon registers, and free in the steady state: the query for
   * unnamed rows comes back empty and the machine is never asked. Only the same
   * `firstPrompt` the dashboard would name a stored session by is used — a
   * harness summary is a different string, and a row named with one would
   * disagree with the strip it is meant to agree with.
   */
  const nameStoredSessions = async (machineId: string): Promise<void> => {
    const unnamed = db.unnamedSessions(machineId);
    if (unnamed.length === 0) return;

    const answer = await callAgent(machineId, CONTROL_LIST_SESSIONS, [{}], READ_TIMEOUT_MS);
    if (answer === 'offline' || answer === 'timeout' || !answer.ok) return;
    if (!Array.isArray(answer.result)) return;

    // Name from whatever the catalog carries, in the SAME precedence the
    // dashboard resolves a stored session by (`sessionTitle`): a given title
    // (customTitle / summary) first, then the first prompt. claude reports
    // `firstPrompt`; opencode and pi report a real `customTitle` and NO prompt,
    // so reading only `firstPrompt` left every opencode/pi row unnamed at rest.
    // The row's stored title wins in `resolveSessionTitle` either way, so naming
    // from the given title is not a mismatch with what the client would show.
    const names = new Map<string, string>();
    for (const info of answer.result as NeutralSessionInfo[]) {
      if (typeof info?.sessionId !== 'string') continue;
      const source = (info.customTitle || info.summary)?.trim() || info.firstPrompt;
      const name = typeof source === 'string' ? deriveTitleFromFirstMessage(source) : '';
      if (name) names.set(info.sessionId, name);
    }

    let named = false;
    for (const row of unnamed) {
      const name = row.sessionId && names.get(row.sessionId);
      if (!name) continue;
      if (db.noteDerivedTitle(row.id, name)) named = true;
    }
    if (named) publishInstances(machineId);
  };

  const nameFromLiveTurn = (machineId: string, instanceId: string, message: unknown): void => {
    if (!awaitingFirstTurn.has(instanceId)) return;
    // Everything that is not a reader speaking — an init frame, a tool result
    // coming back on the same channel — leaves the session still unnamed and
    // still waiting: the first *words* are the name, whenever they arrive.
    const text = userTurnText(message);
    if (!text) return;
    awaitingFirstTurn.delete(instanceId);
    nameFromFirstTurn(machineId, instanceId, text);
  };

  /**
   * One line of the hub's record of a delegate's traffic, to every dashboard,
   * the moment it is written — the same reason the instance rows are pushed:
   * a reader watching either session should see the ask, the answer and the
   * report as they happen rather than on their next re-fetch.
   */
  const publishDelegateEvent = (machineId: string, event: DelegateEvent): void => {
    registry.broadcast({
      verb: 'frames',
      machineId,
      instanceId: event.instanceId,
      payload: { kind: 'delegate_event', instanceId: event.instanceId, event },
    });
  };

  /**
   * Files an answer to a delegate's ask, whichever way it arrived — the parent's
   * `answer_delegate`, the relay route, or a reader clicking it in the dashboard
   * once it escalated — and closes the ask it settles. An answer to anything
   * else is an ordinary session's own permission and nobody's record.
   */
  const recordDelegateAnswer = (
    machineId: string,
    instanceId: string,
    requestId: string,
    result: unknown
  ): void => {
    const asked = db.delegateAsk(requestId);
    const parentInstanceId =
      asked?.parentInstanceId ??
      db.listInstances().find((r) => r.id === instanceId)?.parentInstanceId;
    if (!parentInstanceId) return;

    const behavior = peek(result, 'behavior') ?? 'allow';
    const answers = peekAnswers(result);
    publishDelegateEvent(
      machineId,
      db.recordDelegateEvent({
        instanceId,
        parentInstanceId,
        kind: 'answer',
        requestId,
        payload: { behavior, ...(answers ? { answers } : {}) },
      })
    );
    // An ask this hub never recorded — one parked before the table existed —
    // still gets its answer stored; there is simply nothing to close.
    db.settleDelegateAsk(requestId, behavior === 'deny' ? 'denied' : 'answered');
  };
  // The Telegram bridge answers straight down the agent socket, past every
  // recording site above — so it files its answers through this instead.
  telegram?.setAnswerRecorder(recordDelegateAnswer);

  const awaitingInstall = (machineId: string, toolId: string): boolean => {
    for (const install of pendingInstalls.values())
      if (install.machineId === machineId && install.toolId === toolId) return true;
    return false;
  };

  /**
   * Sends the machine an install for every tool the policy requires and its
   * last report says is missing (NEW.md §10). The one click: a machine that
   * joins the fleet, or a tool that becomes required, needs nobody to go
   * looking for what is out of date.
   *
   * A machine that has reported nothing is left alone — an empty map is a
   * daemon that predates the catalog, not a machine missing everything. So is
   * one whose cell says `failed` or `unsupported`: the daemon remembers its own
   * failures for the rest of its boot, so an install that will not work waits
   * for a click instead of going out on every reconnect.
   */
  const autoInstall = (machineId: string, agent: HubSocket): void => {
    const cells = db.agentTools(machineId);
    if (Object.keys(cells).length === 0) return;

    let sent = false;
    for (const policy of db.listToolPolicies()) {
      const cell = cells[policy.id];
      if (!policy.required || (cell && cell.state !== 'missing')) continue;
      if (awaitingInstall(machineId, policy.id)) continue;

      const requestId = crypto.randomUUID();
      const payload: ControlPayload = {
        requestId,
        method: 'installTool',
        args: [policy.id, policy.pinnedVersion ?? undefined],
      };
      pendingInstalls.set(requestId, { machineId, toolId: policy.id });
      agent.send({ verb: 'control', machineId, payload } satisfies Envelope<ControlPayload>);
      db.setAgentToolCell(machineId, { id: policy.id, state: 'installing', at: Date.now() });
      sent = true;
    }
    if (sent) publishInstances(machineId);
  };

  /**
   * Sends the machine what the fleet's Claude Code is supposed to be able to
   * reach (NEW.md §11): every MCP server, marketplace and plugin, for the
   * machine to converge on and report back. Sent on register and after any
   * change, so a machine that joins tomorrow needs nobody to remember it.
   *
   * A fleet nobody has configured is not sent at all — there is nothing to
   * converge on, and a sync that writes nothing is still a file read and a
   * report stored on every register in the fleet. Unless the machine still has
   * something of ours: the last row being deleted is exactly when a machine most
   * needs telling, and its own last report is what says it has anything to lose.
   */
  const pushFleetConfig = (machineId: string, agent: HubSocket, config: FleetConfig): void => {
    const requestId = crypto.randomUUID();
    const payload: ControlPayload = { requestId, method: FLEET_SYNC, args: [config] };
    pendingFleet.set(requestId, machineId);
    agent.send({ verb: 'control', machineId, payload } satisfies Envelope<ControlPayload>);
  };

  /**
   * A machine that just converged wrote new skill files and plugin installs
   * under sessions that are already running. The SDK picks both up without a
   * restart — `reloadSkills`/`reloadPlugins` on the session's Query — so every
   * live session on that machine is told the moment its sync report lands,
   * and a skill adopted from the rail is usable in the session that adopted
   * it seconds later (user, 2026-08-08). Fire-and-forget: a session racing
   * shutdown answers with an error nobody is waiting on.
   *
   * `reloadSkills`/`reloadPlugins` are Claude Code Query methods; a harness
   * with no such verb (opencode, pi) answers with an error that reads as a
   * session failure, so only a claude session — and a legacy row whose
   * `harness` predates the rework and is therefore claude — is told.
   *
   * `hooksChanged` adds a third control, `reinitialize` — the SDK `Query`
   * method that actually re-reads settings, hooks included, rather than only
   * the two narrower things the other verbs cover. It is heavier than a
   * reload, so it is sent only when this sync's report says the hook set on
   * this machine is not the report's own last one; every other sync leaves a
   * running session's hooks exactly as they were, which is correct, because
   * they have not changed.
   */
  const refreshSessions = (machineId: string, agent: HubSocket, hooksChanged: boolean): void => {
    for (const row of db.listInstances()) {
      if (row.machineId !== machineId) continue;
      if (row.status !== 'running' && row.status !== 'starting') continue;
      if (row.harness && row.harness !== 'claude') continue;
      const methods = hooksChanged
        ? (['reloadSkills', 'reloadPlugins', 'reinitialize'] as const)
        : (['reloadSkills', 'reloadPlugins'] as const);
      for (const method of methods) {
        const requestId = crypto.randomUUID();
        const payload: ControlPayload = { instanceId: row.id, requestId, method, args: [] };
        agent.send({
          verb: 'control',
          machineId,
          instanceId: row.id,
          requestId,
          payload,
        } satisfies Envelope<ControlPayload>);
      }
    }
  };

  const sendFleetSync = (machineId: string, agent: HubSocket): void => {
    // Fleet sync converges each harness's own files. A daemon that predates
    // harness reporting is assumed to be claude (fleetable); only an explicit
    // report with no fleet-capable harness is a machine with nothing to converge.
    const reports = db
      .listAgents()
      .find((row) => row.machineId === machineId)
      ?.harnesses;
    if (reports && reports.length > 0 && !reports.some((report) => report.capabilities.fleet)) return;

    // Per machine: what this one already holds is sent as a hash and no bytes.
    const config = db.fleetConfig(machineId);
    const empty =
      !config.mcp.length &&
      !config.marketplaces.length &&
      !config.plugins.length &&
      !config.skills?.length &&
      !config.memory;
    if (empty && !holdsFleet(db.listAgents().find((row) => row.machineId === machineId)?.fleet)) {
      return;
    }

    pushFleetConfig(machineId, agent, config);
  };

  /**
   * One machine's own user CLAUDE.md, whoever wrote it. A peek is this alone,
   * adopting is this and a store, and an overwrite is this so the copy it is
   * about to destroy is kept before it goes.
   */
  const readMachineMemory = async (machineId: string): Promise<MemoryRead> => {
    const answer = await callAgent(machineId, READ_MEMORY_FILE, [], READ_TIMEOUT_MS);
    if (answer === 'offline') {
      return { ok: false, code: 404, said: `machine ${machineId} is not connected` };
    }
    if (answer === 'timeout') {
      return { ok: false, code: 504, said: `machine ${machineId} did not answer` };
    }
    if (!answer.ok) {
      return { ok: false, code: 500, said: answer.error ?? 'the machine could not read its memory' };
    }
    return { ok: true, copy: peekMemoryFile(answer.result) };
  };

  /** The version about to be replaced, kept — a save is not a way to lose one. */
  const keepReplacedMemory = (content: string): void => {
    const current = db.getFleetMemory();
    if (current && current.content !== content) {
      db.recordFleetMemory({ content: current.content, hash: current.hash, source: 'fleet' });
    }
  };

  /** The same for one linked document, under its own path in the history. */
  const keepReplacedDoc = (path: string, content: string): void => {
    const current = db.getFleetMemoryDoc(path);
    if (current && current.content !== content) {
      db.recordFleetMemory({ content: current.content, hash: current.hash, source: 'fleet', path });
    }
  };

  /** A document leaving the set, kept whole — nothing else has a copy of it. */
  const keepRemovedDoc = (doc: { path: string; content: string; hash: string }): void => {
    db.recordFleetMemory({
      content: doc.content,
      hash: doc.hash,
      source: 'fleet',
      path: doc.path,
    });
  };

  /**
   * The version of a hook that a save, an edit or a delete is about to
   * replace or destroy — kept before it goes, the same moment a memory
   * document's version is. `fleet` is the only source today: a hook is
   * never edited from a machine, only converged onto one.
   */
  const keepHookVersion = (hook: FleetHook): void => {
    db.recordFleetHook({
      hookId: hook.id,
      name: hook.name,
      enabled: hook.enabled,
      event: hook.event,
      matcher: hook.matcher,
      handler: hook.handler,
      script: hook.script,
      hash: hook.hash,
      scope: hook.scope,
      projectId: hook.projectId,
      source: 'fleet',
    });
  };

  /**
   * Machines the subagents could not be written to, by machineId → why. Read
   * back in the fleet response, so a definition that is going nowhere says so
   * on the page rather than only in a log.
   */
  const unpushable = new Map<string, string>();

  /**
   * Where this machine's home directory is, taken off the directories its
   * sessions are open in — a session running in `/home/x/repo` has already said
   * what the home is.
   *
   * A heuristic, and knowingly so: until register carries `home` — see the
   * parked daemon batch — the instance rows are the only thing on the hub's
   * side that has ever named a real path on that machine.
   */
  const homeOf = (machineId: string): string | undefined => {
    for (const row of db.listInstances()) {
      if (row.machineId !== machineId) continue;
      const match = HOME_PREFIX.exec(row.cwd);
      if (match) return match[1];
    }
    return undefined;
  };

  /**
   * Writes one file on a machine over the `fs` verb. The daemon answers a write
   * with a `control_result` frame, exactly as it answers a control call, so the
   * same `waiting` map routes the reply and no dashboard is broadcast a write
   * it never asked for.
   */
  const writeMachineFile = (
    machineId: string,
    agent: HubSocket,
    path: string,
    content: string
  ): Promise<ControlResult | 'timeout'> => {
    const requestId = crypto.randomUUID();
    const payload: FsPayload = { requestId, op: 'write', path, content };
    agent.send({ verb: 'fs', machineId, requestId, payload } satisfies Envelope<FsPayload>);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        resolve('timeout');
      }, READ_TIMEOUT_MS);
      waiting.set(requestId, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  };

  /**
   * Writes every fleet subagent into `<home>/.claude/agents/` on one machine
   * (NEW.md §11). Claude Code re-scans that directory within seconds, so a
   * definition saved here is delegatable out there without anything being
   * restarted.
   *
   * Unconditional: a definition is a page of markdown, and deciding whether to
   * write it would cost the read that the write itself costs.
   *
   * Phase B: `syncFleetConfig` gets the agents and the daemon owns convergence
   * — and with it removal, which a verb of list/read/write cannot do.
   */
  const pushAgents = async (machineId: string): Promise<void> => {
    const agent = registry.agent(machineId);
    const files = db.listFleetAgents();
    if (!agent || files.length === 0) return;

    const home = homeOf(machineId);
    if (!home) {
      unpushable.set(machineId, 'no session on this machine has said where its home directory is');
      return;
    }

    for (const file of files) {
      const answer = await writeMachineFile(
        machineId,
        agent,
        `${home}/.claude/agents/${file.name}.md`,
        file.content
      );
      if (answer === 'timeout' || !answer.ok) {
        unpushable.set(
          machineId,
          answer === 'timeout'
            ? 'the machine did not answer the write'
            : (answer.error ?? 'the machine refused the write')
        );
        return;
      }
    }
    unpushable.delete(machineId);
  };

  /** A definition changed: every machine that is online takes it now. */
  const fanOutAgents = (): void => {
    for (const machineId of registry.machineIds()) void pushAgents(machineId);
  };

  /** The fleet changed: every machine that is online converges now, not on its next reconnect. */
  /**
   * Fetches the plugins the fleet wants, once, here.
   *
   * A plugin used to be a name each machine resolved for itself by running
   * `claude plugin install`, which goes to the network — so an install depended
   * on that machine's credentials, on the upstream repository still being there
   * and still being public, and on the moment it happened to run. None of those
   * are properties of the fleet, and two machines could satisfy the same row
   * with different code and both report `applied`.
   *
   * So the bytes are resolved here and stored, and sync carries them. What
   * cannot be resolved keeps its sentence on the row and is left to the old
   * path, which is the only one that still needs a machine to reach github.
   */
  const resolvePlugins = async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    const sources = new Map(db.fleetConfig().marketplaces.map(({ name, source }) => [name, source]));

    const byMarketplace = new Map<string, string[]>();
    for (const id of ids) {
      const marketplace = id.split('@')[1] ?? '';
      byMarketplace.set(marketplace, [...(byMarketplace.get(marketplace) ?? []), id]);
    }

    for (const [marketplace, wanted] of byMarketplace) {
      const source = sources.get(marketplace);
      if (!source) {
        for (const id of wanted) {
          db.putPluginPayload({ id, error: `no marketplace called ${marketplace} in this fleet` });
        }
        continue;
      }
      const resolved = await resolveMarketplacePlugins(
        marketplace,
        source,
        wanted.map((id) => id.split('@')[0] ?? id)
      );
      for (const plugin of resolved) {
        const id = `${plugin.name}@${marketplace}`;
        if ('error' in plugin) db.putPluginPayload({ id, error: plugin.error });
        else db.putPluginPayload({ id, hash: plugin.hash, bytes: plugin.bytes, files: plugin.files });
      }
    }
  };

  // Plugins added before this hub could fetch them, and any whose fetch has not
  // been attempted yet. Done once at boot rather than on every sync: a resolved
  // plugin is bytes the fleet already agrees on, and re-fetching it would be a
  // download per restart for a file nobody asked to change.
  void resolvePlugins(db.unresolvedPlugins());

  const fanOutFleet = (): void => {
    for (const machineId of registry.machineIds()) {
      const agent = registry.agent(machineId);
      if (!agent) continue;
      sendFleetSync(machineId, agent);
      publishInstances(machineId);
    }
  };

  /**
   * A dashboard's `send`, whole: relay it, name the session after its first
   * words, and keep the hub's record of what the target is carrying.
   *
   * Extracted rather than inlined in the route so the Ledger Protocol's `send`
   * command runs THIS, not a second implementation of it — a command that did
   * anything less than the legacy call would be a quieter way of doing the same
   * thing wrong.
   */
  const relaySend = (message: Envelope<SendPayload>, dashboard: HubSocket): boolean => {
    // Provenance (NEW.md, cross-session delivery incident): which tab it
    // believed it was sending from, when the dashboard's own command carried
    // one. Never required — a legacy send or an older dashboard build logs
    // with it absent — but it is the one thing that makes "a send landed on
    // the wrong session" provable after the fact instead of merely suspected.
    const provenance = (message.payload as { provenance?: { clientId?: string } })?.provenance;
    const from = peekPeer(message.payload);
    const forwarded = forward(message, dashboard);
    // Logged after the guard, not before: a message the guard drops (no agent
    // connected) never reached the target, and a log line claiming otherwise
    // would itself become evidence in the next "did this land" argument.
    console.log(
      `[hub] send -> ${message.instanceId ?? '?'} (${forwarded ? 'forwarded' : 'dropped'})${
        provenance ? ` client ${provenance.clientId ?? '?'}` : ''
      }`
    );
    if (!forwarded || !message.instanceId) return false;
    // The first thing a session is asked is what it is called, until
    // something names it properly.
    if (!hasAttachments(message.payload))
      nameFromLiveTurn(
        message.machineId,
        message.instanceId,
        (message.payload as { message?: unknown } | null)?.message
      );
    if (from && !isQuerySend(message.payload)) {
      // A queued hand-off: the target now carries unread work.
      handoffs.set(message.instanceId, { from, at: Date.now() });
      publishInstances(message.machineId);
    } else if (isQuerySend(message.payload) && handoffs.has(message.instanceId)) {
      // A querying send folds everything queued into the turn it
      // starts — the hand-off has been read.
      handoffs.delete(message.instanceId);
      publishInstances(message.machineId);
    }
    return true;
  };

  /**
   * A dashboard's `control`, whole: relay it, route its reply back, settle
   * whatever the call answers (a parked permission, a delegate's ask, a tool
   * cell, a fleet sync). Extracted for the same reason as {@link relaySend}.
   *
   * `remember` is false for a command envelope: the reply to a command is that
   * command's `applied` ack, and routing it as a legacy `control_result` too
   * would report the same outcome twice in two dialects.
   */
  const relayControl = (
    message: Envelope<ControlPayload>,
    dashboard: HubSocket,
    remember = true
  ): boolean => {
    if (!forward(message, dashboard) || !message.requestId) return false;
    if (remember) registry.rememberRequester(message.requestId, dashboard);
    telegram?.onSettled(message.requestId);
    pending.resolve(message.requestId);
    // A reader answering an ask that escalated to them: the parent died
    // holding it, but it is still that delegate's ask and its record.
    const answered = peekAnswer(message.payload);
    if (answered && message.instanceId) {
      recordDelegateAnswer(message.machineId, message.instanceId, answered.requestId, answered.result);
    }
    // A per-cell install or retry, clicked rather than swept: the chip
    // turns on every dashboard, not only the one that clicked it.
    const toolId = peekInstall(message.payload);
    if (toolId) {
      pendingInstalls.set(message.requestId, { machineId: message.machineId, toolId });
      db.setAgentToolCell(message.machineId, { id: toolId, state: 'installing', at: Date.now() });
      publishInstances(message.machineId);
    }
    // A sync or a status a dashboard asked for answers with the same
    // report a register's does, and the row is the hub's either way.
    const method = peek(message.payload, 'method');
    if (method === FLEET_SYNC || method === FLEET_STATUS) {
      pendingFleet.set(message.requestId, message.machineId);
    }
    return true;
  };

  /**
   * The Ledger Protocol's hub half: per-session sequence, replay ring, and
   * command acknowledgement. It borrows the relays above rather than reaching
   * past them, so a command and a legacy click are the same operation.
   */
  const streams = createStreamHub({
    setLegacySubscriptions: (socket, instanceIds) => registry.setSubscriptions(socket, instanceIds),
    isMachineConnected: (machineId) => registry.agent(machineId) !== undefined,
    relaySend,
    relayControl: (envelope, dashboard) => relayControl(envelope, dashboard, false),
  });

  // Delegate types (fleet-wide `delegate` presets): a standalone table and
  // route group, mounted rather than folded into the routes below — see
  // delegate-types.ts for why it keeps its own connection.
  const delegateTypes = makeDelegateTypes();

  return new Elysia()
    .use(websocket())
    .use(delegateTypesRoutes(delegateTypes))
    // The hub's own build rides along (NEW.md §12), so a machine's can be read
    // against something rather than taken on faith.
    .get('/health', async () => ({ ok: true, version: HUB_VERSION, build: await buildInfo() }))
    .get('/api/agents', () => withPresence(db.listAgents()))
    // What a restart polls to find a moment that cuts nothing in half.
    .get('/api/agents/:machineId/busy', async ({ params, status }) => {
      const answer = await callAgent(params.machineId, AGENT_BUSY, [], BUSY_TIMEOUT_MS);
      if (answer === 'offline') return status(404, `machine ${params.machineId} is not connected`);
      if (answer === 'timeout') return status(504, `machine ${params.machineId} did not answer`);
      if (!answer.ok) return status(500, answer.error ?? 'the busy probe failed');
      return answer.result;
    })
    // And the update itself: the machine pulls, installs, rebuilds and restarts
    // what it serves, then says what it actually did.
    .post(
      '/api/agents/:machineId/update',
      {
        body: t.Object({
          restartAgent: t.Optional(t.Boolean()),
          force: t.Optional(t.Boolean()),
        }),
      },
      async ({ params, body, status }) => {
        const answer = await callAgent(
          params.machineId,
          UPDATE_COCKPIT,
          [body],
          UPDATE_TIMEOUT_MS
        );
        if (answer === 'offline') return status(404, `machine ${params.machineId} is not connected`);
        // A machine that restarts the hub as part of its update answers into a
        // socket that no longer exists, so this is not proof that nothing
        // happened — only that the hub stopped being able to hear about it.
        if (answer === 'timeout') {
          return status(504, `machine ${params.machineId} did not finish the update in time`);
        }
        if (!answer.ok) return status(500, answer.error ?? 'the update failed');
        return answer.result;
      }
    )
    // What a machine really has, fleet or not (NEW.md §11) — and what a session
    // in `cwd` would see. Nothing is stored: this is the machine's own word at
    // the moment it was asked, and a stale copy of it would be worse than none.
    .post(
      '/api/agents/:machineId/inspect',
      { body: t.Object({ cwd: t.Optional(t.String()) }) },
      async ({ params, body, status }) => {
        const answer = await callAgent(params.machineId, INSPECT_CONFIG, [body.cwd], READ_TIMEOUT_MS);
        if (answer === 'offline') return status(404, `machine ${params.machineId} is not connected`);
        if (answer === 'timeout') return status(504, `machine ${params.machineId} did not answer`);
        if (!answer.ok) return status(500, answer.error ?? 'the machine could not read its config');
        return answer.result;
      }
    )
    .get('/api/instances', () => withSessionPresence(db.listInstances()))
    // What these conversations are called — *whether or not the board still
    // lists them*.
    //
    // The listing is a working board: it drops a session that has not moved in
    // a day. A reader's open tabs are not a board, though — the strip carries
    // whatever they left open, and a tab the listing has aged out had no row to
    // read a name off, so the first server render called it by eight characters
    // of its id and only found the real name once the reader clicked it. The
    // name was never missing; it was filtered out. This answers by id straight
    // off the row, past the cut-off.
    //
    // Each ask is an id, or an id with the machine/cwd/harness a stored-session
    // link carries (the same context `/messages` takes). Cheap first: a name
    // already written down costs one query for the whole batch. Only a row that
    // has never been named at all reaches for its machine, and then only if the
    // machine is connected — and what comes back is written down, so no session
    // is ever read twice for its name.
    .post(
      '/api/instances/titles',
      {
        body: t.Object({
          ids: t.Array(
            t.Union([
              t.String(),
              t.Object({
                id: t.String(),
                machine: t.Optional(t.Nullable(t.String())),
                cwd: t.Optional(t.String()),
                harness: t.Optional(t.String()),
              }),
            ])
          ),
        }),
      },
      async ({ body }) => {
        const asked = new Map<string, { id: string; machine?: string; cwd?: string; harness?: string }>();
        for (const ask of body.ids) {
          const one = typeof ask === 'string' ? { id: ask } : { ...ask, machine: ask.machine ?? undefined };
          if (!one.id || asked.has(one.id)) continue;
          // Bounded by what a reader can plausibly have open, so a hand-written
          // body cannot turn one request into a fleet-wide transcript sweep.
          if (asked.size >= TITLE_ASK_LIMIT) break;
          asked.set(one.id, one);
        }
        if (asked.size === 0) return [];

        const rows = new Map(
          db.getInstancesByIds([...asked.keys()]).map((row) => [row.id, row] as const)
        );

        return await Promise.all(
          [...asked.values()].map(async (ask) => {
            const row = rows.get(ask.id);
            const named = row?.title ?? row?.derivedTitle;
            if (named) return { id: ask.id, title: named };

            // Never named, so ask the machine that stores the conversation. A
            // machine that is not connected leaves the tab to its fallback:
            // nothing here can invent a name nobody has ever written down.
            const machineId = ask.machine ?? row?.machineId;
            if (!machineId || !registry.agent(machineId)) return { id: ask.id, title: null };

            const answer = await callAgent(
              machineId,
              CONTROL_GET_SESSION_MESSAGES,
              [
                ask.machine ? ask.id : (row?.sessionId ?? ask.id),
                { dir: ask.cwd || row?.cwd || undefined },
              ],
              READ_TIMEOUT_MS,
              (ask.harness || row?.harness || undefined) as HarnessKind | undefined
            );
            if (answer === 'offline' || answer === 'timeout' || !answer.ok) {
              return { id: ask.id, title: null };
            }
            const first = firstTurnOf(Array.isArray(answer.result) ? answer.result : []);
            if (!first) return { id: ask.id, title: null };

            // Written down on the way past, so the next render of this tab is
            // the cheap path — and so is every other reader's.
            const derived = row
              ? nameFromFirstTurn(row.machineId, row.id, first)
              : deriveTitleFromFirstMessage(first);
            return { id: ask.id, title: derived || null };
          })
        );
      }
    )
    // A session's stored transcript over HTTP, which is the only way a page can
    // have one before its socket is up. The dashboard used to read history with
    // a `getSessionMessages` control over its own WebSocket, so a reload showed
    // an empty transcript until the socket reconnected and backfilled; this runs
    // the same control from here, against the machine's agent socket, and
    // streams the answer back newest-entry-first as NDJSON.
    //
    // `machine`/`cwd`/`harness` come from a stored-transcript link. A live
    // session carries none of them, so its own row answers for it — including
    // the SDK session key, which is what the machine stores the transcript under.
    .get(
      '/api/instances/:id/messages',
      {
        query: t.Object({
          machine: t.Optional(t.String()),
          cwd: t.Optional(t.String()),
          harness: t.Optional(t.String()),
        }),
      },
      async ({ params, query, status }) => {
        const row = query.machine ? undefined : db.listInstances().find((r) => r.id === params.id);
        const machineId = query.machine ?? row?.machineId;
        if (!machineId) return status(404, `no session ${params.id}`);
        const sessionKey = query.machine ? params.id : (row?.sessionId ?? params.id);
        const cwd = query.cwd || row?.cwd || undefined;
        const harness = (query.harness || row?.harness || undefined) as HarnessKind | undefined;

        const answer = await callAgent(
          machineId,
          CONTROL_GET_SESSION_MESSAGES,
          [sessionKey, { dir: cwd }],
          READ_TIMEOUT_MS,
          harness
        );
        if (answer === 'offline') return status(503, `machine ${machineId} is not connected`);
        if (answer === 'timeout') return status(504, `machine ${machineId} did not answer in time`);
        if (!answer.ok) return status(500, answer.error ?? 'the transcript could not be read');

        // A session the machine has never stored answers with nothing, which is
        // an empty transcript rather than a fault — the same shape a brand new
        // session has.
        const transcript = Array.isArray(answer.result) ? answer.result : [];

        // The transcript is in hand anyway, and its oldest user turn is the
        // unambiguous answer to what the session is called — including for
        // conversations this hub never started, which no live turn can name.
        // Write-once, so this costs one statement the first time a transcript
        // is read and nothing on every read after it.
        if (row && !row.title && !row.derivedTitle) {
          const first = firstTurnOf(transcript);
          if (first) nameFromFirstTurn(machineId, row.id, first);
        }

        return new Response(ndjsonNewestFirst(transcript), {
          headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
        });
      }
    )
    .patch(
      '/api/instances/:id',
      {
        body: t.Object({
          kind: t.Optional(t.Union([t.Literal('mainline'), t.Literal('scratch')])),
          // Not narrowed to the modes the SDK names today: the hub stores what
          // the session reported it is answering with, whatever that grows into.
          permissionMode: t.Optional(t.String()),
          model: t.Optional(t.String()),
          effort: t.Optional(t.String()),
        }),
      },
      ({ params, body, status }) => {
        const { kind, permissionMode, model, effort } = body;
        if (
          kind === undefined &&
          permissionMode === undefined &&
          model === undefined &&
          effort === undefined
        ) {
          return status(400, 'name a field to change');
        }
        const row = db.patchInstance(params.id, { kind, permissionMode, model, effort });
        if (row) publishInstances(row.machineId);
        return row;
      }
    )
    // Broadcast on change *and* readable on connect: a dashboard that opens
    // after a hand-off went out would otherwise show nothing until the next
    // time anything else moved.
    .get('/api/handoffs', () => Object.fromEntries(handoffs))
    // What each session is holding but has not started. Broadcast with the
    // instances *and* readable here, for the reason the hand-offs are: a
    // dashboard that opens while a queue is already waiting has missed every
    // frame that built it.
    .get('/api/queues', () => Object.fromEntries(queues))
    .get('/api/pending', () => pending.list())
    // What a delegate and its parent said to each other, oldest first. Broadcast
    // as it happens *and* readable here, for the same reason the hand-offs are:
    // an exchange that finished before this tab opened is still the record.
    .get(
      '/api/delegate-events',
      { query: t.Object({ parent: t.Optional(t.String()), instance: t.Optional(t.String()) }) },
      ({ query, status }) => {
        if (!query.parent && !query.instance) return status(400, 'name a parent or an instance');
        return db.listDelegateEvents(query);
      }
    )
    // The catalog is code, so it ships with the answer rather than being stored:
    // a dashboard reads what tools exist and what the fleet has decided about
    // them here, and each machine's own status off the `instances` frame.
    .get('/api/tools', () => ({ catalog: TOOL_CATALOG, policies: db.listToolPolicies() }))
    .put(
      '/api/tools/:id',
      {
        body: t.Object({
          required: t.Optional(t.Boolean()),
          pinnedVersion: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
      ({ params, body, status }) => {
        const spec = toolSpec(params.id);
        // A tool that only exists to satisfy a `requires` is not something the
        // fleet has an opinion about — it arrives with whatever needs it.
        if (!spec || spec.dependencyOnly) return status(404, `no tool ${params.id}`);

        const policy = db.putToolPolicy(params.id, body);
        // The click: every machine that is online and missing it starts now,
        // rather than whenever it next happens to reconnect.
        if (policy.required) {
          for (const machineId of registry.machineIds()) {
            const agent = registry.agent(machineId);
            if (agent) autoInstall(machineId, agent);
          }
        }
        return policy;
      }
    )
    // The fleet's desired state (NEW.md §11), every table at once: it is one
    // page in the dashboard and one `syncFleetConfig` on a machine.
    //
    // The skills come back as rows rather than as part of the config: what the
    // machines get carries every skill's files, and a page that only lists them
    // must not weigh what the fleet weighs. The subagents do carry their files —
    // a definition is a page of markdown, and an editor that has to fetch each
    // one again is a round trip for nothing.
    .get('/api/fleet', () => {
      const { mcp, marketplaces, plugins } = db.fleetConfig();
      return {
        config: { mcp, marketplaces, plugins },
        skills: db.listSkills(),
        agents: db.listFleetAgents(),
        memory: db.getFleetMemory() ?? null,
        // The linked documents carry their files for the same reason the
        // subagents do: each one is a page of markdown, and the panel that
        // lists them is the panel that edits them.
        memoryDocs: db.listFleetMemoryDocs(),
        unpushable: Object.fromEntries(unpushable),
      };
    })
    .put(
      '/api/fleet/mcp/:name',
      {
        body: t.Object({
          // Stored and written verbatim, so the schema only asks that it be an
          // object; `mcpProblem` checks the one field that makes it startable.
          config: t.Record(t.String(), t.Unknown()),
          enabled: t.Optional(t.Boolean()),
        }),
      },
      ({ params, body, status }) => {
        const problem = mcpProblem(params.name, body.config);
        if (problem) return status(400, problem);

        const server = db.putMcpServer({
          name: params.name,
          config: body.config as unknown as FleetMcpConfig,
          enabled: body.enabled,
        });
        fanOutFleet();
        return server;
      }
    )
    .delete('/api/fleet/mcp/:name', ({ params }) => {
      db.deleteMcpServer(params.name);
      fanOutFleet();
      return { ok: true };
    })
    /**
     * Rules: standing instructions the hub enforces on the frame stream. The
     * shape is validated loosely here and strictly by `ruleProblem`, which is
     * the same validator the editor refuses with — one set of sentences, so the
     * form and the hub never disagree about what is wrong.
     */
    .get('/api/rules', () => {
      const stats = new Map(db.ruleStats().map((row) => [row.ruleId, row]));
      return {
        rules: db.listRules().map((rule) => ({
          ...rule,
          stats: stats.get(rule.id) ?? {
            ruleId: rule.id,
            pending: 0,
            totalFires: 0,
            lastFiredAt: null,
          },
        })),
        templates: RULE_TEMPLATES,
      };
    })
    .post('/api/rules', { body: ruleBody }, ({ body, status }) => {
      const draft = body as unknown as RuleDraft;
      const wrong = ruleProblem(draft);
      const first = Object.values(wrong)[0];
      if (first) return status(400, first);
      // The hub mints the id: the client never invents identity, it asks for it.
      const rule: Rule = { ...draft, id: crypto.randomUUID(), createdAt: Date.now() };
      db.putRule(rule);
      ruleEngine.reload();
      return rule;
    })
    .put('/api/rules/:id', { body: ruleBody }, ({ params, body, status }) => {
      const draft = body as unknown as RuleDraft;
      const wrong = ruleProblem(draft);
      const first = Object.values(wrong)[0];
      if (first) return status(400, first);
      // Strictly an edit: an id this hub never minted is a caller's mistake,
      // not an invitation to upsert.
      const existing = db.getRule(params.id);
      if (!existing) return status(404, `there is no rule ${params.id} to edit`);
      const rule: Rule = { ...draft, id: params.id, createdAt: existing.createdAt };
      db.putRule(rule);
      ruleEngine.reload();
      return rule;
    })
    .delete('/api/rules/:id', ({ params }) => {
      db.deleteRule(params.id);
      ruleEngine.reload();
      return { ok: true };
    })
    /**
     * What one session still owes an answer for, and the acknowledgement
     * itself. The agent's `acknowledge_rule` tool is the only real caller —
     * a rule is cleared by the session that tripped it, never from the UI,
     * because being answered by the model is the whole point of the mechanism.
     */
    .get('/api/rules/pending/:instanceId', ({ params }) => {
      const rules = new Map(db.listRules().map((rule) => [rule.id, rule]));
      return {
        pending: db.pendingRuleStates(params.instanceId).map((state) => ({
          ...state,
          name: rules.get(state.ruleId)?.name ?? 'a deleted rule',
          reply: rules.get(state.ruleId)?.reply ?? '',
        })),
      };
    })
    /**
     * What a rule has actually been doing, per session: fires, and what each
     * session said it did about it.
     *
     * The sessions are told nothing about any of this, so this listing is the
     * only window onto it. It is also what makes the tool the sessions call
     * honest — it promises the note reaches the user, and this is where.
     */
    .get('/api/rules/:id/activity', ({ params, status }) => {
      const rule = db.getRule(params.id);
      if (!rule) return status(404, 'That rule no longer exists.');
      const named = new Map(db.listInstances().map((row) => [row.id, row]));
      return {
        activity: db.ruleStatesFor(params.id).map((state) => {
          const row = named.get(state.instanceId);
          return {
            ...state,
            where: row ? leaf(row.cwd) : 'a session that is gone',
            harness: row?.harness ?? null,
          };
        }),
      };
    })
    /**
     * Acknowledge everything this session still owes an answer for, without
     * naming a rule.
     *
     * The session is never told which rule fired, or that a rule fired at all —
     * a model that can see the detector games the phrase instead of changing
     * the habit. So the tool it calls cannot take a rule id, and this settles
     * whatever is pending for the caller. The note is what the reader sees in
     * the dashboard, which is the only place any of this is visible.
     */
    .post(
      '/api/rules/ack',
      { body: t.Object({ instanceId: t.String(), note: t.String() }) },
      ({ body, status }) => {
        const note = body.note.trim();
        if (note.length < 10) {
          return status(
            400,
            'Say what you actually did about it — an acknowledgement of under ten characters is not one.'
          );
        }
        const pending = db.pendingRuleStates(body.instanceId);
        if (pending.length === 0) {
          return status(400, 'There is nothing outstanding for this session.');
        }
        const settled = pending
          .map((state) => db.ackRule(state.ruleId, body.instanceId, note))
          .filter((state) => state !== undefined);
        return { acknowledged: settled.length };
      }
    )
    .post(
      '/api/rules/:id/ack',
      { body: t.Object({ instanceId: t.String(), note: t.String() }) },
      ({ params, body, status }) => {
        const note = body.note.trim();
        if (note.length < 10) {
          return status(
            400,
            'Say what you actually did about it — an acknowledgement of under ten characters is not one.'
          );
        }
        const state = db.ackRule(params.id, body.instanceId, note);
        if (!state) {
          return status(400, 'That rule is not waiting on this session, so there is nothing to acknowledge.');
        }
        return state;
      }
    )
    .put(
      '/api/fleet/marketplaces/:name',
      { body: t.Object({ source: t.String() }) },
      ({ params, body }) => {
        const marketplace = db.putMarketplace({ name: params.name, source: body.source });
        fanOutFleet();
        return marketplace;
      }
    )
    .delete('/api/fleet/marketplaces/:name', ({ params }) => {
      db.deleteMarketplace(params.name);
      fanOutFleet();
      return { ok: true };
    })
    .put(
      '/api/fleet/plugins/:id',
      { body: t.Object({ enabled: t.Optional(t.Boolean()) }) },
      ({ params, body }) => {
        const plugin = db.putPlugin({ id: params.id, enabled: body.enabled });
        // Fetched before the machines are told about it, so the first sync that
        // reaches them already carries the files rather than a name to go and
        // resolve. A fetch that fails leaves its sentence on the row and the
        // fan-out still happens — the fleet is not held up by one plugin.
        void resolvePlugins([params.id]).finally(() => fanOutFleet());
        return plugin;
      }
    )
    // Re-fetch one plugin's bytes. The same verb a skill has, and the way a
    // fleet takes a new version of something upstream moved: nothing else
    // re-resolves on its own, because a plugin that resolved once is a plugin
    // every machine already agrees on.
    .post('/api/fleet/plugins/:id/refresh', async ({ params, status }) => {
      const known = db.fleetConfig().plugins.some(({ id }) => id === params.id);
      if (!known) return status(404, `no plugin ${params.id} in this fleet`);
      await resolvePlugins([params.id]);
      fanOutFleet();
      return { ok: true };
    })
    .delete('/api/fleet/plugins/:id', ({ params }) => {
      db.deletePlugin(params.id);
      fanOutFleet();
      return { ok: true };
    })
    // A plain skill is resolved here and now, once for the whole fleet: the hub
    // downloads it, and the machines are handed the files (NEW.md §11). A source
    // that would not resolve is still stored — the row is where the dashboard
    // reads why, and the ambiguous case answers with what it could have meant.
    //
    // `fromMachine` is the other way in: a skill somebody wrote on one machine,
    // read off it and stored like any fetched one, so it reaches the rest.
    .put(
      '/api/fleet/skills/:name',
      {
        body: t.Object({
          source: t.Optional(t.String()),
          enabled: t.Optional(t.Boolean()),
          fromMachine: t.Optional(t.String()),
          /** The checkout a project-scoped skill was discovered in. */
          cwd: t.Optional(t.String()),
        }),
      },
      async ({ params, body, status }) => {
        if (!SKILL_NAME.test(params.name)) return status(400, `${params.name} is not a usable skill name`);

        if (body.fromMachine) {
          const answer = await callAgent(
            body.fromMachine,
            READ_SKILL_FILES,
            [params.name, body.cwd],
            READ_TIMEOUT_MS
          );
          if (answer === 'offline') {
            return status(404, `machine ${body.fromMachine} is not connected`);
          }
          if (answer === 'timeout') return status(504, `machine ${body.fromMachine} did not answer`);
          if (!answer.ok) return status(400, answer.error ?? 'the machine could not read the skill');

          const files = answer.result as SkillFile[];
          const skill = db.putSkill({
            name: params.name,
            source: `machine:${body.fromMachine}`,
            enabled: body.enabled,
            hash: hashFiles(files),
            bytes: files.reduce((total, file) => total + Buffer.byteLength(file.contentBase64, 'base64'), 0),
            files,
          });
          fanOutFleet();
          return skill;
        }

        if (!body.source) return status(400, 'name a source, or the machine to adopt it from');

        const resolved = await resolveSkill(body.source);
        const skill = db.putSkill({
          name: params.name,
          source: body.source,
          enabled: body.enabled,
          ...('error' in resolved
            ? { error: resolved.error }
            : { hash: resolved.hash, bytes: resolved.bytes, files: resolved.files }),
        });
        // Nothing on any machine changed unless there are files to change it with.
        if (!('error' in resolved)) fanOutFleet();
        return 'choices' in resolved && resolved.choices
          ? { ...skill, choices: resolved.choices }
          : skill;
      }
    )
    // The same source, fetched again — for a skill whose repo has moved on.
    .post('/api/fleet/skills/:name/refresh', async ({ params, status }) => {
      const stored = db.listSkills().find((skill) => skill.name === params.name);
      if (!stored) return status(404, `no skill ${params.name}`);

      // An adopted skill's source is the machine it came off, so that is where
      // "the same source, again" reads from.
      if (stored.source.startsWith('machine:')) {
        const machineId = stored.source.slice('machine:'.length);
        const answer = await callAgent(machineId, READ_SKILL_FILES, [stored.name], READ_TIMEOUT_MS);
        if (answer === 'offline') return status(404, `machine ${machineId} is not connected`);
        if (answer === 'timeout') return status(504, `machine ${machineId} did not answer`);
        if (!answer.ok) return status(400, answer.error ?? 'the machine could not read the skill');

        const files = answer.result as SkillFile[];
        const skill = db.putSkill({
          name: stored.name,
          source: stored.source,
          enabled: stored.enabled,
          hash: hashFiles(files),
          bytes: files.reduce((total, file) => total + Buffer.byteLength(file.contentBase64, 'base64'), 0),
          files,
        });
        if (skill.hash !== stored.hash) fanOutFleet();
        return skill;
      }

      const resolved = await resolveSkill(stored.source);
      const skill = db.putSkill({
        name: stored.name,
        source: stored.source,
        enabled: stored.enabled,
        ...('error' in resolved
          ? { error: resolved.error }
          : { hash: resolved.hash, bytes: resolved.bytes, files: resolved.files }),
      });
      if (skill.hash !== stored.hash) fanOutFleet();
      return skill;
    })
    .delete('/api/fleet/skills/:name', ({ params }) => {
      db.deleteSkill(params.name);
      fanOutFleet();
      return { ok: true };
    })
    // A subagent is its markdown file (NEW.md §11): front matter over a body
    // that becomes the system prompt. The file is stored verbatim, and the only
    // thing parsed out of it is what a broken one has to be refused on — the
    // name a delegation asks for, and the description it decides to delegate on.
    .put(
      '/api/fleet/agents/:name',
      { body: t.Object({ content: t.String() }) },
      ({ params, body, status }) => {
        const problem = agentProblem(parseAgentFrontMatter(body.content), params.name);
        if (problem) return status(400, problem);

        const agent = db.putFleetAgent({ name: params.name, content: body.content });
        fanOutAgents();
        return agent;
      }
    )
    // Forgotten here, and left where it is out there: the `fs` verb has list,
    // read and write and no delete, so every machine keeps the file until Phase
    // B's daemon-side sync can take it away. Discovery then shows the leftover
    // as unmanaged, which is the truth rather than a comforting silence.
    .delete('/api/fleet/agents/:name', ({ params }) => {
      db.deleteFleetAgent(params.name);
      return { ok: true };
    })
    // The click for a machine that was asleep when a definition was written, and
    // for one whose home the hub could only work out later. Awaited, so the
    // answer carries what this attempt could not reach rather than the last one.
    .post('/api/fleet/agents/push', async () => {
      await Promise.all(registry.machineIds().map((machineId) => pushAgents(machineId)));
      return { ok: true, unpushable: Object.fromEntries(unpushable) };
    })
    // The fleet's user-scope memory (NEW.md §11): the main CLAUDE.md every
    // session loads flat, and the documents it links under
    // `~/.claude/memories/` — each hash-synced to every machine like a skill's
    // files are, and each drifting on its own.
    //
    // `expectedHash` is what the writer had in front of them. A save against a
    // row somebody else has moved answers with what is really there rather than
    // taking the last writer's word for it — two dashboards on one document is
    // the ordinary case here, not the exotic one.
    .put(
      '/api/fleet/memory',
      { body: t.Object({ content: t.String(), expectedHash: t.Optional(t.String()) }) },
      ({ body, status }) => {
        const current = db.getFleetMemory();
        if (body.expectedHash !== undefined && current && current.hash !== body.expectedHash) {
          return status(409, current);
        }
        keepReplacedMemory(body.content);
        const memory = db.setFleetMemory(body.content);
        fanOutFleet();
        return memory;
      }
    )
    // The machines take back only what their own sidecar says cockpit wrote:
    // one edited by hand on a machine stays there, unmanaged. The set goes with
    // it — a linked document with no main file to link it is not a memory, and
    // the machines would keep converging on documents nothing points at.
    .delete('/api/fleet/memory', () => {
      for (const doc of db.listFleetMemoryDocs()) {
        keepRemovedDoc(doc);
        db.deleteFleetMemoryDoc(doc.path);
      }
      db.clearFleetMemory();
      fanOutFleet();
      return { ok: true };
    })
    // One linked document. Same save as the main file's, keyed by the path it
    // lands at — `models/claude-opus-5.md` is the same string on every machine,
    // which is what makes it the row's identity.
    .put(
      '/api/fleet/memory/docs',
      {
        body: t.Object({
          path: t.String(),
          content: t.String(),
          expectedHash: t.Optional(t.String()),
        }),
      },
      ({ body, status }) => {
        const problem = memoryDocProblem(body.path);
        if (problem) return status(400, problem);

        const current = db.getFleetMemoryDoc(body.path);
        if (body.expectedHash !== undefined && current && current.hash !== body.expectedHash) {
          return status(409, current);
        }
        keepReplacedDoc(body.path, body.content);
        const doc = db.putFleetMemoryDoc({ path: body.path, content: body.content });
        fanOutFleet();
        return doc;
      }
    )
    // Kept before it goes, like every other version this hub replaces: the
    // machines give the file back, and the fleet's copy of it was the last one.
    .delete('/api/fleet/memory/docs', { body: t.Object({ path: t.String() }) }, ({ body, status }) => {
      const current = db.getFleetMemoryDoc(body.path);
      if (!current) return status(404, `the fleet keeps no ${body.path}`);

      keepRemovedDoc(current);
      db.deleteFleetMemoryDoc(body.path);
      fanOutFleet();
      return { ok: true };
    })
    // What one machine really has, without touching anything: the read behind
    // "compare", so a reader chooses between two documents by looking at them.
    .post(
      '/api/fleet/memory/peek',
      { body: t.Object({ machineId: t.String() }) },
      async ({ body, status }) => {
        const read = await readMachineMemory(body.machineId);
        return read.ok ? read.copy : status(read.code, read.said);
      }
    )
    // The first document has to come from somewhere, and a machine that has been
    // collecting one for a year is where it is. Read off that machine and stored
    // as the fleet's, which every other machine then gets.
    //
    // Whole set by default: the main file and every document beside it, with
    // the fleet's own leftovers taken away — an adoption that left them behind
    // would push them straight back at the machine they were adopted from.
    // `path` narrows it to the one document, for the drifted row that is the
    // only thing being settled.
    .post(
      '/api/fleet/memory/adopt',
      { body: t.Object({ machineId: t.String(), path: t.Optional(t.String()) }) },
      async ({ body, status }) => {
        const read = await readMachineMemory(body.machineId);
        if (!read.ok) return status(read.code, read.said);
        if (!read.copy) return status(404, `machine ${body.machineId} has no user CLAUDE.md`);

        if (body.path !== undefined) {
          const problem = memoryDocProblem(body.path);
          if (problem) return status(400, problem);

          const theirs = (read.copy.docs ?? []).find((doc) => doc.path === body.path);
          if (!theirs) return status(404, `machine ${body.machineId} has no ${body.path}`);

          keepReplacedDoc(body.path, theirs.content);
          const doc = db.putFleetMemoryDoc({ path: body.path, content: theirs.content });
          fanOutFleet();
          return doc;
        }

        keepReplacedMemory(read.copy.content);
        // A daemon that predates the set answers without `docs`, and taking
        // that for "this machine links none" would quietly empty the fleet's.
        for (const doc of read.copy.docs ?? []) {
          if (memoryDocProblem(doc.path)) continue;
          keepReplacedDoc(doc.path, doc.content);
          db.putFleetMemoryDoc({ path: doc.path, content: doc.content });
        }
        if (read.copy.docs) {
          const theirs = new Set(read.copy.docs.map((doc) => doc.path));
          for (const doc of db.listFleetMemoryDocs()) {
            if (theirs.has(doc.path)) continue;
            keepRemovedDoc(doc);
            db.deleteFleetMemoryDoc(doc.path);
          }
        }

        const memory = db.setFleetMemory(read.copy.content);
        fanOutFleet();
        return memory;
      }
    )
    // And the other direction, for the machine whose copy was edited: a sync
    // that is allowed to overwrite it, sent at that machine alone.
    //
    // The machine is read first, and a machine that will not answer stops the
    // push: what an overwrite destroys exists nowhere else, so it is kept here
    // before it goes rather than mourned afterwards. `path` forces the one
    // document, so settling a drifted `models/…` does not also overwrite a main
    // file the reader never looked at.
    .post(
      '/api/fleet/memory/push',
      { body: t.Object({ machineId: t.String(), path: t.Optional(t.String()) }) },
      async ({ body, status }) => {
        const agent = registry.agent(body.machineId);
        if (!agent) return status(404, `machine ${body.machineId} is not connected`);

        const config = db.fleetConfig();
        if (!config.memory) return status(400, 'the fleet keeps no memory to push');

        const read = await readMachineMemory(body.machineId);
        if (!read.ok) return status(read.code, read.said);

        const kept = (path: string | undefined, hash: string, content: string): void => {
          db.recordFleetMemory({
            content,
            hash,
            source: `machine:${body.machineId}`,
            ...(path ? { path } : {}),
          });
        };
        const forced = body.path;
        if (read.copy && forced === undefined && read.copy.hash !== config.memory.hash) {
          kept(undefined, read.copy.hash, read.copy.content);
        }
        for (const theirs of read.copy?.docs ?? []) {
          if (forced !== undefined && theirs.path !== forced) continue;
          const ours = config.memory.docs?.find((doc) => doc.path === theirs.path);
          if (ours && ours.hash !== theirs.hash) kept(theirs.path, theirs.hash, theirs.content);
        }

        pushFleetConfig(body.machineId, agent, {
          ...config,
          memory: {
            ...config.memory,
            ...(forced === undefined ? { force: true } : {}),
            ...(config.memory.docs
              ? {
                  docs: config.memory.docs.map((doc) =>
                    forced === undefined || doc.path === forced ? { ...doc, force: true } : doc
                  ),
                }
              : {}),
          },
        });
        publishInstances(body.machineId);
        return { ok: true };
      }
    )
    // What the memory used to say, newest first. Without the content: the list
    // is read on every open of the panel, and a version is read on a click.
    //
    // One document at a time: `?path=` for a linked one, and the main file when
    // nothing is named — which is what every version written before the set is.
    .get('/api/fleet/memory/history', ({ query }) =>
      db.listFleetMemoryHistory(typeof query.path === 'string' ? query.path : undefined)
    )
    .get('/api/fleet/memory/history/:id', ({ params, status }) => {
      const version = db.fleetMemoryVersion(Number(params.id));
      return version ?? status(404, `no memory version ${params.id}`);
    })
    // Undo, through the same door as a save — so what restoring replaces is
    // itself kept, and a restore of the wrong version is undone the same way.
    // A version goes back where it came from: the document it was a version of,
    // or the main file, which is what a version with no path is.
    .post('/api/fleet/memory/restore', { body: t.Object({ id: t.Number() }) }, ({ body, status }) => {
      const version = db.fleetMemoryVersion(body.id);
      if (!version) return status(404, `no memory version ${body.id}`);

      if (version.path !== undefined) {
        keepReplacedDoc(version.path, version.content);
        const doc = db.putFleetMemoryDoc({ path: version.path, content: version.content });
        fanOutFleet();
        return doc;
      }

      keepReplacedMemory(version.content);
      const memory = db.setFleetMemory(version.content);
      fanOutFleet();
      return memory;
    })
    /**
     * Hooks (NEW.md §11): the one fleet row that is executable, so the gate
     * here is `hookProblem` — the same validator the editor refuses a save
     * with — rather than the loose shape checks a config blob gets elsewhere.
     * A hook that passed the editor's own test box and still fails here would
     * be a hub disagreeing with itself about what is safe to run.
     */
    .get('/api/fleet/hooks', () => ({ hooks: db.listFleetHooks(), templates: HOOK_TEMPLATES }))
    .put(
      '/api/fleet/hooks/:id',
      {
        body: t.Object({
          name: t.String(),
          enabled: t.Boolean(),
          event: t.String(),
          matcher: t.Optional(t.String()),
          // Stored and written verbatim, so the schema only asks that it be an
          // object; `hookProblem` checks the fields that make it runnable.
          handler: t.Record(t.String(), t.Unknown()),
          script: t.Optional(t.String()),
          scope: t.Optional(t.String()),
          projectId: t.Optional(t.String()),
          expectedHash: t.Optional(t.String()),
        }),
      },
      ({ params, body, status }) => {
        const { expectedHash, ...rest } = body;
        const draft = rest as unknown as HookDraft;
        const wrong = hookProblem(draft);
        const first = Object.values(wrong)[0];
        if (first) return status(400, first);

        const current = db.getFleetHook(params.id);
        // The same conflict a memory document's save answers with: what the
        // writer had in front of them is stale, so the row really there comes
        // back rather than one editor's version winning by being last.
        if (expectedHash !== undefined && current && current.hash !== expectedHash) {
          return status(409, current);
        }
        if (current) keepHookVersion(current);

        const hook = db.putFleetHook({ ...draft, id: params.id });
        fanOutFleet();
        return hook;
      }
    )
    .delete('/api/fleet/hooks/:id', ({ params, status }) => {
      const current = db.getFleetHook(params.id);
      if (!current) return status(404, `the fleet keeps no hook ${params.id}`);

      keepHookVersion(current);
      db.deleteFleetHook(params.id);
      fanOutFleet();
      return { ok: true };
    })
    // What one hook used to be, newest first, without the material. `?hookId=`
    // narrows to that hook's own history; nothing named lists every hook's,
    // for a fleet-wide undo panel.
    .get('/api/fleet/hooks/history', ({ query }) =>
      db.listFleetHookHistory(typeof query.hookId === 'string' ? query.hookId : undefined)
    )
    .get('/api/fleet/hooks/history/:id', ({ params, status }) => {
      const version = db.fleetHookVersion(Number(params.id));
      return version ?? status(404, `no hook version ${params.id}`);
    })
    // Undo, through the same door as a save: what restoring replaces is
    // itself kept first, so a restore of the wrong version is undone the
    // same way a bad edit is.
    .post('/api/fleet/hooks/restore', { body: t.Object({ id: t.Number() }) }, ({ body, status }) => {
      const version = db.fleetHookVersion(body.id);
      if (!version) return status(404, `no hook version ${body.id}`);

      const current = db.getFleetHook(version.hookId);
      if (current) keepHookVersion(current);

      const hook = db.putFleetHook({
        id: version.hookId,
        name: version.name,
        enabled: version.enabled,
        event: version.event,
        matcher: version.matcher,
        handler: version.handler,
        script: version.script,
        scope: version.scope,
        projectId: version.projectId,
      });
      fanOutFleet();
      return hook;
    })
    // The click for a hook that drifted on one machine, or that a reader
    // wants there right now rather than at the next reconnect: `force: true`
    // on the one row named, or on every enabled one when none is.
    .post(
      '/api/fleet/hooks/push',
      { body: t.Object({ machineId: t.String(), id: t.Optional(t.String()) }) },
      ({ body, status }) => {
        const agent = registry.agent(body.machineId);
        if (!agent) return status(404, `machine ${body.machineId} is not connected`);

        const config = db.fleetConfig();
        if (!config.hooks || config.hooks.length === 0) {
          return status(400, 'the fleet keeps no hooks to push');
        }
        if (body.id !== undefined && !config.hooks.some((hook) => hook.id === body.id)) {
          return status(404, `the fleet keeps no hook ${body.id}`);
        }

        pushFleetConfig(body.machineId, agent, {
          ...config,
          hooks: config.hooks.map((hook) =>
            body.id === undefined || hook.id === body.id ? { ...hook, force: true } : hook
          ),
        });
        publishInstances(body.machineId);
        return { ok: true };
      }
    )
    // The click for a machine that drifted, or for the whole fleet: the same
    // sync a register sends, asked for on purpose.
    .post(
      '/api/fleet/sync',
      { body: t.Object({ machineId: t.Optional(t.String()) }) },
      ({ body, status }) => {
        if (!body.machineId) {
          fanOutFleet();
          return { ok: true };
        }
        const agent = registry.agent(body.machineId);
        if (!agent) return status(404, `machine ${body.machineId} is not connected`);
        sendFleetSync(body.machineId, agent);
        publishInstances(body.machineId);
        return { ok: true };
      }
    )
    .get('/api/projects', () => db.listProjects())
    .post(
      '/api/projects',
      { body: t.Object({ name: t.String(), cwd: t.String(), machineId: t.String() }) },
      ({ body }) => db.createProject({ id: crypto.randomUUID(), ...body })
    )
    .delete('/api/projects/:id', ({ params }) => {
      db.deleteProject(params.id);
      return { ok: true };
    })
    // A session's own hand-off tools reach the fleet over plain HTTP: the
    // opencode plugin (and anything else outside the WebSocket tunnel) forwards
    // its spawns and sends through here, and the hub relays them like the
    // dashboard's own. Fire-and-forget — the tool has nothing to wait on.
    .post('/api/relay/spawn', { body: t.Any() }, ({ body, status }) => {
      const machineId = peek(body, 'machineId');
      const instanceId = peek(body, 'instanceId');
      if (!machineId || !instanceId) return status(400, 'name a machine and an instance');

      // A delegate type, for callers outside the WebSocket tunnel (the
      // opencode plugin's `delegate` tool passes `type` through its relay
      // body rather than resolving it itself — see handoff-shared.ts's own
      // `delegate()` for the same resolution done daemon-side for claude/pi).
      // Explicit fields already on the body win; the type only fills gaps.
      const typeName = peek(body, 'type');
      if (typeName) {
        const known = delegateTypes.list();
        const resolved = known.find((type) => type.name === typeName);
        if (!resolved) {
          // Same wording handoff-shared.ts's own `delegate()` refuses an
          // unknown type with (see its `resolvedType` block) — one refusal
          // vocabulary whichever side resolved the name.
          const names = known.map((type) => type.name).join(', ') || 'none are configured';
          return status(400, `No delegate type "${typeName}". Available: ${names}.`);
        }
        const rec = body as Record<string, unknown>;
        if (!rec.harness) rec.harness = resolved.harness;
        if (!rec.model) rec.model = resolved.model;
        if (!rec.effort && resolved.effort) rec.effort = resolved.effort;
        if (!(Array.isArray(rec.skills) && rec.skills.length) && resolved.skills) rec.skills = resolved.skills;
        if (!(Array.isArray(rec.denyTools) && rec.denyTools.length) && resolved.denyTools) {
          rec.denyTools = resolved.denyTools;
        }
      }
      // `type` is a relay-only convenience: SpawnPayload itself has no such
      // field, and it must not ride along into the envelope the daemon spawns
      // from — it already did its one job resolving harness/model/etc above.
      delete (body as Record<string, unknown>).type;

      // A delegate that names no permission mode inherits the ROOT of its
      // delegate tree, so a nested delegate of a bypassing session stays
      // autonomous instead of parking tool asks nobody is watching for.
      const parent = peekParent(body);
      if (!peek(body, 'permissionMode') && parent.parentInstanceId) {
        const mode = resolveDelegatePermissionMode(db.listInstances(), parent.parentInstanceId);
        if (mode) (body as Record<string, unknown>).permissionMode = mode;
      }

      const agent = registry.agent(machineId);
      if (!agent) return status(404, `machine ${machineId} is not connected`);

      agent.send({ verb: 'spawn', machineId, instanceId, payload: body } satisfies Envelope);
      db.openInstance({
        id: instanceId,
        machineId,
        cwd: peek(body, 'cwd') ?? '',
        sessionId: peekResume(body),
        harness: peekHarness(body),
        projectId: peek(body, 'projectId'),
        title: peek(body, 'title'),
        kind: peekKind(body),
        permissionMode: peek(body, 'permissionMode'),
        model: peek(body, 'model'),
        effort: peek(body, 'effort'),
        ...peekParent(body),
      });
      // A conversation that starts here: its first turn is its name.
      if (!peekResume(body)) awaitingFirstTurn.add(instanceId);
      publishInstances(machineId);
      return { ok: true };
    })
    .post('/api/relay/send', { body: t.Any() }, ({ body, status }) => {
      const machineId = peek(body, 'machineId');
      const instanceId = peek(body, 'instanceId');
      if (!machineId || !instanceId) return status(400, 'name a machine and an instance');

      // Urgency is only honoured toward the caller's own delegate; anything else
      // downgrades to a normal queued send.
      if ((body as { urgent?: unknown }).urgent === true) {
        const from = peek(body, 'from');
        const row = db.listInstances().find((r) => r.id === instanceId);
        if (!from || !row || row.parentInstanceId !== from) {
          console.warn(`[hub] downgraded urgent send to ${instanceId}: not its delegate`);
          delete (body as Record<string, unknown>).urgent;
        }
      }

      const agent = registry.agent(machineId);
      if (!agent) return status(404, `machine ${machineId} is not connected`);

      agent.send({ verb: 'send', machineId, instanceId, payload: body } satisfies Envelope);
      // The first thing a session is asked is what it is called, until
      // something names it properly.
      if (!hasAttachments(body))
        nameFromLiveTurn(machineId, instanceId, (body as { message?: unknown } | null)?.message);
      const from = peekPeer(body);
      if (from && !isQuerySend(body)) {
        handoffs.set(instanceId, { from, at: Date.now() });
      } else if (isQuerySend(body) && handoffs.has(instanceId)) {
        handoffs.delete(instanceId);
      }
      publishInstances(machineId);
      return { ok: true };
    })
    .post('/api/relay/stop', { body: t.Any() }, ({ body, status }) => {
      const instanceId = peek(body, 'instanceId');
      const from = peek(body, 'from');
      const row = instanceId ? db.listInstances().find((r) => r.id === instanceId) : undefined;
      if (!instanceId || !from || !row || row.parentInstanceId !== from) {
        return status(403, 'you can only stop your own delegates');
      }
      const agent = registry.agent(row.machineId);
      if (!agent) return status(404, `machine ${row.machineId} is not connected`);
      agent.send({
        verb: 'stop',
        machineId: row.machineId,
        instanceId,
        payload: { instanceId, from },
      } satisfies Envelope);
      // Same as a stop from a dashboard: whatever it was holding dies with it.
      if (forgetQueue(instanceId)) publishInstances(row.machineId);
      return { ok: true };
    })
    .post('/api/relay/interrupt', { body: t.Any() }, ({ body, status }) => {
      const instanceId = peek(body, 'instanceId');
      const from = peek(body, 'from');
      const row = instanceId ? db.listInstances().find((r) => r.id === instanceId) : undefined;
      if (!instanceId || !from || !row || row.parentInstanceId !== from) {
        return status(403, 'you can only interrupt your own delegates');
      }
      const agent = registry.agent(row.machineId);
      if (!agent) return status(404, `machine ${row.machineId} is not connected`);
      agent.send({
        verb: 'control',
        machineId: row.machineId,
        instanceId,
        payload: { instanceId, requestId: crypto.randomUUID(), method: 'interrupt', args: [], from },
      } satisfies Envelope);
      return { ok: true };
    })
    .post('/api/relay/answer', { body: t.Any() }, ({ body, status }) => {
      const instanceId = peek(body, 'instanceId');
      const from = peek(body, 'from');
      const requestId = peek(body, 'requestId');
      const row = instanceId ? db.listInstances().find((r) => r.id === instanceId) : undefined;
      if (!instanceId || !requestId || !from || !row || row.parentInstanceId !== from) {
        return status(403, 'you can only answer your own delegates');
      }
      const agent = registry.agent(row.machineId);
      if (!agent) return status(404, `machine ${row.machineId} is not connected`);
      const result = (body as { result?: unknown }).result;
      agent.send({
        verb: 'control',
        machineId: row.machineId,
        instanceId,
        requestId,
        payload: {
          instanceId,
          requestId,
          method: RESOLVE_PERMISSION,
          args: [requestId, result],
          from,
        },
      } satisfies Envelope);
      recordDelegateAnswer(row.machineId, instanceId, requestId, result);
      return { ok: true };
    })
    // A session's message to the owner, over plain HTTP like the other relay
    // verbs (the opencode plugin's `send_to_user`). No target machine — the hub
    // hands it to the bridge and nobody waits on an answer.
    .post('/api/relay/message', { body: t.Any() }, ({ body, status }) => {
      const machineId = peek(body, 'machineId');
      const instanceId = peek(body, 'instanceId');
      const text = peek(body, 'text');
      if (!machineId || !instanceId || !text) {
        return status(400, 'name a machine, an instance and a message');
      }
      telegram?.onUserMessage({
        verb: 'frames',
        machineId,
        instanceId,
        payload: { kind: 'user_message', instanceId, text },
      });
      return { ok: true };
    })
    // ── Usage (USAGE-SPEC.md §6) ─────────────────────────────────────────────
    // The heavy data lives behind these reads; the socket only carries the small
    // limits frame, so the dashboard pulls aggregates when it needs them.
    .get('/api/usage/limits', () => {
      const agents = db.listAgents();
      return {
        machines: db.listUsageLimits().map((row) => ({
          machineId: row.machineId,
          hostname: agents.find((agent) => agent.machineId === row.machineId)?.hostname ?? row.machineId,
          limits: row.payload,
        })),
      };
    })
    .get(
      '/api/usage/summary',
      {
        query: t.Object({
          since: t.Optional(t.Numeric()),
          until: t.Optional(t.Numeric()),
          harness: t.Optional(t.String()),
          machineId: t.Optional(t.String()),
          groupBy: t.Optional(
            t.Union([t.Literal('day'), t.Literal('model'), t.Literal('project'), t.Literal('session')])
          ),
        }),
      },
      ({ query }) =>
        db.usageSummary({
          since: query.since,
          until: query.until,
          harness: query.harness,
          machineId: query.machineId,
          groupBy: query.groupBy ?? 'day',
        })
    )
    .get(
      '/api/usage/blocks',
      {
        query: t.Object({
          harness: t.Optional(t.String()),
          machineId: t.Optional(t.String()),
          recentDays: t.Optional(t.Numeric()),
        }),
      },
      ({ query }) => {
        const since = Date.now() - (query.recentDays ?? 3) * 24 * 60 * 60 * 1000;
        const buckets = db.listUsageBuckets({
          since,
          harness: query.harness,
          machineId: query.machineId,
        });

        // A 5-hour block is ACCOUNT-wide, not per-session: the window the API
        // reports as `five_hour` covers every session the account ran, and
        // ccusage folds all entries into one series for the same reason.
        // Grouping per session would fragment the window, make burn rate and
        // projection meaningless, and mint colliding block ids. Harnesses stay
        // apart because they bill separately.
        const byHarness = new Map<string, UsageBucket[]>();
        for (const row of buckets) {
          const group = byHarness.get(row.harness) ?? [];
          group.push(usageBucketFromRow(row));
          byHarness.set(row.harness, group);
        }

        const now = Date.now();
        const blocks: (UsageBlock & { harness: string })[] = [];
        for (const [harness, group] of byHarness) {
          for (const block of identifyBlocks(group, now)) blocks.push({ ...block, harness });
        }
        blocks.sort((a, b) => a.startTime - b.startTime);
        return { blocks };
      }
    )
    .ws('/ws', {
      message(ws, message) {
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed frame', message);
          return;
        }

        switch (message.verb) {
          case 'register': {
            registry.registerAgent(message.machineId, ws);
            db.upsertAgent({
              machineId: message.machineId,
              hostname: peek(message.payload, 'hostname') ?? message.machineId,
              os: peek(message.payload, 'os') ?? 'unknown',
              auth: peekAuth(message.payload),
              build: peekBuild(message.payload),
              harnesses: peekHarnesses(message.payload),
            });
            db.mergeAgentTools(message.machineId, peekTools(message.payload));
            // The re-announce (`supervisor.reannounce`) carries no deploy state,
            // so a register without one leaves standing what the beats said —
            // the same tolerance `build` gets on the row itself.
            const registered = peekDeploy(message.payload);
            if (registered) deploys.set(message.machineId, registered);
            // A question parked by a process that is gone cannot be answered:
            // the reply would arrive at a daemon with no such session. Drop them
            // with the sessions they belonged to, or they replay to every
            // dashboard that connects and fail on click.
            const settled = db.settleInstances(
              message.machineId,
              peekInstances(message.payload),
              peekResumable(message.payload)
            );
            for (const orphan of settled) {
              forgetPending(orphan.row.id);
              escalateRoutedAsks(orphan.row.id);
            }
            // The daemon went away and came back. A session whose conversation
            // the harness still has is not finished — it lost its process, which
            // is this hub's problem to fix rather than the user's to notice. Put
            // it back exactly as it was: same directory, same model, same
            // permission mode, resumed onto the same session.
            //
            // But *bounded*, which it was not. Every resumable orphan was
            // respawned unconditionally on every register, which is how a
            // machine that had been away for a day and a half came back and was
            // handed its entire history as a work queue: 178 rows, spawned
            // fire-and-forget and each one written `running` before a single
            // process was confirmed. So: newest first, nothing older than
            // {@link RESTORE_HORIZON_MS}, and never more than
            // {@link RESTORE_MAX}. `settleInstances` has already written every
            // one of these `sleeping`, so the ones this skips are not lost —
            // they are asleep, listed, and one wake away.
            const cutoff = Date.now() - RESTORE_HORIZON_MS;
            const revivable = settled
              .filter((orphan) => orphan.resumes && orphan.row.sessionId)
              // `row` is the pre-settle snapshot, so this reads when the session
              // last moved, not when the settle just now touched it.
              .sort((a, b) => b.row.updatedAt.getTime() - a.row.updatedAt.getTime())
              .filter((orphan) => orphan.row.updatedAt.getTime() >= cutoff)
              .slice(0, RESTORE_MAX);
            for (const orphan of revivable) restore(ws, orphan.row);
            if (settled.length > revivable.length)
              console.log(
                `[hub] ${message.machineId}: restoring ${revivable.length} of ${settled.length} orphaned session(s); the rest are sleeping`
              );
            publishInstances(message.machineId);
            autoInstall(message.machineId, ws);
            sendFleetSync(message.machineId, ws);
            // After `settleInstances`, so the rows this reads the machine's home
            // out of are the ones the returning daemon just accounted for.
            void pushAgents(message.machineId);
            // And what its stored conversations are called, for the ones nobody
            // has ever named — off the catalog the daemon just read anyway.
            void nameStoredSessions(message.machineId);
            // The ledger the returning agent reattaches against: what this hub
            // has already ingested of each session the daemon is about to hold.
            // Computed AFTER `settleInstances` and after the restores above, so
            // it names exactly the sessions a reattach can act on — see
            // {@link reattachable} for why the restores have to be in it.
            ws.send(
              registerAck(
                message,
                streams.ingestedFor(
                  reattachable(peekInstances(message.payload), revivable.map((orphan) => orphan.row.id))
                )
              )
            );
            break;
          }
          case 'heartbeat': {
            db.touchAgent(message.machineId);
            // The beat is the truth (contract C4). Every 15s the machine says
            // what it is carrying, and the hub's column is made to agree with
            // it: listed ids become `running`, and rows claiming a process the
            // machine does not list settle — `sleeping` when there is a
            // conversation to resume, `error` when there is not.
            //
            // Deliberately no respawn from this path. A heartbeat is a report,
            // and answering a report by starting processes turns the fleet's
            // slowest-moving surface into its most destructive one: the daemon
            // would be told to relaunch a session every 15 seconds for as long
            // as it disagreed with the hub. Recovery is register's job, where
            // it happens once, bounded, on an event that means "the machine
            // just came back".
            const beat = db.reconcileHeartbeat(
              message.machineId,
              peekInstances(message.payload),
              HEARTBEAT_SETTLE_GRACE_MS
            );
            for (const row of beat.settled) {
              // Its parked questions cannot be answered by a process that is
              // gone, and the same goes for anything it was holding.
              forgetPending(row.id);
              escalateRoutedAsks(row.id);
              forgetQueue(row.id);
            }
            // The deployment clone's state rides the beat (contract C8). A
            // change in it is board news on its own — `diverged` appearing
            // between two registers is precisely the thing that must not wait —
            // so it joins the session reconciliation in deciding to republish.
            const beaten = peekDeploy(message.payload);
            const moved = beaten !== undefined && !sameDeploy(deploys.get(message.machineId), beaten);
            if (beaten) deploys.set(message.machineId, beaten);
            if (moved || beat.promoted.length > 0 || beat.settled.length > 0)
              publishInstances(message.machineId);
            ws.send(ack(message));
            break;
          }
          // The per-machine scanner's usage report (USAGE-SPEC.md §6.4): store
          // the buckets and the limit reading, then push only the small limits
          // frame — the dashboard pulls the heavy aggregates over REST.
          case 'usage': {
            const { buckets, limits } = message.payload as {
              buckets?: UsageBucket[];
              limits?: ClaudeLimits;
            };
            if (buckets && buckets.length > 0) db.putUsageBuckets(message.machineId, buckets);
            if (limits) db.putUsageLimits(message.machineId, limits);
            registry.broadcast({
              verb: 'frames',
              machineId: message.machineId,
              payload: { kind: 'usage', limits: db.listUsageLimits() },
            });
            break;
          }
          // A hand-off: one machine's session addressing another's. Routed on
          // `machineId` like a dashboard's `send`, because that is what it is —
          // the sender happens to be an agent rather than a reader, which the
          // payload says for itself in the message's `origin` and the hub does
          // not need to know. Cross-machine falls out for free: the envelope
          // names its target's machine, and the registry has the socket.
          case 'send': {
            // Urgency is only honoured toward the caller's own delegate; anything
            // else downgrades to a normal queued send.
            if (
              typeof message.payload === 'object' &&
              message.payload !== null &&
              (message.payload as { urgent?: unknown }).urgent === true
            ) {
              const from = peek(message.payload, 'from');
              const row = message.instanceId
                ? db.listInstances().find((r) => r.id === message.instanceId)
                : undefined;
              if (!from || !row || row.parentInstanceId !== from) {
                console.warn(`[hub] downgraded urgent send to ${message.instanceId}: not its delegate`);
                delete (message.payload as Record<string, unknown>).urgent;
              }
            }
            const from = peekPeer(message.payload);
            if (!forward(message, ws) || !message.instanceId) break;
            // The first thing a session is asked is what it is called, until
            // something names it properly.
            if (!hasAttachments(message.payload))
              nameFromLiveTurn(
                message.machineId,
                message.instanceId,
                (message.payload as { message?: unknown } | null)?.message
              );
            if (from && !isQuerySend(message.payload)) {
              // A queued hand-off: the target now carries unread work.
              handoffs.set(message.instanceId, { from, at: Date.now() });
              publishInstances(message.machineId);
            } else if (isQuerySend(message.payload) && handoffs.has(message.instanceId)) {
              // A querying send folds everything queued into the turn it
              // starts — the hand-off has been read.
              handoffs.delete(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          }
          // A session starting another session. Recorded exactly like a
          // dashboard's spawn — the row is what puts it in the rail, with a
          // transcript of its own the reader can open.
          case 'spawn': {
            // A delegate that names no permission mode inherits the ROOT of its
            // delegate tree (see the relay route — same rule, same reason).
            const parent = peekParent(message.payload);
            if (!peek(message.payload, 'permissionMode') && parent.parentInstanceId) {
              const mode = resolveDelegatePermissionMode(db.listInstances(), parent.parentInstanceId);
              if (mode) (message.payload as Record<string, unknown>).permissionMode = mode;
            }
            if (forward(message, ws) && message.instanceId) {
              db.openInstance({
                id: message.instanceId,
                machineId: message.machineId,
                cwd: peek(message.payload, 'cwd') ?? '',
                sessionId: peekResume(message.payload),
                harness: peekHarness(message.payload),
                projectId: peek(message.payload, 'projectId'),
                title: peek(message.payload, 'title'),
                kind: peekKind(message.payload),
                permissionMode: peek(message.payload, 'permissionMode'),
                model: peek(message.payload, 'model'),
                effort: peek(message.payload, 'effort'),
                ...peekParent(message.payload),
              });
              // A conversation that starts here: its first turn is its name.
              if (!peekResume(message.payload)) awaitingFirstTurn.add(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          }
          case 'frames': {
            // Legacy agents predating the harness rework frame their sessions as
            // `kind: 'sdk'`. Their messages are structurally the neutral shapes,
            // so the shim only re-tags the frame with its harness.
            if (peek(message.payload, 'kind') === 'sdk') {
              message.payload = {
                ...(message.payload as object),
                kind: 'frame',
                harness: 'claude',
              } as FramePayload;
            }
            const kind = peek(message.payload, 'kind');
            // THE INGEST LEDGER (design §7): a line becomes a hub frame AT MOST
            // ONCE per (instanceId, epoch, srcSeq). A returning agent replays
            // the gap this hub named on its register ack, and an overshoot —
            // a cursor the hub had already passed, a re-sent line after a
            // socket drop — stops dead here rather than being sequenced twice.
            // Before every side effect below on purpose: a duplicate that got
            // this far would re-name the session, re-fire the rules and
            // re-deliver a delegate's report.
            if (kind === 'frame' && message.instanceId) {
              if (!streams.admitFrame(message.instanceId, readProvenance(message))) break;
            }
            if (message.requestId && kind === 'permission_request') {
              pending.remember(message.requestId, message);
              // A delegate's ask routes to its parent; the user is only the
              // fallback. The parent must be live — otherwise the ask is the
              // user's exactly as it was before this feature.
              const sender = message.instanceId
                ? db.listInstances().find((r) => r.id === message.instanceId)
                : undefined;
              const parentId = sender?.parentInstanceId;
              const parent =
                parentId && parentId !== message.instanceId
                  ? db.listInstances().find((r) => r.id === parentId)
                  : undefined;
              const routed =
                sender !== undefined &&
                parent !== undefined &&
                (parent.status === 'running' || parent.status === 'starting');
              if (routed) {
                (message.payload as Record<string, unknown>).routedTo = 'parent';
                deliverDelegateAsk(sender, parent, message);
              } else {
                telegram?.onAsk(message);
              }
            }
            if (kind === 'frame' && message.instanceId) {
              const init = peekInit(message.payload);
              if (init) {
                db.noteInstanceSession(
                  message.instanceId,
                  init.sessionId,
                  init.cwd,
                  peek(message.payload, 'harness')
                );
                // The session naming its own conversation is the daemon's word
                // that a process exists — first-hand, and the earliest such word
                // there is. Promoting on it means a fresh spawn reads `running`
                // in a second rather than waiting up to a beat for the heartbeat
                // to say the same thing. The row is left alone if it is already
                // there; `markInstanceLive` only touches the states a live
                // process can be wrongly filed under.
                db.markInstanceLive(message.instanceId);
                publishInstances(message.machineId);
              }
            }
            // The daemon's live reading of one session. Kept in memory only, so
            // a dashboard that connects mid-turn is handed the rail's now-state
            // in its first frame instead of a blank row. Relayed unchanged below
            // — this is a copy, not an interception.
            if (kind === 'pulse' && message.instanceId) {
              const pulse = (message.payload as { pulse?: SessionPulse }).pulse;
              if (pulse) pulses.set(message.instanceId, pulse);
            }
            // What the session is holding but has not started. Mirrored here so
            // it is snapshot state rather than something each tab has to watch
            // for — and retired by BOTH paths, the dequeue frame and the real
            // turn's own id, because either can be the one that arrives.
            if (kind === 'frame' && message.instanceId) {
              const news = peekQueue(message.payload);
              if (news) {
                const moved =
                  'queued' in news
                    ? enqueue(message.instanceId, news.queued)
                    : dequeue(message.instanceId, news.retired);
                if (moved) publishInstances(message.machineId);
              }
            }
            // A session named by what it was first asked, whether the ask came
            // through this hub or the harness echoed one it was spawned with.
            if (kind === 'frame' && message.instanceId) {
              nameFromLiveTurn(
                message.machineId,
                message.instanceId,
                (message.payload as FramePayload & { kind: 'frame' }).message
              );
            }
            // Standing instructions read the same frames the dashboards do.
            // Deliberately before the delegate hand-back below: a rule that
            // wakes a session should be queued ahead of the report that would
            // otherwise be the only thing waiting for it.
            if (kind === 'frame' && message.instanceId) {
              ruleEngine.observe(
                message.instanceId,
                (message.payload as FramePayload & { kind: 'frame' }).message
              );
            }
            // Delegate hand-back: remember each parented session's final text,
            // and when its turn ends, auto-deliver it to the parent as a queued
            // peer report (aborted turns are skipped — they carry no answer).
            if (kind === 'frame' && message.instanceId) {
              const neutral = (message.payload as FramePayload & { kind: 'frame' }).message;
              if (neutral.type === 'assistant' && !neutral.parent_tool_use_id) {
                const text = neutral.message.content
                  .filter((block) => block.type === 'text')
                  .map((block) => block.text)
                  .join('');
                if (text) {
                  const acc = lastAssistant.get(message.instanceId);
                  if (acc) acc.push(text);
                  else lastAssistant.set(message.instanceId, [text]);
                }
              } else if (neutral.type === 'result') {
                const parts = lastAssistant.get(message.instanceId);
                lastAssistant.delete(message.instanceId);
                const text = parts?.length ? parts.join('\n\n') : undefined;
                const row = db.listInstances().find((r) => r.id === message.instanceId);
                const parentId = row?.parentInstanceId;
                if (row && parentId && parentId !== message.instanceId && neutral.subtype !== 'aborted') {
                  const parent = db.listInstances().find((r) => r.id === parentId);
                  if (parent) {
                    const label = `${leaf(row.cwd)}#${row.id.slice(0, 8)}`;
                    const header = neutral.is_error
                      ? `[Report from delegate ${label} — turn failed]`
                      : `[Report from delegate ${label} — turn complete]`;
                    // A failed turn's report carries the harness's own error
                    // words — "(no text)" once stood in for a 403 that was
                    // sitting right in the result frame.
                    const errors = (neutral as { errors?: string[] }).errors;
                    const body =
                      text ||
                      (errors?.length ? errors.join('\n') : '(the delegate produced no text this turn)');
                    registry.agent(parent.machineId)?.send({
                      verb: 'send',
                      machineId: parent.machineId,
                      instanceId: parent.id,
                      payload: {
                        instanceId: parent.id,
                        message: {
                          type: 'user',
                          message: { role: 'user', content: header + '\n\n' + body },
                          parent_tool_use_id: null,
                          origin: { kind: 'peer', from: row.id, name: leaf(row.cwd), fromSession: row.id },
                          shouldQuery: false,
                        },
                      },
                    });
                    handoffs.set(parent.id, { from: leaf(row.cwd), at: Date.now() });
                    publishInstances(parent.machineId);
                    publishDelegateEvent(
                      row.machineId,
                      db.recordDelegateEvent({
                        instanceId: row.id,
                        parentInstanceId: parent.id,
                        kind: 'report',
                        payload: { body, failed: neutral.is_error },
                      })
                    );
                  }
                }
              }
            }
            // An agent only frames an error about a session that failed to start
            // or died on its own, so the row records it for whoever looks later.
            if (kind === 'error' && message.instanceId) {
              const reason = peek(message.payload, 'message') ?? 'the session failed';
              db.failInstance(message.instanceId, reason);
              forgetPending(message.instanceId);
              escalateRoutedAsks(message.instanceId);
              telegram?.onError(message.instanceId, reason);
              publishInstances(message.machineId);
            }
            // A session's message to the owner, pushed without an ask: straight
            // to the bridge, tracked so a reply reaches the session that wrote it.
            if (kind === 'user_message') {
              telegram?.onUserMessage(message);
            }
            // An install answering, whoever asked for it: the cell is the hub's
            // to keep, and the reply still goes wherever it was going.
            const install = message.requestId ? pendingInstalls.get(message.requestId) : undefined;
            if (install && kind === 'control_result' && message.requestId) {
              pendingInstalls.delete(message.requestId);
              const status = peekToolStatus(message.payload);
              if (status) {
                db.setAgentToolCell(message.machineId, status);
                publishInstances(message.machineId);
              }
            }
            // A sync answering, whoever asked for it: the machine's own account
            // of what it now has is the hub's to keep, and the reply still goes
            // wherever it was going.
            if (message.requestId && kind === 'control_result' && pendingFleet.has(message.requestId)) {
              pendingFleet.delete(message.requestId);
              const report = peekFleetReport(message.payload);
              if (report) {
                // Read before the overwrite: this is the only place either
                // side of the change is in hand at once, and `reinitialize`
                // below has to know which machine actually moved.
                const previousHooks = db.listAgents().find((row) => row.machineId === message.machineId)?.fleet
                  ?.hooks;
                const hooksChanged = JSON.stringify(previousHooks ?? {}) !== JSON.stringify(report.hooks ?? {});
                db.setAgentFleet(message.machineId, report);
                publishInstances(message.machineId);
                // The disk just changed under this machine's live sessions.
                refreshSessions(message.machineId, ws, hooksChanged);
              }
            }
            // A control a route is waiting on: the reply is that request's
            // answer and nobody else's news.
            if (kind === 'control_result' && message.requestId) {
              const answering = waiting.get(message.requestId);
              if (answering) {
                waiting.delete(message.requestId);
                answering(message.payload as ControlResult);
                break;
              }
            }
            // A control's reply that settles a Ledger command turns into that
            // command's `applied`/`failed` ack. Read BEFORE the routing below
            // but allowed to preempt nothing: if a dashboard is also waiting on
            // this request id the old way, it still gets its reply.
            const settled =
              kind === 'control_result' &&
              message.requestId !== undefined &&
              streams.settleCommand(message.requestId, message.payload as ControlResult);
            // A control's reply belongs to the dashboard that asked; the rest is fan-out.
            const requester =
              message.requestId && kind === 'control_result'
                ? registry.takeRequester(message.requestId)
                : undefined;
            if (requester) requester.send(message);
            // An acknowledged command's reply is that command's news and nobody
            // else's — the same rule as the line above, in the newer dialect.
            // Without it the reply would fall through to the fleet-wide
            // broadcast that an unrouted `control_result` gets today, and every
            // dashboard would draw an error for a command it never sent.
            else if (settled) break;
            else if (kind === 'frame' && message.instanceId) {
              // The session's canonical order is assigned here, for every frame
              // and whether or not anyone follows it: the ring has to be able to
              // answer a resume from a socket that connects a minute from now.
              streams.sequence(message.instanceId, message.payload);
              // Instance-scoped frames go only to dashboards subscribed to that
              // session. Everything else — permission_request, instances,
              // delegate_event, usage, pulse, error, and any kind a future build
              // adds — broadcasts, so an unknown kind is never silently dropped.
              registry.broadcastFrame(message, message.instanceId);
            } else registry.broadcast(message);
            break;
          }
          // A session braking one of its own delegates, across machines. Honoured
          // only when the caller is the target's recorded parent.
          case 'stop':
          case 'control': {
            const from = peek(message.payload, 'from');
            const row = message.instanceId
              ? db.listInstances().find((r) => r.id === message.instanceId)
              : undefined;
            if (!from || !row || row.parentInstanceId !== from) {
              console.warn(`[hub] refused ${message.verb} from ${message.machineId}: not its delegate`);
              break;
            }
            registry.agent(row.machineId)?.send({ ...message, machineId: row.machineId });
            // A parent answering its delegate's ask with `answer_delegate`.
            const answered = peekAnswer(message.payload);
            if (answered) {
              recordDelegateAnswer(row.machineId, row.id, answered.requestId, answered.result);
            }
            break;
          }
          default:
            console.warn(`[hub] unhandled verb ${message.verb} from ${message.machineId}`);
        }
      },
      close(ws) {
        const machineId = registry.dropAgent(ws.id);
        if (!machineId) return;
        // The install may well still be running out there, but its reply can no
        // longer arrive on this socket — and the register that follows carries
        // the machine's own account of what landed.
        for (const [requestId, install] of pendingInstalls)
          if (install.machineId === machineId) pendingInstalls.delete(requestId);
        for (const [requestId, syncing] of pendingFleet)
          if (syncing === machineId) pendingFleet.delete(requestId);
        db.markAgentOffline(machineId);
        // Its deploy verdict was true of a checkout this hub can no longer ask
        // about; keeping it would be the stale-column defect in a Map.
        deploys.delete(machineId);
        // The daemon holding these queues is gone; whatever it had not started
        // did not survive it, so the rows go with the sessions.
        for (const row of db.listInstances()) {
          if (row.machineId === machineId) forgetQueue(row.id);
        }
        db.reconcileInstances(machineId, []);
        publishInstances(machineId);
      },
    })
    .ws('/ws/dashboard', {
      open(ws) {
        registry.addDashboard(ws);
        // The board, before it is asked for. This is the FIRST message every
        // dashboard receives, which is what makes it the handshake: it carries
        // `capabilities`, so a client knows on connect whether this hub speaks
        // the Ledger Protocol rather than inferring it from silence. Legacy
        // clients have always handled an `instances` frame; one arriving early
        // is a rail that fills before the REST snapshot lands.
        ws.send(instancesFrame(''));
      },
      message(ws, message) {
        // The Ledger Protocol's own shapes are not envelopes and must be read
        // before the envelope check, which would otherwise log them as junk.
        if (streams.handleClientMessage(ws, message)) return;
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed dashboard frame', message);
          return;
        }

        switch (message.verb) {
          case 'spawn':
            if (forward(message, ws) && message.instanceId) {
              // A relaunch replaces the process — questions the old one had
              // open are settled by its teardown and must not replay.
              forgetPending(message.instanceId);
              db.openInstance({
                id: message.instanceId,
                machineId: message.machineId,
                cwd: peek(message.payload, 'cwd') ?? '',
                sessionId: peekResume(message.payload),
                harness: peekHarness(message.payload),
                projectId: peek(message.payload, 'projectId'),
                title: peek(message.payload, 'title'),
                kind: peekKind(message.payload),
                permissionMode: peek(message.payload, 'permissionMode'),
                model: peek(message.payload, 'model'),
                effort: peek(message.payload, 'effort'),
                ...peekParent(message.payload),
              });
              // A conversation that starts here: its first turn is its name.
              if (!peekResume(message.payload)) awaitingFirstTurn.add(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          case 'send':
            relaySend(message as Envelope<SendPayload>, ws);
            break;
          case 'stop':
            if (forward(message, ws) && message.instanceId) {
              if (peekDiscard(message.payload)) db.discardInstance(message.instanceId);
              else db.stopInstance(message.instanceId);
              // The stream is closing; nothing it was still holding will run,
              // and whatever it was last seen doing, it is not doing now.
              forgetQueue(message.instanceId);
              pulses.delete(message.instanceId);
              escalateRoutedAsks(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          case 'control':
            relayControl(message as Envelope<ControlPayload>, ws);
            break;
          case 'fs':
            // Answered on `control_result` too, so the same requester map routes it.
            if (forward(message, ws) && message.requestId)
              registry.rememberRequester(message.requestId, ws);
            break;
          case 'subscribe': {
            // Replace-whole-set: the dashboard's open tabs *are* the subscription,
            // so every change re-sends the lot and the hub takes it verbatim.
            const ids = (message.payload as { instanceIds?: unknown } | null)?.instanceIds;
            // Minus whatever this socket already follows through the stream: a
            // session delivered in both dialects would land in the client twice.
            registry.setSubscriptions(
              ws,
              streams.noteLegacySubscriptions(
                ws,
                Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
              )
            );
            break;
          }
          default:
            console.warn(`[hub] unhandled dashboard verb ${message.verb}`);
        }
      },
      close(ws) {
        registry.dropDashboard(ws);
        // Follows nothing, awaits nothing: a stream subscription and a command
        // ack both die with the socket that asked for them.
        streams.dropSocket(ws.id);
      },
    });
};

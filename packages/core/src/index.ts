import type { FleetSyncReport } from './fleet';
import type { ToolStatus } from './tools';

// The harness-neutral spine (2026-08 rework). Cockpit owns these types; the
// harness adapters (claude, opencode, pi) translate their native events into
// them, the hub peeks them, the dashboard folds them. See harness.ts for the
// rules. The `SDK*` names are kept for one release so the dashboard's imports
// did not all have to move at once; they are neutral types, not the SDK's.
export * from './harness';

// The workflow-tool catalog and its status/policy shapes (NEW.md §10).
export * from './tools';

// Fleet MCP + skills desired state, sync reports, and the `/` menu (NEW.md §11).
export * from './fleet';

// Usage, cost & limits (USAGE-SPEC.md §4). Pure types/math only; `limits.ts`
// reads credentials with node:fs and lives under the `@cockpit/core/usage/limits`
// subpath instead.
export * from './usage';

// Standing instructions the hub enforces on every session: a phrase to watch
// for, a reply to send back, and an acknowledgement that has to come from the
// session before the rule goes quiet. The matcher lives here so the hub and the
// editor's test box decide identically.
export * from './rules';

// Hooks the fleet keeps: the lifecycle event, the matcher, and the script the
// machines run. The matcher's three-way reading lives here so the editor's test
// box previews exactly what Claude Code will do with it, and `hookProblem` is
// shared so the hub and the form refuse the same drafts for the same reasons —
// this is the one row whose convergence executes code, so it is gated twice.
export * from './hooks';

// Delegate types: named presets the `delegate` tool's `type` param resolves,
// so routing is by description instead of a raw model string.
export * from './delegate-types';

// How an `AskUserQuestion` answer is shaped, wherever it is answered from —
// the dashboard, a parent session's `answer_delegate`, the Telegram bridge.
// Shared because the tool's schema is unforgiving: the answers go back inside
// the tool's own input or the call fails validation.
export * from './question';
// The Ledger Protocol: canonical session streams + acknowledged commands.
export * from './stream';

// How a session with no given title names itself: its first user message,
// cleaned. Shared so the hub's derived title and the dashboard's transcript
// title are the same string, character for character.
export * from './title';

/** The whole agent↔hub↔dashboard protocol. Adding a verb is a design decision. */
export type Verb =
  | 'register'
  | 'heartbeat'
  | 'spawn'
  | 'send'
  | 'stop'
  | 'control'
  | 'frames'
  | 'fs'
  | 'usage'
  | 'subscribe';

/**
 * Every message on every hop. `payload` is whatever the verb carries — a neutral
 * message, a harness option object, a control call — passed through. The hub
 * routes on the envelope fields and peeks only what harness.ts names.
 */
export interface Envelope<T = unknown> {
  verb: Verb;
  machineId: string;
  instanceId?: string;
  /** The `requestId` when the payload correlates to a permission or control reply. */
  requestId?: string;
  payload: T;
}

/**
 * `spawn`: start a session on a harness. `harness` chooses the adapter (absent
 * means `claude`, for every caller written before harnesses existed); `options`
 * rides through to that adapter verbatim — only the callbacks the agent must own
 * itself (`canUseTool`/permission hooks, abort) are filled in on arrival, since
 * functions do not survive the wire. `resume` is the harness-neutral way to
 * re-open or fork a stored session; `persistSession: false` asks for a session
 * that is never stored (a side quest's transcript).
 */
export interface SpawnPayload {
  instanceId: string;
  cwd: string;
  /** Which harness runs the session. Absent = `claude`. */
  harness?: import('./harness').HarnessKind;
  /** Harness-specific spawn options, passed through verbatim. */
  options?: unknown;
  /**
   * How the session answers tool permissions. Hoisted out of `options` because
   * it is the one option the user keeps choosing — and the only one they can
   * still change afterwards, with a `setPermissionMode` {@link ControlPayload}.
   */
  permissionMode?: import('./harness').PermissionMode;
  /**
   * Which model answers, from the session's first turn. Hoisted for the same
   * reason as `permissionMode`. Absent leaves the choice to the harness.
   */
  model?: string;
  /**
   * How hard that model thinks, and how much it spends doing it. Hoisted for
   * the same reason again — and it is the third setting a `setEffort`
   * {@link ControlPayload} can still move mid-session. Absent leaves the level
   * to the harness, which is not the same as asking for its default: only the
   * model knows which stops it has.
   */
  effort?: import('./harness').EffortLevel;
  /** The project this session was started from, when it was started from one. */
  projectId?: string;
  /**
   * What the session is for, one line — a delegate's brief headline. Display
   * only.
   */
  title?: string;
  /**
   * The session this spawn is a delegate of: the child nests under it in every
   * rail, and `toolUseId` names the delegating tool call so the parent
   * transcript can render the round trip.
   */
  parent?: { instanceId: string; toolUseId?: string };
  /**
   * A side quest (NEW.md §1): throwaway work. `worktree` runs the session in a
   * detached git worktree of `baseCwd` (the spawn's `cwd` when absent) so the
   * experiment cannot touch the checkout the mainline session is using.
   */
  scratch?: { worktree?: boolean; baseCwd?: string };
  /**
   * Start from a repository instead of a directory that is already there: the
   * agent clones `repo` — `owner/name`, or any URL git understands — into a
   * subdirectory of `baseDir` and runs the session in the clone.
   */
  bootstrap?: { repo: string; baseDir: string };
  /**
   * Re-open (or fork) a stored session. `sessionKey` is the harness's own
   * session id; `fork` reads the origin conversation into a new one; `atMessage`
   * resumes up to and including that assistant turn (a rewind anchor).
   */
  resume?: { sessionKey: string; fork?: boolean; atMessage?: string };
  /** `false` asks the harness never to store this session's transcript. */
  persistSession?: boolean;
  /**
   * Skill names to load natively before the first prompt. Each harness loads
   * them via its own mechanism — opencode sends `/skill` commands, claude pushes
   * them into the input stream — so the delegate session sees the skill the same
   * way it would if the user had typed the slash command.
   */
  skills?: string[];
  /**
   * Tools this session may never call, beyond whatever the harness already
   * denies. Set by a resolved {@link DelegateType}'s own `denyTools`; the
   * claude adapter merges it into the `disallowedTools` it already assembles.
   */
  denyTools?: string[];
  /**
   * Correlates the `control_result` frame the agent answers the spawn with, once
   * the session is in place.
   */
  requestId?: string;
}

/** One repository a machine can {@link SpawnPayload.bootstrap} from. */
export interface RepoInfo {
  nameWithOwner: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  updatedAt: string;
  description: string;
}

/**
 * What the machine-scoped `listRepos` control answers with. The GitHub CLI is
 * the machine's own credential store — cockpit never holds a token.
 */
export type ReposResult = RepoInfo[] | { error: 'gh-missing' | 'gh-unauthenticated' };

/** `owner/name`, however the repository was written. */
export const repoPath = (repo: string): string =>
  repo
    .trim()
    .replace(/\/+$/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')
    .replace(/^[^/]+@[^:]+:/, '')
    .replace(/\.git$/, '');

/** `send`: one turn of input for a live session's prompt stream. */
export interface SendPayload {
  instanceId: string;
  /** The user turn, in the neutral user-message shape every adapter understands. */
  message: import('./harness').NeutralUserMessage;
  /**
   * Text the user pasted rather than typed, kept out of `message` so the agent
   * can fold it into the turn as quoted material the model won't mistake for
   * the sentence around it.
   */
  attachments?: { kind: 'text'; name: string; content: string }[];
  /** Images the turn carries: base64, with no `data:` URI prefix. */
  images?: { mediaType: string; data: string }[];
  /**
   * Force delivery: a busy claude session reads it mid-turn via `streamInput`;
   * opencode/pi interrupt the turn and deliver it as the immediate next one. The
   * hub honours urgency only when the target is `from`'s own delegate; otherwise
   * it downgrades to a normal queued send.
   */
  urgent?: boolean;
  /** The instance a fleet-originated send claims as its caller. */
  from?: string;
}

/** `subscribe`: the open sessions a dashboard wants `frame` frames for. */
export interface SubscribePayload {
  instanceIds: string[];
}

/** `stop`: interrupt and close a live session. */
export interface StopPayload {
  instanceId: string;
  /** Also tear down what the spawn created for a side quest — its git worktree. */
  discard?: boolean;
  /** Correlates the `control_result` frame a discard's teardown answers with. */
  requestId?: string;
  /** The instance a fleet-originated stop claims as its caller; the hub honours the call only when the target is that instance's own delegate. */
  from?: string;
}

/**
 * `control`: invoke a named method on a live session, or on the machine when
 * `instanceId` is absent. The method is one of the neutral names in harness.ts
 * ({@link CONTROL_INTERRUPT}, …) plus {@link RESOLVE_PERMISSION}; the reply
 * comes back as a `control_result` frame carrying the same `requestId`.
 *
 * Machine-scoped, `method` names either a session-catalog operation — routed to
 * whichever harness owns the id (`harness`, or merged across all when listing)
 * — or a machine feature (`listRepos`, `installTool`, the fleet controls). With
 * no `instanceId` and no `harness`, `listSessions` merges every harness.
 */
export interface ControlPayload {
  instanceId?: string;
  /** The harness the machine-scoped call is addressed at; session calls route by instance. */
  harness?: import('./harness').HarnessKind;
  requestId: string;
  method: string;
  args?: unknown[];
  /** The instance a fleet-originated control claims as its caller; the hub honours the call only when the target is that instance's own delegate. */
  from?: string;
}

/** Settles a parked permission request; args are `[requestId, PermissionResult]`. */
export const RESOLVE_PERMISSION = 'resolvePermission';

/**
 * The tool that asks the reader rather than the machine. Its permission request
 * *is* the question, so it settles through {@link RESOLVE_PERMISSION} like any
 * other: the choices arrive as the request's `input`, and the answer goes back
 * as `updatedInput`.
 */
export const ASK_USER_QUESTION = 'AskUserQuestion';

/**
 * `fs`: the machine's files, for the cwd picker and light markdown editing
 * (NEW.md §6) — not a file transfer. `list` answers with {@link FsEntry}[],
 * `read` with the file's text, `write` with the byte count it wrote.
 */
export interface FsPayload {
  requestId: string;
  op: 'list' | 'read' | 'write';
  path: string;
  /** `write` only: the text the file is replaced with. */
  content?: string;
}

/** One dirent of an `fs list`. `size` is 0 for a directory. */
export interface FsEntry {
  name: string;
  kind: 'dir' | 'file';
  size: number;
}

/**
 * A machine from the hub's `agents` table — what `GET /api/agents` answers with,
 * and what rides alongside the sessions in an `instances` frame.
 */
export interface AgentRow {
  machineId: string;
  hostname: string;
  os: string;
  status: string;
  /** A `Date` inside the hub, the ISO string it serialises to everywhere else. */
  lastSeenAt: string | number | Date | null;
  /** `unknown` until a daemon that probes has registered at least once. */
  auth: import('./harness').AuthState | 'unknown';
  /** What each installed harness can do, as the daemon reported at register. */
  harnesses?: import('./harness').HarnessReport[];
  /**
   * Last-known workflow-tool status by tool id (NEW.md §10).
   */
  tools?: Record<string, ToolStatus>;
  /**
   * Last-known fleet-config sync report (NEW.md §11).
   */
  fleet?: FleetSyncReport;
  /**
   * The cockpit build this machine's daemon is running (NEW.md §12).
   */
  build?: BuildInfo;
}

/** What a daemon reports about the checkout it was started from. */
export interface BuildInfo {
  /** `@cockpit/agent`'s package version. */
  version: string;
  /** Short git SHA, when the checkout is a git one. */
  commit?: string;
  /** Whether that checkout has uncommitted changes. */
  dirty?: boolean;
  /** When this daemon started, ms epoch. */
  startedAt: number;
}

/**
 * What an {@link UPDATE_COCKPIT} run did. Every field is what actually
 * happened, not what was asked for.
 */
export interface UpdateReport {
  from?: string;
  to?: string;
  /** The tail of what git said — 'Already up to date.' included. */
  pulled: string;
  installed: boolean;
  built: boolean;
  /** Service ids actually restarted. */
  restarted: string[];
  /** Why something asked for did not happen. */
  skipped?: string;
}

/**
 * Turns the machine's checkout into the current one: `git pull`, install,
 * rebuild the dashboard, restart the hub and dashboard services.
 */
export const UPDATE_COCKPIT = 'updateCockpit';

/**
 * Whether this machine's daemon is in the middle of anything — how a restart
 * waits for a good moment instead of cutting a turn in half.
 * Answers `{ busy: number; instances: string[] }`.
 */
export const AGENT_BUSY = 'agentBusy';

/**
 * A session the hub knows about — one row of its `instances` table.
 */
export interface InstanceRow {
  id: string;
  machineId: string;
  cwd: string;
  status: string;
  /** The harness's own session id, once the session has named itself. */
  sessionId: string | null;
  /** Which harness owns {@link sessionId} — what a resume and a catalog read route on. */
  harness?: string | null;
  /** The instance this one is a delegate of; absent for a mainline session. */
  parentInstanceId?: string | null;
  /** The delegating tool call, so the parent transcript can render the round trip. */
  parentToolUseId?: string | null;
  /** Set when the session was started from a project page. */
  projectId?: string | null;
  /**
   * What the session is for, as its {@link SpawnPayload.title} said — a
   * delegate's brief headline. Null on a session that was started without one.
   */
  title?: string | null;
  /**
   * The name the session's first user message gave it, derived once by the hub.
   * A listing already answers {@link title} with this when nothing named the
   * row, so a reader never watches the label change as the transcript arrives.
   */
  derivedTitle?: string | null;
  /** `scratch` for a side quest; absent from a hub that predates the column. */
  kind?: string;
  /**
   * How the session answers tool permissions and which model answers, as of its
   * last spawn, switch or `init`. Null on a session that has never said.
   */
  permissionMode?: string | null;
  model?: string | null;
  /**
   * The effort level its last spawn or switch asked for. No `init` frame reports
   * effort back, so unlike its two neighbours this row is the only record of it
   * — and what a restart has to read to hand the session back as it was.
   */
  effort?: string | null;
  /** What killed the session, on a row the agent reported as `error`. */
  lastError?: string | null;
  /** When the row last moved. */
  updatedAt?: string | number | Date | null;
}

/**
 * A coarse, now-state the rail draws without frames: what a session is doing
 * right now, folded on the daemon from the frames it is already pumping. It is
 * the *fallback* the dashboard reads for sessions it has not subscribed to —
 * open sessions still render the richer frame-fed state. `activity` is the same
 * three words the fleet view uses; `busy`/`runningSubagents` keep the finer
 * signals separate so a reader can still tell "blocked" from "working".
 */
export interface SessionPulse {
  instanceId: string;
  busy: boolean;
  /** Coarse now-state the rail draws without frames. */
  activity: 'working' | 'blocked' | 'idle';
  currentTool: { name: string; glance: string } | null;
  runningSubagents: number;
  /** ms epoch of the last frame that changed this pulse. */
  at: number;
}

/**
 * What the hub records on a session whose daemon restarted out from under it.
 */
export const RESTART_RESUMABLE = 'The agent restarted; this session did not survive it.';

/** And what it records when there is nothing to go back to. */
export const RESTART_LOST = 'The agent restarted, and this session left nothing to resume from.';

/**
 * `frames`: everything a session produces, flowing agent→hub→dashboard. The
 * `frame` kind is a neutral message; `raw` on it carries the harness's own
 * event verbatim.
 */
export type FramePayload =
  | {
      kind: 'frame';
      instanceId: string;
      harness: import('./harness').HarnessKind;
      message: import('./harness').NeutralMessage;
    }
  | {
      /**
       * Hub-originated: every session it still lists, pushed whenever one of the
       * rows moves.
       */
      kind: 'instances';
      instances: InstanceRow[];
      agents: AgentRow[];
    }
  | {
      kind: 'permission_request';
      instanceId: string;
      harness: import('./harness').HarnessKind;
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      suggestions?: import('./harness').PermissionUpdate[];
      /** `tool` for a permission, `question` for an AskUserQuestion-shaped prompt. */
      requestKind?: 'tool' | 'question';
    }
  | {
      /**
       * Hub-originated: every machine's latest limit reading, pushed on each
       * agent usage report (USAGE-SPEC.md §6.4). Small by design — the heavy
       * aggregates are pulled over REST.
       */
      kind: 'usage';
      limits: import('./usage').UsageLimitsReading[];
    }
  | {
      /** No `instanceId` when the call it answers was machine-scoped. */
      kind: 'control_result';
      instanceId?: string;
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      /** Hub-originated routing failures (e.g. target machine offline). */
      kind: 'error';
      instanceId?: string;
      requestId?: string;
      verb?: Verb;
      message: string;
    }
  | {
      /**
       * Daemon-originated: a session pushing text straight to the owner's
       * Telegram, with no ask to settle and nothing to answer. The hub hands it
       * to the bridge; the owner replying to it reaches the session, as with
       * any bridged message.
       */
      kind: 'user_message';
      instanceId: string;
      text: string;
    }
  | {
      /**
       * Daemon-originated: one instance's coarse now-state, throttled to ~1/sec.
       * Broadcast — every dashboard wants the rail's word on every session, not
       * only the ones it has open.
       */
      kind: 'pulse';
      instanceId: string;
      pulse: SessionPulse;
    };

export const COCKPIT_HUB_PORT = 3456;

/**
 * The session tag a side quest's transcript carries (NEW.md §1). The agent
 * applies it when the session names itself and clears it when the quest is
 * kept; the catalogs the rails read hide what wears it.
 */
export const COCKPIT_SCRATCH_TAG = 'cockpit-scratch';

export const COCKPIT_ENV = {
  hubUrl: 'COCKPIT_HUB_URL',
  hubPort: 'COCKPIT_HUB_PORT',
  machineId: 'COCKPIT_MACHINE_ID',
  /** `1` stops the hub advertising itself over mDNS. */
  noMdns: 'COCKPIT_NO_MDNS',
  /** The bot the hub reaches its owner's Telegram on. */
  telegramToken: 'COCKPIT_TELEGRAM_TOKEN',
  telegramAsrUrl: 'COCKPIT_TELEGRAM_ASR_URL',
  telegramAsrModel: 'COCKPIT_TELEGRAM_ASR_MODEL',
  telegramAsrMode: 'COCKPIT_TELEGRAM_ASR_MODE',
} as const;

/**
 * The mDNS service the hub advertises and `cockpit` browses for.
 */
export const COCKPIT_MDNS_TYPE = 'cockpit';

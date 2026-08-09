import type {
  Options,
  PermissionMode,
  PermissionUpdate,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import type { FleetSyncReport } from './fleet';
import type { ToolStatus } from './tools';

// The SDK is the type system: consumers tunnel these types, never re-model them.
export type * from '@anthropic-ai/claude-agent-sdk';

// The workflow-tool catalog and its status/policy shapes (NEW.md §10).
export * from './tools';

// Fleet MCP + skills desired state, sync reports, and the `/` menu (NEW.md §11).
export * from './fleet';

/** The whole agent↔hub↔dashboard protocol. Adding a verb is a design decision. */
export type Verb =
  | 'register'
  | 'heartbeat'
  | 'spawn'
  | 'send'
  | 'stop'
  | 'control'
  | 'frames'
  | 'fs';

/**
 * Every message on every hop. `payload` is whatever the verb carries — an SDK
 * message, an `Options` object, a `Query` method call — passed through verbatim.
 */
export interface Envelope<T = unknown> {
  verb: Verb;
  machineId: string;
  instanceId?: string;
  /** SDK `requestId` when the payload correlates to a permission or dialog request. */
  requestId?: string;
  payload: T;
}

/**
 * `spawn`: start a `query()`. `options` rides through to the SDK verbatim — only
 * the callbacks the agent must own itself (`canUseTool`, `abortController`) are
 * filled in on arrival, since functions do not survive the wire.
 */
export interface SpawnPayload {
  instanceId: string;
  cwd: string;
  options?: Options;
  /**
   * How the session answers tool permissions. Hoisted out of `options` because
   * it is the one option the user keeps choosing — and the only one they can
   * still change afterwards, with a `setPermissionMode` {@link ControlPayload}.
   */
  permissionMode?: PermissionMode;
  /**
   * Which model answers, from the session's first turn. Hoisted for the same
   * reason as `permissionMode` — the user chooses it on the form and keeps
   * changing it afterwards, with a `setModel` {@link ControlPayload}. Absent
   * leaves the choice to the SDK, which is what most sessions want.
   */
  model?: string;
  /** The project this session was started from, when it was started from one. */
  projectId?: string;
  /**
   * A side quest (NEW.md §1): throwaway work. `worktree` runs the session in a
   * detached git worktree of `baseCwd` (the spawn's `cwd` when absent) so the
   * experiment cannot touch the checkout the mainline session is using.
   */
  scratch?: { worktree?: boolean; baseCwd?: string };
  /**
   * Start from a repository instead of a directory that is already there: the
   * agent clones `repo` — `owner/name`, or any URL git understands — into a
   * subdirectory of `baseDir` and runs the session in the clone. It works the
   * target directory out for itself, so `cwd` is only where the dashboard
   * expects the clone to land.
   */
  bootstrap?: { repo: string; baseDir: string };
  /**
   * Correlates the `control_result` frame the agent answers the spawn with, once
   * the session is in place. A relaunch — the same `instanceId` spawned again,
   * for an option only a new process can take — is what needs the answer: the
   * SDK does not start the process until the session is given work, so its first
   * frame is no signal that the swap happened.
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
 * the machine's own credential store — cockpit never holds a token — so a
 * machine without `gh`, or with a `gh` nobody has logged into, answers with
 * something the user can act on rather than failing.
 */
export type ReposResult = RepoInfo[] | { error: 'gh-missing' | 'gh-unauthenticated' };

/**
 * `owner/name`, however the repository was written — bare, HTTPS URL, or SSH
 * remote. Both ends of a {@link SpawnPayload.bootstrap} read a reference through
 * this: it is how the dashboard can say where the clone will land, and how the
 * agent recognises a clone that is already there.
 */
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
  message: SDKUserMessage;
  /**
   * Text the user pasted rather than typed, kept out of `message` so the agent
   * can fold it into the turn as quoted material the model won't mistake for
   * the sentence around it.
   */
  attachments?: { kind: 'text'; name: string; content: string }[];
  /** Images the turn carries: base64, with no `data:` URI prefix. */
  images?: { mediaType: string; data: string }[];
}

/** `stop`: interrupt and close a live session. */
export interface StopPayload {
  instanceId: string;
  /** Also tear down what the spawn created for a side quest — its git worktree. */
  discard?: boolean;
  /** Correlates the `control_result` frame a discard's teardown answers with. */
  requestId?: string;
}

/**
 * `control`: invoke a named `Query` method with its arguments. `method` is any
 * key of the SDK's `Query` handle, plus {@link RESOLVE_PERMISSION}, which the
 * agent answers itself. The reply comes back as a `control_result` frame
 * carrying the same `requestId`.
 *
 * Without `instanceId` the call is machine-scoped and `method` names one of the
 * SDK's module-level session functions instead (`listSessions`,
 * `getSessionInfo`, `getSessionMessages`, `renameSession`, `deleteSession`) —
 * the session catalog is readable with nothing running on the machine — or
 * `listRepos`, which the agent answers itself with {@link ReposResult}.
 */
export interface ControlPayload {
  instanceId?: string;
  requestId: string;
  method: string;
  args?: unknown[];
}

/** Settles a parked `canUseTool` request; args are `[requestId, PermissionResult]`. */
export const RESOLVE_PERMISSION = 'resolvePermission';

/**
 * The tool that asks the reader rather than the machine. Its permission request
 * *is* the question, so it settles through {@link RESOLVE_PERMISSION} like any
 * other: the choices arrive as the request's `input`, and the answer goes back
 * as `updatedInput`.
 *
 * Not through the SDK's dialog channel, which looks like it should carry this
 * and does not: `onUserDialog` is only reached for `mcp_url_elicitation`,
 * `refusal_fallback_prompt` and `fable_overage_consent_prompt` — measured
 * against the CLI 2.1.220 that SDK 0.3.220 ships, which hands every other
 * dialog kind, `permission_ask_user_question` included, its own default answer
 * without asking the host. Declaring the kind does not change that.
 */
export const ASK_USER_QUESTION = 'AskUserQuestion';

/** One question of an {@link ASK_USER_QUESTION} call, as the SDK schemas it. */
export type UserQuestion = AskUserQuestionInput['questions'][number];

/**
 * What the tool reads the reader's choices back out of: the question's own text
 * mapped to the labels chosen, an array only where the question asked for
 * `multiSelect`. The SDK does not type this one — a call whose `updatedInput`
 * carries no `answers` comes back to the model as "The user did not answer the
 * questions."
 */
export type UserAnswers = Record<string, string | string[]>;

/**
 * `fs`: the machine's files, for the cwd picker and light markdown editing
 * (NEW.md §6) — not a file transfer. `list` answers with {@link FsEntry}[],
 * `read` with the file's text, `write` with the byte count it wrote. Like a
 * `control` call, the reply rides a `control_result` frame with this `requestId`.
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
 * Whether a machine's daemon can actually start a Claude Code session.
 *
 * `unreadable-credentials` is macOS's own failure and the reason this exists:
 * Claude Code keeps its credentials in the login keychain, and a daemon running
 * outside the GUI session is refused the secret — `errSecInteractionNotAllowed`
 * — even though the item is right there. Nothing looks wrong until every turn
 * comes back "Not logged in · Please run /login", and logging in again through
 * the GUI does not help, because the credential was never what was missing.
 */
export type AuthState = 'authenticated' | 'unauthenticated' | 'unreadable-credentials';

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
  auth: AuthState | 'unknown';
  /**
   * Last-known workflow-tool status by tool id (NEW.md §10) — what the daemon
   * reported at register or after an install, plus the `installing` the hub
   * writes while one is in flight. Absent from a hub that predates the column.
   */
  tools?: Record<string, ToolStatus>;
  /**
   * Last-known fleet-config sync report (NEW.md §11) — what the machine said
   * the last time it converged on the hub's MCP servers and plugins. Absent
   * from a hub that predates the column.
   */
  fleet?: FleetSyncReport;
  /**
   * The cockpit build this machine's daemon is running (NEW.md §12). The fleet
   * is edited while it runs, so a machine quietly a month behind is the normal
   * failure — this is what lets a rail say so instead of the user finding out
   * through a protocol error.
   */
  build?: BuildInfo;
}

/** What a daemon reports about the checkout it was started from. */
export interface BuildInfo {
  /** `@cockpit/agent`'s package version. */
  version: string;
  /** Short git SHA, when the checkout is a git one. */
  commit?: string;
  /** Whether that checkout has uncommitted changes — a dev machine, mid-edit. */
  dirty?: boolean;
  /** When this daemon started, ms epoch. */
  startedAt: number;
}

/**
 * What an {@link UPDATE_COCKPIT} run did. Every field is what actually
 * happened, not what was asked for: an update that could not restart the
 * agent still says so rather than reporting success.
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
 * rebuild the dashboard, restart the hub and dashboard services. The agent
 * restarts itself only when asked and only when it is idle — it is hosting
 * the sessions that would be interrupted.
 *
 * `args: [{ restartAgent?: boolean; force?: boolean }]`
 */
export const UPDATE_COCKPIT = 'updateCockpit';

/**
 * Whether this machine's daemon is in the middle of anything — how a restart
 * waits for a good moment instead of cutting a turn in half.
 * Answers `{ busy: number; instances: string[] }`.
 */
export const AGENT_BUSY = 'agentBusy';

/**
 * A session the hub knows about — one row of its `instances` table. The hub is
 * the only writer, so this is the shape both its REST reads and its `instances`
 * frames answer with.
 */
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
  /**
   * How the session answers tool permissions ({@link SpawnPayload.permissionMode})
   * and which model answers ({@link SpawnPayload.model}), as of its last spawn,
   * switch or `init`. Null on a session that has never said.
   */
  permissionMode?: string | null;
  model?: string | null;
  /** What killed the session, on a row the agent reported as `error`. */
  lastError?: string | null;
}

/**
 * What the hub records on a session whose daemon restarted out from under it.
 * The process is gone, but the conversation is not: the SDK keeps the
 * transcript, so spawning the row again with `resume` picks the same session
 * back up — which is what any action on it does. Both ends name the sentence
 * from here, because it is what tells a session that is merely asleep from one
 * that died of something.
 *
 * The wording is bleaker than the state it now stands for, and stays that way
 * on purpose: it is the sentence already sitting in every hub's rows, and it is
 * a marker rather than copy — a sleeping session is shown as sleeping, never as
 * this.
 */
export const RESTART_RESUMABLE = 'The agent restarted; this session did not survive it.';

/**
 * And what it records when there is nothing to go back to — the daemon reported
 * no transcript for the session, so the restart really did end it.
 */
export const RESTART_LOST = 'The agent restarted, and this session left nothing to resume from.';

/** `frames`: everything a session produces, flowing agent→hub→dashboard. */
export type FramePayload =
  | { kind: 'sdk'; instanceId: string; message: SDKMessage }
  | {
      /**
       * Hub-originated: every session it still lists, pushed whenever one of the
       * rows moves. A dashboard that is already open follows the fleet from
       * these, so opening, failing, settling and discarding need no re-fetch.
       *
       * The machines ride along because a daemon registering is the moment its
       * auth state changes, and a rail that only learns that on reload lies
       * until you reload it.
       */
      kind: 'instances';
      instances: InstanceRow[];
      agents: AgentRow[];
    }
  | {
      kind: 'permission_request';
      instanceId: string;
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      suggestions?: PermissionUpdate[];
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
      /** Hub-originated routing failures (e.g. target machine offline) */
      kind: 'error';
      instanceId?: string;
      requestId?: string;
      verb?: Verb;
      message: string;
    };

export const COCKPIT_HUB_PORT = 3456;

/**
 * The SDK session tag a side quest's transcript carries (NEW.md §1). The agent
 * applies it when the session names itself and clears it when the quest is
 * kept; the catalogs the rails read hide what wears it, so a side quest stays
 * out of the user's history without hiding the directory it ran in.
 */
export const COCKPIT_SCRATCH_TAG = 'cockpit-scratch';

export const COCKPIT_ENV = {
  hubUrl: 'COCKPIT_HUB_URL',
  hubPort: 'COCKPIT_HUB_PORT',
  machineId: 'COCKPIT_MACHINE_ID',
  /** `1` stops the hub advertising itself over mDNS, and is not read anywhere else. */
  noMdns: 'COCKPIT_NO_MDNS',
  /** The bot the hub reaches its owner's Telegram on. Absent, no bridge runs. */
  telegramToken: 'COCKPIT_TELEGRAM_TOKEN',
} as const;

/**
 * The mDNS service the hub advertises and `cockpit` browses for, as
 * `_cockpit._tcp.local`. Both ends name it from here so they cannot drift.
 */
export const COCKPIT_MDNS_TYPE = 'cockpit';

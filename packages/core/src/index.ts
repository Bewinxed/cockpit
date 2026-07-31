import type {
  Options,
  PermissionMode,
  PermissionUpdate,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// The SDK is the type system: consumers tunnel these types, never re-model them.
export type * from '@anthropic-ai/claude-agent-sdk';

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
  /** What killed the session, on a row the agent reported as `error`. */
  lastError?: string | null;
}

/** `frames`: everything a session produces, flowing agent→hub→dashboard. */
export type FramePayload =
  | { kind: 'sdk'; instanceId: string; message: SDKMessage }
  | {
      /**
       * Hub-originated: every session it still lists, pushed whenever one of the
       * rows moves. A dashboard that is already open follows the fleet from
       * these, so opening, failing, settling and discarding need no re-fetch.
       */
      kind: 'instances';
      instances: InstanceRow[];
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
} as const;

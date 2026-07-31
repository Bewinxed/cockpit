import type {
  Options,
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
  /** The project this session was started from, when it was started from one. */
  projectId?: string;
  /**
   * A side quest (NEW.md §1): throwaway work. `worktree` runs the session in a
   * detached git worktree of `baseCwd` (the spawn's `cwd` when absent) so the
   * experiment cannot touch the checkout the mainline session is using.
   */
  scratch?: { worktree?: boolean; baseCwd?: string };
}

/** `send`: one turn of input for a live session's prompt stream. */
export interface SendPayload {
  instanceId: string;
  message: SDKUserMessage;
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
 * the session catalog is readable with nothing running on the machine.
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

/** `frames`: everything a session produces, flowing agent→hub→dashboard. */
export type FramePayload =
  | { kind: 'sdk'; instanceId: string; message: SDKMessage }
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

export const COCKPIT_ENV = {
  hubUrl: 'COCKPIT_HUB_URL',
  hubPort: 'COCKPIT_HUB_PORT',
  machineId: 'COCKPIT_MACHINE_ID',
} as const;

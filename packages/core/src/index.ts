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
}

/** `send`: one turn of input for a live session's prompt stream. */
export interface SendPayload {
  instanceId: string;
  message: SDKUserMessage;
}

/** `stop`: interrupt and close a live session. */
export interface StopPayload {
  instanceId: string;
}

/**
 * `control`: invoke a named `Query` method with its arguments. `method` is any
 * key of the SDK's `Query` handle, plus {@link RESOLVE_PERMISSION}, which the
 * agent answers itself. The reply comes back as a `control_result` frame
 * carrying the same `requestId`.
 */
export interface ControlPayload {
  instanceId: string;
  requestId: string;
  method: string;
  args?: unknown[];
}

/** Settles a parked `canUseTool` request; args are `[requestId, PermissionResult]`. */
export const RESOLVE_PERMISSION = 'resolvePermission';

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
      kind: 'control_result';
      instanceId: string;
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

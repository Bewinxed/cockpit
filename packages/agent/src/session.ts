import {
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ControlPayload,
  Envelope,
  FramePayload,
  SendPayload,
  SpawnPayload,
  StopPayload,
} from '@cockpit/core';
import { RESOLVE_PERMISSION } from '@cockpit/core';
import { Effect } from 'effect';

export type FrameSink = (frame: FramePayload) => void;

const warn = (message: string): void => {
  Effect.runFork(Effect.logWarning(message));
};

/**
 * The prompt `query()` iterates. Staying unresolved between turns is the whole
 * point: it is what keeps one session alive across many `send`s.
 */
class InputStream implements AsyncIterable<SDKUserMessage> {
  #queue: SDKUserMessage[] = [];
  #waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  #ended = false;

  push(message: SDKUserMessage): void {
    const waiting = this.#waiting;
    if (waiting) {
      this.#waiting = null;
      waiting({ done: false, value: message });
      return;
    }
    this.#queue.push(message);
  }

  end(): void {
    this.#ended = true;
    this.#waiting?.({ done: true, value: undefined });
    this.#waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const queued = this.#queue.shift();
        if (queued) return Promise.resolve({ done: false, value: queued });
        if (this.#ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.#waiting = resolve;
        });
      },
    };
  }
}

interface Session {
  readonly handle: Query;
  readonly input: InputStream;
  /** Parked `canUseTool` resolvers, keyed by the SDK's `requestId`. */
  readonly permissions: Map<string, (result: PermissionResult) => void>;
  readonly pump: Promise<void>;
}

/** A `Query` method or SDK session function reached by name through `control`. */
type ControlMethod = (...args: unknown[]) => unknown;

/**
 * The SDK's session catalog: module-level functions, not `Query` methods, so a
 * machine-scoped `control` reaches them with nothing running on this machine.
 */
const SESSION_FUNCTIONS = {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  deleteSession,
} as Record<string, ControlMethod | undefined>;

/**
 * Owns every live SDK session on this machine and pumps their messages at the
 * hub. Nothing here interprets an SDK message — frames go out verbatim.
 */
export class SessionSupervisor {
  readonly #sessions = new Map<string, Session>();

  /**
   * Re-pointed at each hub connection. Frames produced while the hub is away are
   * dropped; the hub replays what a session is still blocked on by calling
   * `control reinitialize` after it reconnects.
   */
  sink: FrameSink = () => {};

  /** Fire-and-forget: the socket callback has nowhere to put a rejection. */
  dispatch(envelope: Envelope): void {
    this.#route(envelope).catch((error: unknown) => {
      warn(`${envelope.verb} failed: ${error}`);
    });
  }

  /** Ends every session, so the daemon's scope closing leaves no child processes. */
  async shutdown(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((instanceId) => this.#stop({ instanceId })));
  }

  #route(envelope: Envelope): Promise<void> {
    switch (envelope.verb) {
      case 'spawn':
        return this.#spawn(envelope.payload as SpawnPayload);
      case 'send':
        return this.#send(envelope.payload as SendPayload);
      case 'stop':
        return this.#stop(envelope.payload as StopPayload);
      case 'control':
        return this.#control(envelope.payload as ControlPayload);
      default:
        return Promise.resolve();
    }
  }

  async #spawn({ instanceId, cwd, options }: SpawnPayload): Promise<void> {
    const input = new InputStream();
    const permissions = new Map<string, (result: PermissionResult) => void>();

    const handle = query({
      prompt: input,
      options: {
        // Subagent observability is the product's first promise (NEW.md §1), so
        // the full nested conversation and its progress summaries are on unless
        // the spawn payload deliberately turns them off.
        forwardSubagentText: true,
        agentProgressSummaries: true,
        ...options,
        cwd,
        includePartialMessages: true,
        canUseTool: (toolName, toolInput, { requestId, suggestions }) =>
          new Promise<PermissionResult>((resolve) => {
            permissions.set(requestId, resolve);
            this.sink({
              kind: 'permission_request',
              instanceId,
              requestId,
              toolName,
              input: toolInput,
              suggestions,
            });
          }),
      },
    });

    const session: Session = { handle, input, permissions, pump: this.#pump(instanceId, handle) };
    this.#sessions.set(instanceId, session);
  }

  async #pump(instanceId: string, handle: Query): Promise<void> {
    try {
      for await (const message of handle) {
        this.sink({ kind: 'sdk', instanceId, message });
      }
    } catch (error) {
      warn(`session ${instanceId} pump stopped: ${error}`);
    } finally {
      this.#sessions.delete(instanceId);
    }
  }

  async #send({ instanceId, message }: SendPayload): Promise<void> {
    this.#session(instanceId).input.push(message);
  }

  async #stop({ instanceId }: StopPayload): Promise<void> {
    const session = this.#sessions.get(instanceId);
    if (!session) return;
    this.#sessions.delete(instanceId);

    session.input.end();
    // Unblock anything parked on a permission prompt, or the loop never ends.
    for (const resolve of session.permissions.values()) {
      resolve({ behavior: 'deny', message: 'session stopped' });
    }
    session.permissions.clear();

    await session.handle.interrupt().catch(() => {});
    session.handle.close();
    await session.pump;
  }

  async #control({ instanceId, requestId, method, args = [] }: ControlPayload): Promise<void> {
    try {
      const result = await this.#call(instanceId, method, args);
      this.sink({ kind: 'control_result', instanceId, requestId, ok: true, result });
    } catch (error) {
      this.sink({
        kind: 'control_result',
        instanceId,
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** No instanceId means the call is about this machine, not about a session. */
  async #call(instanceId: string | undefined, method: string, args: unknown[]): Promise<unknown> {
    if (instanceId === undefined) {
      const sessionFunction = SESSION_FUNCTIONS[method];
      if (!sessionFunction) throw new Error(`unknown session function: ${method}`);
      return await sessionFunction(...args);
    }
    if (method === RESOLVE_PERMISSION) {
      return this.#resolvePermission(instanceId, args as [string, PermissionResult]);
    }
    return await this.#invoke(instanceId, method, args);
  }

  async #invoke(instanceId: string, method: string, args: unknown[]): Promise<unknown> {
    const handle = this.#session(instanceId).handle as unknown as Record<string, ControlMethod>;
    if (typeof handle[method] !== 'function') {
      throw new Error(`unknown control method: ${method}`);
    }
    return await handle[method](...args);
  }

  #resolvePermission(instanceId: string, [requestId, result]: [string, PermissionResult]): void {
    const { permissions } = this.#session(instanceId);
    const resolve = permissions.get(requestId);
    if (!resolve) throw new Error(`no permission request ${requestId}`);
    permissions.delete(requestId);
    resolve(result);
  }

  #session(instanceId: string): Session {
    const session = this.#sessions.get(instanceId);
    if (!session) throw new Error(`no session ${instanceId}`);
    return session;
  }
}

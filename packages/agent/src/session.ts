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
  FsPayload,
  SendPayload,
  SpawnPayload,
  StopPayload,
} from '@cockpit/core';
import { RESOLVE_PERMISSION } from '@cockpit/core';
import { Effect } from 'effect';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runFs } from './fs';

export type FrameSink = (frame: FramePayload) => void;

const warn = (message: string): void => {
  Effect.runFork(Effect.logWarning(message));
};

/**
 * `~` is the shell's, not a path: spawning in a literal `~` puts the SDK in a
 * directory that does not exist, which it reports as a launch failure.
 */
const expandHome = (path: string): string => {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
};

const isDirectory = async (path: string): Promise<boolean> => {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
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

/**
 * Whether a turn is in flight, and a way to wait for the one that is. Ending a
 * session between turns rather than in the middle of a tool call is what leaves
 * the transcript on disk coherent enough to resume from.
 */
class Turn {
  busy = false;
  #ended = Promise.withResolvers<void>();

  start(): void {
    this.busy = true;
  }

  end(): void {
    this.busy = false;
    this.#ended.resolve();
    this.#ended = Promise.withResolvers<void>();
  }

  /** Resolves when the turn in flight ends, or when `ms` runs out — whichever first. */
  async settle(ms: number): Promise<void> {
    if (!this.busy) return;
    await Promise.race([this.#ended.promise, Bun.sleep(ms)]);
  }
}

interface Session {
  readonly handle: Query;
  readonly input: InputStream;
  /** Parked `canUseTool` resolvers, keyed by the SDK's `requestId`. */
  readonly permissions: Map<string, (result: PermissionResult) => void>;
  readonly turn: Turn;
  readonly pump: Promise<void>;
}

/** How long a stop waits for the turn it interrupted to end before cutting it off. */
const SETTLE_TIMEOUT_MS = 5_000;

/** And how long every session on the machine gets, together, when the daemon exits. */
const DRAIN_TIMEOUT_MS = 8_000;

/** The checkout a side quest ran in, kept until the quest is discarded. */
interface Worktree {
  path: string;
  /** The repository root the worktree was added from — where it is removed from too. */
  root: string;
}

/** Where a side quest's worktrees live, relative to the repo they branch off. */
const WORKTREE_DIR = '.cockpit-worktrees';

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
  /** Outlives its session: a discard can arrive after the query already ended. */
  readonly #worktrees = new Map<string, Worktree>();
  /** One chain per instance, so envelopes about it are handled in arrival order. */
  readonly #queues = new Map<string, Promise<void>>();

  /**
   * Re-pointed at each hub connection. Frames produced while the hub is away are
   * dropped; the hub replays what a session is still blocked on by calling
   * `control reinitialize` after it reconnects.
   */
  sink: FrameSink = () => {};

  /**
   * Fire-and-forget: the socket callback has nowhere to put a rejection. Queued
   * per instance because a `send` that overtakes the `spawn` it follows finds no
   * session, and a spawn is slow whenever it has a worktree to cut first.
   */
  dispatch(envelope: Envelope): void {
    const key = envelope.instanceId ?? '';
    const queue = (this.#queues.get(key) ?? Promise.resolve())
      .then(() => this.#route(envelope))
      .catch((error: unknown) => {
        warn(`${envelope.verb} failed: ${error}`);
      });
    this.#queues.set(key, queue);
    void queue.then(() => {
      if (this.#queues.get(key) === queue) this.#queues.delete(key);
    });
  }

  /** The sessions running right now — what `register` reconciles the hub against. */
  get instanceIds(): string[] {
    return [...this.#sessions.keys()];
  }

  /**
   * Ends every session, so the daemon's scope closing leaves no child processes.
   * Each stop settles its own turn first; the drain as a whole is bounded too,
   * because a machine going down cannot wait on a CLI that will not answer.
   */
  async shutdown(): Promise<void> {
    const stops = [...this.#sessions.keys()].map((instanceId) => this.#stop({ instanceId }));
    await Promise.race([Promise.allSettled(stops), Bun.sleep(DRAIN_TIMEOUT_MS)]);
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
      case 'fs':
        return this.#fs(envelope.payload as FsPayload);
      default:
        return Promise.resolve();
    }
  }

  async #spawn({
    instanceId,
    cwd,
    options,
    permissionMode,
    scratch,
    requestId: ack,
  }: SpawnPayload): Promise<void> {
    try {
      let workdir = expandHome(cwd);
      // Checked here rather than left to the SDK: a query() started in a missing
      // directory fails as "binary exists but failed to launch", which names
      // neither the directory nor the reason.
      if (!(await isDirectory(workdir))) {
        throw new Error(`working directory does not exist: ${workdir}`);
      }
      // A relaunch stays in the checkout the side quest has been working in —
      // cutting a second one would strand whatever it has done so far.
      const cut = this.#worktrees.get(instanceId);
      if (cut) workdir = cut.path;
      else if (scratch?.worktree) {
        workdir = await this.#addWorktree(instanceId, expandHome(scratch.baseCwd ?? cwd));
      }

      // A spawn for an instance that is already running is a relaunch: some
      // options can only be chosen at launch — `bypassPermissions` is the one
      // the dashboard offers — so the process is replaced under the same id.
      // Settled first, or the transcript the new process reads back ends in a
      // turn that never finished.
      const running = this.#sessions.get(instanceId);
      if (running) {
        this.#sessions.delete(instanceId);
        await this.#settleAndClose(running);
      }

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
          ...(permissionMode && { permissionMode }),
          // The SDK will not bypass permissions unless it is asked twice over.
          ...(permissionMode === 'bypassPermissions' && {
            allowDangerouslySkipPermissions: true,
          }),
          cwd: workdir,
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

      const turn = new Turn();
      const session: Session = {
        handle,
        input,
        permissions,
        turn,
        pump: this.#pump(instanceId, handle, turn),
      };
      this.#sessions.set(instanceId, session);
      // The session is in place. Worth saying out loud for a relaunch, whose
      // caller has nothing else to wait on: the SDK holds the process back until
      // the session is given work, so no frame of its own means it is up.
      if (ack) this.sink({ kind: 'control_result', instanceId, requestId: ack, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ack) this.sink({ kind: 'control_result', instanceId, requestId: ack, ok: false, error: message });
      this.#fail(instanceId, error);
    }
  }

  async #pump(instanceId: string, handle: Query, turn: Turn): Promise<void> {
    try {
      for await (const message of handle) {
        if (message.type === 'result') turn.end();
        this.sink({ kind: 'sdk', instanceId, message });
      }
    } catch (error) {
      warn(`session ${instanceId} pump stopped: ${error}`);
      // A deliberate stop drops the session before it closes the handle, so an
      // error after that is the teardown, not a session that died on its own.
      if (this.#sessions.has(instanceId)) this.#fail(instanceId, error);
    } finally {
      this.#sessions.delete(instanceId);
    }
  }

  /**
   * A session that never started, or stopped without being asked to. The frame
   * is what a live dashboard renders; the hub reads the same one to mark the
   * instance dead, so a tab that opens later still learns why.
   */
  #fail(instanceId: string, error: unknown): void {
    this.sink({
      kind: 'error',
      instanceId,
      verb: 'spawn',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  async #send({ instanceId, message }: SendPayload): Promise<void> {
    const session = this.#session(instanceId);
    session.turn.start();
    session.input.push(message);
  }

  /**
   * Ends a session's query without cutting a turn in half: unblock it, ask it to
   * stop, then give the turn it is in the time to end on its own. Bounded — a
   * CLI that never answers must not hold a stop, or a relaunch behind it, open.
   */
  async #settleAndClose(session: Session): Promise<void> {
    session.input.end();
    // Unblock anything parked on a permission prompt, or the loop never ends.
    for (const resolve of session.permissions.values()) {
      resolve({ behavior: 'deny', message: 'session stopped' });
    }
    session.permissions.clear();

    await session.handle.interrupt().catch(() => {});
    await session.turn.settle(SETTLE_TIMEOUT_MS);
    session.handle.close();
    await session.pump;
  }

  async #stop({ instanceId, discard, requestId }: StopPayload): Promise<void> {
    const session = this.#sessions.get(instanceId);
    if (session) {
      this.#sessions.delete(instanceId);
      await this.#settleAndClose(session);
    }
    if (!discard) return;

    // Discarding is answered like a control call: the dashboard that asked waits
    // on `requestId` to learn whether the worktree really went away.
    try {
      await this.#removeWorktree(instanceId);
      if (requestId) this.sink({ kind: 'control_result', instanceId, requestId, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId)
        this.sink({ kind: 'control_result', instanceId, requestId, ok: false, error: message });
      else this.sink({ kind: 'error', instanceId, verb: 'stop', message });
    }
  }

  /**
   * A detached worktree of `baseCwd` for a side quest to work in — detached so a
   * scratch session can never move the branch the mainline session is sitting on.
   */
  async #addWorktree(instanceId: string, baseCwd: string): Promise<string> {
    const repository = await Bun.$`git -C ${baseCwd} rev-parse --show-toplevel`.quiet().nothrow();
    if (repository.exitCode !== 0) {
      throw new Error(`a worktree side quest needs a git repository, and ${baseCwd} is not one`);
    }

    const root = repository.text().trim();
    const path = `${root}/${WORKTREE_DIR}/${instanceId.slice(0, 8)}`;
    await Bun.$`mkdir -p ${`${root}/${WORKTREE_DIR}`}`.quiet();
    const added = await Bun.$`git -C ${root} worktree add ${path} --detach`.quiet().nothrow();
    if (added.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${added.stderr.toString().trim()}`);
    }

    this.#worktrees.set(instanceId, { path, root });
    return path;
  }

  /** Throws away a side quest's checkout; a session that had none is a no-op. */
  async #removeWorktree(instanceId: string): Promise<void> {
    const worktree = this.#worktrees.get(instanceId);
    if (!worktree) return;
    this.#worktrees.delete(instanceId);

    const removed =
      await Bun.$`git -C ${worktree.root} worktree remove --force ${worktree.path}`.quiet().nothrow();
    if (removed.exitCode !== 0) {
      throw new Error(`git worktree remove failed: ${removed.stderr.toString().trim()}`);
    }
    await Bun.$`git -C ${worktree.root} worktree prune`.quiet().nothrow();
  }

  /** Answered like a control call, but about the machine's files, not a session. */
  async #fs(payload: FsPayload): Promise<void> {
    const { requestId } = payload;
    try {
      this.sink({ kind: 'control_result', requestId, ok: true, result: await runFs(payload) });
    } catch (error) {
      this.sink({
        kind: 'control_result',
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

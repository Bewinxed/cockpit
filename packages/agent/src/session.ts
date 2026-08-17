/**
 * Owns every live session on this machine — across every harness — and pumps
 * their neutral frames at the hub. Harness-agnostic: the git worktrees, side
 * quests, busy tracking, bootstrap clone and the routing live here; the actual
 * sessions are {@link HarnessSession}s produced by the adapters in
 * `./harnesses`. Nothing here interprets a harness's own event — frames go out
 * as neutral messages, with the harness's `raw` event riding along.
 */
import type {
  ControlPayload,
  Envelope,
  FleetConfig,
  FleetSyncReport,
  FramePayload,
  FsPayload,
  HarnessKind,
  NeutralSessionInfo,
  PermissionResult,
  RepoInfo,
  ReposResult,
  SendPayload,
  SpawnPayload,
  StopPayload,
} from '@cockpit/core';
import {
  AGENT_BUSY,
  COCKPIT_SCRATCH_TAG,
  FLEET_STATUS,
  FLEET_SYNC,
  repoPath,
  RESOLVE_PERMISSION,
  UPDATE_COCKPIT,
} from '@cockpit/core';
import type { Harness, HarnessContext, HarnessSession } from './harness';
import { harness as harnessOf, harnesses } from './harnesses';
import { installTool, probeTools } from './tools';
import { expandHome, runFs } from './fs';
import { updateCheckout, type UpdateOptions } from './update';
import { Effect } from 'effect';
import { stat } from 'node:fs/promises';

/** The frames an agent has to send. The hub's own registry news is not one. */
export type FrameSink = (frame: Exclude<FramePayload, { kind: 'instances' }>) => void;

const warn = (message: string): void => {
  Effect.runFork(Effect.logWarning(message));
};

const isDirectory = async (path: string): Promise<boolean> => {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
};

/** How long a stop waits for the turn it interrupted to end before cutting it off. */
const DRAIN_TIMEOUT_MS = 8_000;

/** The checkout a side quest ran in, kept until the quest is discarded. */
interface Worktree {
  path: string;
  root: string;
}

/** Where a side quest's worktrees live, relative to the repo they branch off. */
const WORKTREE_DIR = '.cockpit-worktrees';

/**
 * A side quest's transcript, kept out of the catalogs the rails read. The tag
 * is the whole test there, so the harness that owns the session applies it.
 */
interface Quest {
  dir: string;
  harness: HarnessKind;
  sessionId?: string;
  /** Whether the tag question is closed: applied, or moved by whoever kept it. */
  tagged?: boolean;
}

/** A control reached by name through `control`. */
type ControlMethod = (...args: unknown[]) => unknown;

/** How many repositories the bootstrap picker asks a machine for. */
const REPO_LIST_LIMIT = 100;

/** The end of a command's output: enough to name what happened, not a wall of it. */
const TAIL_LINES = 4;

const tail = (output: string): string =>
  output.trim().split('\n').slice(-TAIL_LINES).join('\n');

/** Whether the GitHub CLI is here at all — its absence is an answer, not a failure. */
const ghAvailable = async (): Promise<boolean> =>
  (await Bun.$`gh --version`.quiet().nothrow()).exitCode === 0;

/**
 * The repositories `gh` can see from this machine. Whoever is logged in there
 * decides what that is — the private ones included, which is the point of
 * asking the machine rather than GitHub.
 */
const listRepos = async (): Promise<ReposResult> => {
  if (!(await ghAvailable())) return { error: 'gh-missing' };
  const auth = await Bun.$`gh auth status`.quiet().nothrow();
  if (auth.exitCode !== 0) return { error: 'gh-unauthenticated' };

  const listed =
    await Bun.$`gh repo list --json nameWithOwner,visibility,updatedAt,description --limit ${REPO_LIST_LIMIT}`
      .quiet()
      .nothrow();
  if (listed.exitCode !== 0) {
    throw new Error(`gh repo list failed: ${tail(listed.stderr.toString())}`);
  }
  return listed.json() as RepoInfo[];
};

/** The same repository, under whichever of its names, is the same repository. */
const repoIdentity = (repo: string): string => repoPath(repo).toLowerCase();

/** What a clone of it is called on disk — git's own default. */
const repoLeaf = (repo: string): string => repoPath(repo).split('/').pop() ?? '';

/** A reference git can clone on its own, without `gh` resolving it first. */
const isRepoUrl = (repo: string): boolean =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(repo.trim()) || /^[^/]+@[^:]+:/.test(repo.trim());

/** The machine-scoped session-catalog controls, routed to a harness. */
const CATALOG_METHODS = new Set([
  'listSessions',
  'getSessionInfo',
  'getSessionMessages',
  'renameSession',
  'tagSession',
  'deleteSession',
]);

/**
 * The catalog's directory argument, whichever convention carried it: new
 * callers send a plain string, while dashboards and pre-rework callers send
 * the SDK's `{ dir }` options object. A mixed-age fleet speaks both, so both
 * are heard; anything else means no directory was named.
 */
const dirOf = (arg: unknown): string | undefined => {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'object' && arg !== null) {
    const dir = (arg as { dir?: unknown }).dir;
    if (typeof dir === 'string') return dir;
  }
  return undefined;
};

export const resumableSessions = async (): Promise<string[] | undefined> => {
  const ids: string[] = [];
  let sawAny = false;
  for (const adapter of harnesses()) {
    try {
      for (const info of await adapter.listSessions()) ids.push(info.sessionId);
      sawAny = true;
    } catch (error) {
      warn(`could not read ${adapter.kind}'s session catalog: ${error}`);
    }
  }
  return sawAny ? ids : undefined;
};

/**
 * Owns every live session on this machine and pumps their messages at the hub.
 */
export class SessionSupervisor {
  readonly #sessions = new Map<string, HarnessSession>();
  /** Outlives its session: a discard can arrive after the query already ended. */
  readonly #worktrees = new Map<string, Worktree>();
  /** Side quests running here, by instance — for the same reason, same lifetime. */
  readonly #quests = new Map<string, Quest>();
  /** One chain per instance, so envelopes about it are handled in arrival order. */
  readonly #queues = new Map<string, Promise<void>>();
  /** The sessions with a turn in flight — from the `send` that starts one until the turn ends. */
  readonly #busy = new Set<string>();

  readonly #daemonFunctions: Record<string, ControlMethod> = {
    [AGENT_BUSY]: () => ({ busy: this.#busy.size, instances: [...this.#busy] }),
    [UPDATE_COCKPIT]: (options) =>
      updateCheckout({ ...(options as UpdateOptions), busy: this.#busy.size }),
  };

  /**
   * Re-pointed at each hub connection. Frames produced while the hub is away are
   * dropped; the hub replays what a session is still blocked on by calling
   * `control reinitialize` after it reconnects.
   */
  sink: FrameSink = () => {};
  /** Puts an arbitrary envelope on the daemon's hub socket (hand-offs). */
  emit: (envelope: Envelope) => void = () => {};
  /** Re-registers this machine, so a changed auth state reaches the fleet. */
  reannounce: () => void = () => {};

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

  #adapter(kind: HarnessKind | undefined): Harness {
    const adapter = harnessOf(kind ?? 'claude');
    if (!adapter) throw new Error(`no harness adapter for ${kind ?? 'claude'}`);
    return adapter;
  }

  async #spawn(payload: SpawnPayload): Promise<void> {
    const { instanceId, cwd, harness: kind, scratch, bootstrap, requestId: ack } = payload;
    const adapter = this.#adapter(kind);
    try {
      let workdir = bootstrap ? await this.#clone(bootstrap) : expandHome(cwd);
      if (!(await isDirectory(workdir))) {
        throw new Error(`working directory does not exist: ${workdir}`);
      }
      // A relaunch stays in the checkout the side quest has been working in.
      const cut = this.#worktrees.get(instanceId);
      if (cut) workdir = cut.path;
      else if (scratch?.worktree) {
        workdir = await this.#addWorktree(instanceId, expandHome(scratch.baseCwd ?? cwd));
      }

      // Each spawn says for itself whether this is a side quest, so a relaunch
      // of one that has since been kept stops being tagged as scratch.
      if (scratch) {
        this.#quests.set(instanceId, {
          ...this.#quests.get(instanceId),
          dir: workdir,
          harness: adapter.kind,
        });
      } else this.#quests.delete(instanceId);

      // A spawn for an instance already running is a relaunch: replace the
      // process under the same id, settling the old one first.
      const running = this.#sessions.get(instanceId);
      if (running) {
        this.#sessions.delete(instanceId);
        await running.stop();
      }

      let spawned: HarnessSession | null = null;
      const ctx: HarnessContext = {
        instanceId,
        cwd: workdir,
        frame: (message) => {
          if (message.type === 'result') this.#tagQuest(instanceId, adapter);
          this.sink({ kind: 'frame', instanceId, harness: adapter.kind, message });
        },
        permission: (request) =>
          this.sink({ kind: 'permission_request', instanceId, harness: adapter.kind, ...request }),
        busy: (active) => (active ? this.#busy.add(instanceId) : this.#busy.delete(instanceId)),
        session: (sessionId) => this.#noteQuestSession(instanceId, sessionId, adapter.kind),
        failed: (error) => this.#fail(instanceId, error),
        emit: (envelope) => this.emit(envelope),
        closed: () => {
          if (spawned && this.#sessions.get(instanceId) === spawned) {
            this.#sessions.delete(instanceId);
            this.#busy.delete(instanceId);
          }
        },
      };

      const session = await adapter.spawn(payload, ctx);
      spawned = session;
      this.#sessions.set(instanceId, session);
      // The session is in place. Worth saying out loud for a relaunch, whose
      // caller has nothing else to wait on.
      if (ack) this.sink({ kind: 'control_result', instanceId, requestId: ack, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ack) this.sink({ kind: 'control_result', instanceId, requestId: ack, ok: false, error: message });
      this.#fail(instanceId, error);
    }
  }

  /** The harness session a side quest turned out to be writing, from its init frame. */
  #noteQuestSession(instanceId: string, sessionId: string, harness: HarnessKind): void {
    const quest = this.#quests.get(instanceId);
    if (!quest || quest.sessionId === sessionId) return;
    quest.sessionId = sessionId;
    quest.harness = harness;
    quest.tagged = false;
  }

  /**
   * Keeps a side quest out of the catalogs the rails read. Applied at the end of
   * the first turn rather than at init, because until the session has said
   * something there may be no transcript for a tag to live on. Fire-and-forget,
   * tried again next turn if it does not land.
   */
  #tagQuest(instanceId: string, adapter: Harness): void {
    const quest = this.#quests.get(instanceId);
    if (!quest?.sessionId || quest.tagged) return;
    const { sessionId, dir } = quest;
    quest.tagged = true;
    void adapter.tagSession(sessionId, COCKPIT_SCRATCH_TAG, dir).catch((error: unknown) => {
      quest.tagged = false;
      warn(`could not tag side quest ${sessionId}: ${error}`);
    });
  }

  /** A session whose tag someone has just set by hand is no longer ours to set. */
  #closeTagging(sessionId: unknown): void {
    for (const quest of this.#quests.values()) {
      if (quest.sessionId === sessionId) quest.tagged = true;
    }
  }

  /** A session that never started, or stopped without being asked to. */
  #fail(instanceId: string, error: unknown): void {
    this.sink({
      kind: 'error',
      instanceId,
      verb: 'spawn',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  async #send({ instanceId, message, attachments, images, urgent }: SendPayload): Promise<void> {
    this.#session(instanceId).send(message, { attachments, images, urgent });
  }

  async #stop({ instanceId, discard, requestId }: StopPayload): Promise<void> {
    const session = this.#sessions.get(instanceId);
    if (session) {
      this.#sessions.delete(instanceId);
      await session.stop();
    }
    if (!discard) return;

    try {
      await this.#removeWorktree(instanceId);
      await this.#removeQuestSession(instanceId);
      if (requestId) this.sink({ kind: 'control_result', instanceId, requestId, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId)
        this.sink({ kind: 'control_result', instanceId, requestId, ok: false, error: message });
      else this.sink({ kind: 'error', instanceId, verb: 'stop', message });
    }
  }

  async #clone({ repo, baseDir }: NonNullable<SpawnPayload['bootstrap']>): Promise<string> {
    const parent = expandHome(baseDir).replace(/(?!^)\/+$/, '');
    const target = `${parent}/${repoLeaf(repo)}`;

    if (await isDirectory(target)) {
      const origin = await Bun.$`git -C ${target} remote get-url origin`.quiet().nothrow();
      if (origin.exitCode !== 0 || repoIdentity(origin.text()) !== repoIdentity(repo)) {
        throw new Error(`bootstrap target exists and is not the requested repo: ${target}`);
      }
      return target;
    }

    const gh = await ghAvailable();
    if (!gh && !isRepoUrl(repo)) {
      throw new Error(`cloning ${repo} needs the GitHub CLI, and gh is not installed on this machine`);
    }

    await Bun.$`mkdir -p ${parent}`.quiet();
    const cloned = gh
      ? await Bun.$`gh repo clone ${repo} ${target} -- --single-branch`.quiet().nothrow()
      : await Bun.$`git clone --single-branch ${repo} ${target}`.quiet().nothrow();
    if (cloned.exitCode !== 0) {
      throw new Error(`could not clone ${repo}: ${tail(cloned.stderr.toString())}`);
    }
    return target;
  }

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

  /** Discarding a side quest throws its transcript away too. */
  async #removeQuestSession(instanceId: string): Promise<void> {
    const quest = this.#quests.get(instanceId);
    this.#quests.delete(instanceId);
    if (!quest?.sessionId) return;
    await harnessOf(quest.harness)?.deleteSession(quest.sessionId, quest.dir);
  }

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

  async #control({ instanceId, harness: kind, requestId, method, args = [] }: ControlPayload): Promise<void> {
    try {
      const result = await this.#call(instanceId, kind, method, args);
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

  /** The stored sessions of every harness, merged and newest-first. */
  async #listSessions(args: unknown[]): Promise<NeutralSessionInfo[]> {    const options = (args[0] ?? {}) as { limit?: number; dir?: string };
    const all: NeutralSessionInfo[] = [];
    for (const adapter of harnesses()) {
      try {
        all.push(...(await adapter.listSessions(options.dir)));
      } catch (error) {
        warn(`listSessions on ${adapter.kind} failed: ${error}`);
      }
    }
    all.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
    return options.limit ? all.slice(0, options.limit) : all;
  }

  /** Converges the fleet across every harness that has a profile, merged into one report. */
  async #syncFleet(
    config: FleetConfig | undefined,
    which: 'syncFleet' | 'fleetStatus'
  ): Promise<FleetSyncReport> {
    const mcp: FleetSyncReport['mcp'] = {};
    const marketplaces: FleetSyncReport['marketplaces'] = {};
    const plugins: FleetSyncReport['plugins'] = {};
    const skills: Record<string, import('@cockpit/core').FleetItemState> = {};
    let memory: FleetSyncReport['memory'];
    for (const adapter of harnesses()) {
      const apply = which === 'syncFleet' ? adapter.syncFleet : adapter.fleetStatus;
      if (!apply) continue;
      try {
        const report = which === 'syncFleet' ? await adapter.syncFleet!(config as FleetConfig) : await adapter.fleetStatus!();
        Object.assign(mcp, report.mcp);
        Object.assign(marketplaces, report.marketplaces);
        Object.assign(plugins, report.plugins);
        Object.assign(skills, report.skills ?? {});
        if (report.memory) memory = report.memory;
      } catch (error) {
        warn(`${which} on ${adapter.kind} failed: ${error}`);
      }
    }
    return { mcp, marketplaces, plugins, skills, ...(memory ? { memory } : {}), at: Date.now() };
  }

  async #call(
    instanceId: string | undefined,
    kind: HarnessKind | undefined,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    if (instanceId === undefined) {
      const daemonFn = this.#daemonFunctions[method];
      if (daemonFn) return await daemonFn(...args);

      if (method === 'listRepos') return await listRepos();
      if (method === 'listTools') return await probeTools();
      if (method === 'installTool') return await installTool(args[0] as string, args[1] as string | undefined);

      // Fleet sync applies to every harness that has a machine profile: the hub
      // sends one desired state, and each harness converges the parts it
      // understands onto its own files. Reports merge into one machine word.
      if (method === FLEET_SYNC) {
        return await this.#syncFleet(args[0] as FleetConfig, 'syncFleet');
      }
      if (method === FLEET_STATUS) {
        return await this.#syncFleet(undefined, 'fleetStatus');
      }

      if (method === 'listSessions') return await this.#listSessions(args);
      if (CATALOG_METHODS.has(method)) {
        const adapter = this.#adapter(kind);
        switch (method) {
          case 'getSessionInfo':
            return await adapter.getSessionInfo(args[0] as string, dirOf(args[1]));
          case 'getSessionMessages':
            return await adapter.getSessionMessages(args[0] as string, dirOf(args[1]));
          case 'renameSession':
            return await adapter.renameSession(args[0] as string, args[1] as string, dirOf(args[2]));
          case 'tagSession':
            await adapter.tagSession(args[0] as string, (args[1] as string) ?? null, dirOf(args[2]));
            this.#closeTagging(args[0]);
            return undefined;
          case 'deleteSession':
            return await adapter.deleteSession(args[0] as string, dirOf(args[1]));
        }
      }

      // A machine-scoped control only one harness knows: try the named harness,
      // then every harness, until one claims it.
      if (kind) {
        const adapter = this.#adapter(kind);
        if (adapter.machine) {
          const answer = await adapter.machine(method, args);
          if (answer !== undefined) return answer;
        }
      }
      for (const adapter of harnesses()) {
        if (adapter.machine) {
          const answer = await adapter.machine(method, args);
          if (answer !== undefined) return answer;
        }
      }
      throw new Error(`unknown session function: ${method}`);
    }

    if (method === RESOLVE_PERMISSION) {
      this.#session(instanceId).resolvePermission(args[0] as string, args[1] as PermissionResult);
      return undefined;
    }
    return await this.#session(instanceId).control(method, args);
  }

  #session(instanceId: string): HarnessSession {
    const session = this.#sessions.get(instanceId);
    if (!session) throw new Error(`no session ${instanceId}`);
    return session;
  }
}

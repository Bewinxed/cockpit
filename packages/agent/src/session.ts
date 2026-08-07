import {
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  tagSession,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ControlPayload,
  Envelope,
  FramePayload,
  FsPayload,
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
  MARKETPLACE_CATALOG,
  READ_MEMORY_FILE,
  repoPath,
  RESOLVE_PERMISSION,
  UPDATE_COCKPIT,
} from '@cockpit/core';
import { fleetStatus, marketplaceCatalog, readMemoryFile, syncFleetConfig } from './fleet';
import { handoffServer } from './handoff';
import { probeAuth, unlockKeychain } from './auth';
import { beginLogin, clearCredentials, completeLogin, exportCredentials, importCredentials } from './login';
import { Effect } from 'effect';
import { stat } from 'node:fs/promises';
import { expandHome, runFs } from './fs';
import { installTool, probeTools } from './tools';
import { updateCheckout, type UpdateOptions } from './update';

/** The frames an agent has to send. The hub's own registry news is not one. */
export type FrameSink = (frame: Exclude<FramePayload, { kind: 'instances' }>) => void;

const warn = (message: string): void => {
  Effect.runFork(Effect.logWarning(message));
};

const isDirectory = async (path: string): Promise<boolean> => {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
};

/** The blocks a user turn is made of, taken from the SDK rather than re-modelled. */
type ContentBlock = Extract<SDKUserMessage['message']['content'], unknown[]>[number];
type Base64Source = Extract<Extract<ContentBlock, { type: 'image' }>['source'], { type: 'base64' }>;

/**
 * A turn's images and pasted text folded into the message the SDK iterates.
 * Images lead, so the model has seen them by the time it reads what was said
 * about them, and each paste is tagged: a wall of text arriving mid-sentence
 * reads as the user's own words otherwise. A turn carrying neither stays the
 * plain string it came as.
 */
function withExtras(
  message: SDKUserMessage,
  attachments: SendPayload['attachments'],
  images: SendPayload['images']
): SDKUserMessage {
  if (!attachments?.length && !images?.length) return message;

  const typed = typeof message.message.content === 'string' ? message.message.content : '';
  const pasted = (attachments ?? [])
    .map(({ name, content }) => `\n\n<pasted-text name="${name}">\n${content}\n</pasted-text>`)
    .join('');

  const content: ContentBlock[] = [
    ...(images ?? []).map(({ mediaType, data }) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: mediaType as Base64Source['media_type'], data },
    })),
    { type: 'text' as const, text: typed + pasted },
  ];

  return { ...message, message: { ...message.message, content } };
}

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

/**
 * The SDK session a side quest is writing, once its init frame names one. Kept
 * so the tag can be applied to it and so a discard can delete it — both need
 * the directory too, which is how the SDK finds a session's transcript.
 */
interface Quest {
  dir: string;
  sessionId?: string;
  /**
   * Whether the tag question is closed: applied here, or moved by whoever kept
   * the quest. Either way the agent is done deciding what this session wears.
   */
  tagged?: boolean;
}

/** A `Query` method or SDK session function reached by name through `control`. */
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

/**
 * Updates the Claude Code the machine's sessions run on, and answers with what
 * it said about the version it landed on. Sessions already running keep the CLI
 * they launched with, so this only ever changes what the next spawn gets.
 */
const updateClaudeCode = async (): Promise<string> => {
  const updated = await Bun.$`claude update`.quiet().nothrow();
  const said = tail(updated.stdout.toString()) || tail(updated.stderr.toString());
  if (updated.exitCode !== 0) {
    throw new Error(said || `claude update exited ${updated.exitCode}`);
  }
  return said;
};

/** The same repository, under whichever of its names, is the same repository. */
const repoIdentity = (repo: string): string => repoPath(repo).toLowerCase();

/** What a clone of it is called on disk — git's own default. */
const repoLeaf = (repo: string): string => repoPath(repo).split('/').pop() ?? '';

/** A reference git can clone on its own, without `gh` resolving it first. */
const isRepoUrl = (repo: string): boolean =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(repo.trim()) || /^[^/]+@[^:]+:/.test(repo.trim());

/**
 * What a machine-scoped `control` reaches: the SDK's session catalog — module-level
 * functions rather than `Query` methods, so it is readable with nothing running on
 * this machine — the machine's repositories, for a session that starts by
 * cloning one, and its Claude Code install.
 */
const SESSION_FUNCTIONS = {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  tagSession,
  deleteSession,
  listRepos,
  updateClaudeCode,
  // The machine's workflow CLIs (NEW.md §10). Machine-scoped for the same
  // reason the rest of this block is: a tool is a property of the machine, and
  // no session has to be running for one to be asked about or installed.
  listTools: probeTools,
  installTool,
  // And the fleet's MCP servers and skill plugins (NEW.md §11), for the same
  // reason again: what a machine's Claude Code can reach is a property of the
  // machine, and the sync that converges it runs with nothing else going on.
  [FLEET_SYNC]: syncFleetConfig,
  [FLEET_STATUS]: fleetStatus,
  [MARKETPLACE_CATALOG]: marketplaceCatalog,
  // The machine's own user CLAUDE.md, for the hub to adopt as the fleet's.
  [READ_MEMORY_FILE]: readMemoryFile,
  // Machine-scoped, not session-scoped: a locked keychain is a property of the
  // machine, and the session that noticed it cannot answer anything until it
  // is fixed. Reached over the tunnel, which is the point — nobody should have
  // to open a terminal on the other machine to get their fleet working again.
  // Logging a machine in from the dashboard is the fix; unlocking its keychain
  // is the workaround for a machine that is already logged in and cannot reach
  // what it saved. Both are here, and neither needs a terminal on that machine.
  beginLogin,
  completeLogin,
  // One account, one login: a healthy machine hands its credential to a
  // stranded one over the tunnel, instead of every machine doing OAuth alone.
  clearCredentials,
  exportCredentials,
  importCredentials,
  unlockKeychain,
  probeAuth,
} as Record<string, ControlMethod | undefined>;

/**
 * The SDK sessions this machine could resume — every transcript a
 * `query({ resume })` would find. Read at register, so the hub can tell a
 * session that merely lost its process from one whose conversation went with
 * it. A catalog that will not be read answers with nothing rather than
 * declaring the machine empty, which would condemn every row it left behind.
 */
export const resumableSessions = async (): Promise<string[] | undefined> => {
  try {
    return (await listSessions()).map((info) => info.sessionId);
  } catch (error) {
    warn(`could not read the session catalog: ${error}`);
    return undefined;
  }
};

/**
 * Owns every live SDK session on this machine and pumps their messages at the
 * hub. Nothing here interprets an SDK message — frames go out verbatim.
 */
export class SessionSupervisor {
  readonly #sessions = new Map<string, Session>();
  /** Outlives its session: a discard can arrive after the query already ended. */
  readonly #worktrees = new Map<string, Worktree>();
  /** Side quests running here, by instance — for the same reason, same lifetime. */
  readonly #quests = new Map<string, Quest>();
  /** One chain per instance, so envelopes about it are handled in arrival order. */
  readonly #queues = new Map<string, Promise<void>>();
  /**
   * The sessions with a turn in flight — from the `send` that starts one until
   * the `result` frame that ends it. What tells a restart it would be cutting
   * work in half, and the only thing on the machine that knows.
   */
  readonly #busy = new Set<string>();

  /**
   * The machine-scoped controls that need this daemon rather than this machine;
   * {@link SESSION_FUNCTIONS} is the rest of them, and needs no instance to
   * answer from.
   */
  readonly #daemonFunctions: Record<string, ControlMethod> = {
    [AGENT_BUSY]: () => ({ busy: this.#busy.size, instances: [...this.#busy] }),
    // The busy count is this daemon's own word, folded in after whatever the
    // caller asked for: an update must not be able to talk itself into
    // restarting a machine mid-turn.
    [UPDATE_COCKPIT]: (options) =>
      updateCheckout({ ...(options as UpdateOptions), busy: this.#busy.size }),
  };

  /**
   * Re-pointed at each hub connection. Frames produced while the hub is away are
   * dropped; the hub replays what a session is still blocked on by calling
   * `control reinitialize` after it reconnects.
   */
  sink: FrameSink = () => {};
  /**
   * Puts an arbitrary envelope on the daemon's hub socket. The frame sink only
   * carries `frames`, and a hand-off is a `send` addressed at another machine's
   * session — a different verb with a different destination.
   */
  emit: (envelope: Envelope) => void = () => {};
  /** Re-registers this machine, so a changed auth state reaches the fleet. */
  reannounce: () => void = () => {};

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
    model,
    scratch,
    bootstrap,
    requestId: ack,
  }: SpawnPayload): Promise<void> {
    try {
      let workdir = bootstrap ? await this.#clone(bootstrap) : expandHome(cwd);
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

      // Each spawn says for itself whether this is a side quest, so a relaunch
      // of one that has since been kept stops being tagged as scratch.
      if (scratch) this.#quests.set(instanceId, { ...this.#quests.get(instanceId), dir: workdir });
      else this.#quests.delete(instanceId);

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
          // The fleet, as tools. Merged rather than assigned, so a spawn that
          // brings its own servers keeps them.
          mcpServers: {
            ...(options?.mcpServers ?? {}),
            outpost: handoffServer({
              instanceId,
              cwd: workdir,
              emit: (envelope) => this.emit(envelope),
            }),
          },
          ...(permissionMode && { permissionMode }),
          ...(model && { model }),
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
        if (message.type === 'system' && message.subtype === 'init') {
          this.#noteQuest(instanceId, message);
        }
        if (message.type === 'result') {
          turn.end();
          this.#busy.delete(instanceId);
          this.#tagQuest(instanceId);
        }
        this.sink({ kind: 'sdk', instanceId, message });
      }
    } catch (error) {
      warn(`session ${instanceId} pump stopped: ${error}`);
      // A deliberate stop drops the session before it closes the handle, so an
      // error after that is the teardown, not a session that died on its own.
      if (this.#sessions.has(instanceId)) this.#fail(instanceId, error);
    } finally {
      this.#sessions.delete(instanceId);
      // However the session ended — stopped, relaunched, or died of something —
      // it is carrying nothing now, and a machine that says otherwise is one
      // nothing will ever restart.
      this.#busy.delete(instanceId);
    }
  }

  /** The SDK session a side quest turned out to be writing, from its init frame. */
  #noteQuest(instanceId: string, init: Extract<SDKMessage, { subtype: 'init' }>): void {
    const quest = this.#quests.get(instanceId);
    // Init is re-announced every turn; only a session that is new to us is news.
    if (!quest || quest.sessionId === init.session_id) return;
    quest.sessionId = init.session_id;
    quest.dir = init.cwd;
    quest.tagged = false;
  }

  /**
   * Keeps a side quest out of the catalogs the rails read. The tag is the whole
   * test there — hiding by directory instead would hide the mainline sessions a
   * user legitimately runs in the same checkout.
   *
   * Applied at the end of a turn rather than at init, because until the session
   * has said something the SDK has written no transcript for a tag to live on.
   * Fire-and-forget, and tried again next turn if it does not land: the session
   * is running either way, and the cost of failing is a quest that shows up in
   * the history, not a broken session.
   */
  #tagQuest(instanceId: string): void {
    const quest = this.#quests.get(instanceId);
    if (!quest?.sessionId || quest.tagged) return;
    const { sessionId, dir } = quest;
    quest.tagged = true;
    void tagSession(sessionId, COCKPIT_SCRATCH_TAG, { dir }).catch((error: unknown) => {
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

  async #send({ instanceId, message, attachments, images }: SendPayload): Promise<void> {
    const session = this.#session(instanceId);
    const origin = (message as { origin?: { kind?: string } }).origin;
    const queued = (message as { shouldQuery?: boolean }).shouldQuery === false;

    // "Queued, so it is picked up at the end of the current turn" is only true
    // if there *is* a current turn. Handed to a session sitting idle, a queued
    // message waits for a turn that never comes — it lands in the transcript
    // and is never answered, which is the one outcome a hand-off must not have.
    // Busy: stay out of the way. Idle: this is the turn.
    const wake = queued && !session.turn.busy;
    // A queued hand-off appends and is answered whenever the session next takes
    // a turn, so it is not one; the send that wakes an idle session is.
    if (!queued || wake) this.#busy.add(instanceId);
    const outgoing = wake
      ? ({ ...message, shouldQuery: undefined } as typeof message)
      : message;

    session.turn.start();
    session.input.push(withExtras(outgoing, attachments, images));

    // A hand-off is queued rather than asked (`shouldQuery: false`), so the SDK
    // appends it and emits nothing until the session next takes a turn — which
    // can be hours. The dashboards watching that session would show no sign of
    // it having arrived, and a hand-off nobody can see land is one nobody
    // trusts. Echoed as the frame the SDK will not send, so it appears at once.
    if (origin?.kind === 'peer') {
      this.sink({ kind: 'sdk', instanceId, message: message as never });
    }
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
      await this.#removeQuestSession(instanceId);
      if (requestId) this.sink({ kind: 'control_result', instanceId, requestId, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId)
        this.sink({ kind: 'control_result', instanceId, requestId, ok: false, error: message });
      else this.sink({ kind: 'error', instanceId, verb: 'stop', message });
    }
  }

  /**
   * The checkout a bootstrap session works in, cloned before the session exists:
   * a clone that fails is then a session that never started — a failure card
   * naming what git said, rather than a first turn spent finding out.
   *
   * Cloning the same repository into the same place twice is a no-op, so a
   * session started again from a bootstrap keeps working in what the first one
   * cloned. Anything else already sitting at the target belongs to the user, and
   * is left exactly where it is.
   */
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

    // `gh` is what resolves `owner/name` and what carries the credentials for a
    // private repository; without it only a URL can be cloned, by git alone.
    const gh = await ghAvailable();
    if (!gh && !isRepoUrl(repo)) {
      throw new Error(
        `cloning ${repo} needs the GitHub CLI, and gh is not installed on this machine`
      );
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

  /**
   * Discarding a side quest throws its transcript away too — the quest was
   * hidden from the history, and "discard" is the user saying it never
   * happened. A quest that never named a session has nothing to delete.
   */
  async #removeQuestSession(instanceId: string): Promise<void> {
    const quest = this.#quests.get(instanceId);
    this.#quests.delete(instanceId);
    if (!quest?.sessionId) return;
    await deleteSession(quest.sessionId, { dir: quest.dir });
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
      const sessionFunction = this.#daemonFunctions[method] ?? SESSION_FUNCTIONS[method];
      if (!sessionFunction) throw new Error(`unknown session function: ${method}`);
      const result = await sessionFunction(...args);
      // Keeping a quest clears its tag through here. Whoever asked has the last
      // word, or the next turn to end would quietly hide the session again.
      if (method === 'tagSession') this.#closeTagging(args[0]);
      // An unlock changes what this machine can do, and the fleet learned the
      // old answer at register. Say it again, or the rail keeps showing a
      // machine that has just been fixed as one that still needs fixing.
      if (['unlockKeychain', 'completeLogin', 'importCredentials', 'clearCredentials'].includes(method)) this.reannounce();
      return result;
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

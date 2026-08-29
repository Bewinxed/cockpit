import type {
  AuthState,
  BuildInfo,
  DeployInfo,
  Envelope,
  HarnessReport,
  HeartbeatPayload,
  SpawnPayload,
  ToolStatus,
} from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { fetchClaudeLimits } from '@cockpit/core/usage/limits';
import { Data, Duration, Effect, Fiber, Schedule } from 'effect';
import { arch, hostname, platform } from 'node:os';
import { buildInfo } from './build';
import { latestDeploy } from './deploy';
import { convergeDeniedTools, DENIED_WEB_TOOLS } from './denied-tools';
import { rediscoverHub, toWsUrl } from './discovery';
import { machineId } from './machine-id';
import { resumableSessions, SessionSupervisor } from './session';
import { probeTools } from './tools';
import { harnesses } from './harnesses';
import { UsageScanner } from './usage/scanner';

const DEFAULT_HUB_URL = `ws://localhost:${COCKPIT_HUB_PORT}/ws`;
const HEARTBEAT_INTERVAL = Duration.seconds(15);
const USAGE_INTERVAL = Duration.seconds(60);
const USAGE_FULL_REBUILD_MS = 30 * 60 * 1000;


/** How the hub identifies this machine in its registry. */
interface MachineIdentity {
  machineId: string;
  hostname: string;
  os: string;
  /**
   * Whether this daemon can reach Claude Code's credentials. It travels with the
   * identity because it is a fact about the machine, not about a session, and
   * because a machine that cannot start one should not sit in the fleet looking
   * ready to.
   */
  auth: AuthState;
}

/**
 * What `register` carries. The supervisor outlives any one connection, so a
 * register is not a promise of zero sessions — `instances` names the ones still
 * running and the hub marks every other row it calls running as unknown.
 */
export interface RegisterPayload extends MachineIdentity {
  instances: string[];
  /**
   * The sessions this machine could resume, so the rows the daemon no
   * longer carries settle as sleeping or as lost rather than all alike. Absent
   * when the catalog could not be read.
   */
  resumable?: string[];
  /**
   * What each harness adapter on this machine can do, and whether it is
   * installed and authenticated — the rail's per-harness word, and what gates
   * the fleet syncs and spawn forms.
   */
  harnesses?: HarnessReport[];
  /**
   * What the machine has of the tool catalog (NEW.md §10), so the hub can send
   * an install for whatever its policy requires and this machine lacks.
   */
  tools?: ToolStatus[];
  /**
   * The cockpit this daemon is running (NEW.md §12), as it reported at register.
   */
  build?: BuildInfo;
  /**
   * Where this machine's deployment clone stood at register (contract C8), so a
   * board that has just been handed a machine knows without waiting a beat.
   * Whatever the poller last saw — this never asks git anything itself, so a
   * daemon with no deployment watcher running simply omits it.
   */
  deploy?: DeployInfo;
}

export class ConnectionLost extends Data.TaggedError('ConnectionLost')<{
  readonly url: string;
  readonly reason: string;
}> {}

/**
 * One retry series: 1s, 2s, 4s … capped at 30s, jittered so a fleet never
 * retries in lockstep.
 *
 * A schedule carries its exponent in its own state, and that state lives for
 * exactly as long as the `Effect.retry` that stepped it. Because `attach` never
 * succeeds on its own — see {@link closed} — a single `retry` around it would be
 * ONE series for the whole life of the process: the exponent accumulates across
 * every outage the daemon ever survived, saturates past the cap within the
 * first few, and `Schedule.min` then hands back 30s forever. Measured in
 * production: the first reconnect after hours of healthy uptime cost 26–32s,
 * and every send and spawn aimed at this machine was refused with `machine <id>
 * is not connected` for the whole of it.
 *
 * {@link reconnecting} is what keeps this honest — it ends the series once a
 * connection has actually been healthy, so the next outage steps a schedule
 * that starts again at 1s.
 */
export const reconnect = Schedule.min([
  Schedule.exponential(Duration.seconds(1)),
  Schedule.spaced(Duration.seconds(30)),
]).pipe(Schedule.jittered);

/**
 * How long a connection must stand before losing it counts as a fresh outage
 * rather than another failure in a failing series.
 *
 * Ours, because: nothing in the protocol declares a connection healthy — there
 * is no register ack — so the only evidence available is that the socket stayed
 * open. 60s is two heartbeats (HEARTBEAT_INTERVAL is 15s) plus room for the
 * register's harness and tool probes, which spawn processes and take real time;
 * a hub that was going to reject or drop this daemon has done it well inside
 * that. Below it we are looking at a genuine flap — a hub that is crash-looping
 * or a network that will not hold — and backing off is the right answer. Above
 * it the previous series has nothing left to say about the next outage.
 *
 * Effect 4's `Schedule` has no `resetAfter`/`resetWhen` (they are 3.x only, and
 * the 3.x copies in node_modules belong to other packages), so the reset is the
 * loop in {@link reconnecting} rather than a schedule combinator.
 */
export const HEALTHY_CONNECTION = Duration.seconds(60);

/**
 * How many consecutive failures against the pinned URL, and how much wall
 * time they must span, before the daemon stops trusting that URL and re-runs
 * discovery instead of just retrying it.
 *
 * Both ours, chosen together: 5 failures is inside one retry series (past the
 * point where a flap is still plausibly transient) but comfortably short of
 * the count a genuine multi-minute network blip would rack up on its own — and
 * {@link HEALTHY_CONNECTION} is what keeps a hub restart from ever reaching
 * either number, since a restart's reconnect ends the series (and resets the
 * failure count with it) the moment it goes healthy. 2 minutes is there so a
 * burst of near-instant failures (a hub that is up but refusing connections,
 * failing in milliseconds) still has to *last*, not just *count*, before the
 * daemon concludes the URL itself is gone rather than the hub being briefly
 * unwell at it.
 */
export const REDISCOVERY_FAILURE_COUNT = 5;
export const REDISCOVERY_FAILURE_WINDOW = Duration.minutes(2);

/**
 * Connect, and keep connecting — forever, and with a backoff that means it.
 *
 * `session` is handed a `markLive` it calls at the moment the connection is
 * genuinely up (for the daemon: socket open and the register sent). It never
 * succeeds; it fails when the connection goes away.
 *
 * Each pass through the outer loop builds its own `Effect.retry`, and therefore
 * its own schedule state. A failure that arrives before the connection was ever
 * live, or less than `healthyAfter` after it went live, stays inside that retry
 * and pays the growing backoff. A failure after a healthy stretch ENDS the
 * series by succeeding, and the loop re-enters with a schedule that starts over
 * at 1s.
 *
 * The loop deliberately contains nothing but the connection: the supervisor and
 * the scanner are built by the caller, outside it, and stay built across every
 * reconnect.
 *
 * `rediscover`, when given, adds a side channel that composes with the above
 * rather than replacing any of it: a failure counter and its first-failure
 * timestamp live for the life of one series (the same lifetime `Schedule`'s
 * own backoff state has), incrementing on every failure regardless of how the
 * backoff or the healthy-check settle it. Once the counter and the span both
 * cross the configured threshold, `onTrigger` is awaited — inline, before the
 * schedule's next attempt — and then the counter resets so the next window
 * starts clean. A series that ends by going healthy gets a fresh counter the
 * same way it gets a fresh schedule, because {@link reconnecting} builds a new
 * `series` value (and therefore a new closure) every time {@link
 * Effect.forever} re-enters it.
 */
export const reconnecting = <E extends { readonly reason: string }, R>(
  session: (markLive: () => void) => Effect.Effect<never, E, R>,
  options?: {
    readonly healthyAfter?: Duration.Duration;
    readonly schedule?: typeof reconnect;
    readonly now?: () => number;
    readonly rediscover?: {
      readonly failureCount?: number;
      readonly window?: Duration.Duration;
      readonly onTrigger: () => Effect.Effect<void>;
    };
  }
) => {
  const healthyAfter = Duration.toMillis(options?.healthyAfter ?? HEALTHY_CONNECTION);
  const now = options?.now ?? (() => Date.now());
  const rediscover = options?.rediscover;
  const failureThreshold = rediscover?.failureCount ?? REDISCOVERY_FAILURE_COUNT;
  const failureWindow = Duration.toMillis(rediscover?.window ?? REDISCOVERY_FAILURE_WINDOW);

  const buildSeries = () => {
    // Series-scoped, not attempt-scoped: unlike `liveAt` below, this must
    // survive across the retries `Effect.retry` runs within one series, so it
    // lives in this closure rather than inside the `Effect.suspend` thunk that
    // `Effect.retry` re-invokes on every attempt.
    let failures = 0;
    let firstFailureAt: number | undefined;

    return Effect.suspend(() => {
      // Per-pass, and read only after the failure that ends the pass — nothing
      // else can observe it, so a plain binding is the whole of the state.
      let liveAt: number | undefined;
      return session(() => {
        liveAt = now();
      }).pipe(
        Effect.tapError((error) => Effect.logWarning(`${error.reason} — reconnecting`)),
        Effect.tapError(() => {
          if (!rediscover) return Effect.void;
          const at = now();
          failures += 1;
          firstFailureAt ??= at;
          if (failures < failureThreshold || at - firstFailureAt < failureWindow) return Effect.void;
          failures = 0;
          firstFailureAt = undefined;
          return rediscover.onTrigger();
        }),
        Effect.catch((error: E) =>
          liveAt !== undefined && now() - liveAt >= healthyAfter
            ? Effect.void
            : Effect.fail(error)
        )
      );
    }).pipe(Effect.retry(options?.schedule ?? reconnect));
  };
  return Effect.forever(Effect.suspend(buildSeries));
};

const closeReason = (event: CloseEvent): string => event.reason || `close code ${event.code}`;

const send = (socket: WebSocket, envelope: Envelope): void => {
  socket.send(JSON.stringify(envelope));
};

/** Succeeds with an open socket; fails if the socket closes before opening. */
const open = (url: string) =>
  Effect.callback<WebSocket, ConnectionLost>((resume) => {
    const socket = new WebSocket(url);
    const onOpen = () => {
      socket.removeEventListener('close', onClose);
      resume(Effect.succeed(socket));
    };
    const onClose = (event: CloseEvent) => {
      socket.removeEventListener('open', onOpen);
      resume(Effect.fail(new ConnectionLost({ url, reason: closeReason(event) })));
    };
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('close', onClose, { once: true });
    return Effect.sync(() => socket.close());
  });

const connection = (url: string) =>
  Effect.acquireRelease(open(url), (socket) => Effect.sync(() => socket.close()));

/** Never succeeds — it fails when the hub goes away, which is what drives the retry. */
const closed = (socket: WebSocket, url: string) =>
  Effect.callback<never, ConnectionLost>((resume) => {
    // The state is read before the event is waited for, because between `open`
    // dropping its own close listener and this one going on, `attach` registers:
    // it probes every harness and every tool, which spawns processes and takes
    // real time. A hub that goes away inside that window fires `close` at nobody
    // — and a listener added afterwards waits for an event that has already
    // been and gone. That wait is silent and permanent: `send` on a dead socket
    // throws nothing, so the register is logged as if it landed, no
    // `ConnectionLost` is ever raised, and the retry below never gets its turn.
    // The daemon keeps its sessions and looks healthy while the hub stops
    // hearing from it altogether.
    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      resume(Effect.fail(new ConnectionLost({ url, reason: 'closed while registering' })));
      return;
    }
    const onClose = (event: CloseEvent) =>
      resume(Effect.fail(new ConnectionLost({ url, reason: closeReason(event) })));
    socket.addEventListener('close', onClose, { once: true });
    return Effect.sync(() => socket.removeEventListener('close', onClose));
  });

/**
 * A hub restore this daemon could take custody of instead of re-spawning.
 *
 * `adopt` is claude's alone (see `session.ts`'s `reattach`), and a spawn that
 * has to clone a repository or cut a worktree first is not a session that
 * already exists to be adopted — both go straight to the supervisor.
 */
export const adoptable = (payload: SpawnPayload | undefined): payload is SpawnPayload =>
  payload !== undefined &&
  typeof payload.instanceId === 'string' &&
  payload.instanceId.length > 0 &&
  typeof payload.cwd === 'string' &&
  payload.cwd.length > 0 &&
  (payload.harness === undefined || payload.harness === 'claude') &&
  payload.bootstrap === undefined &&
  payload.scratch === undefined;

/** That restore as `reattachFrom` wants it: where it runs, and what to resume. */
export const custodyRow = (
  payload: SpawnPayload
): { instanceId: string; cwd: string; sessionId: string | null } => ({
  instanceId: payload.instanceId,
  cwd: payload.cwd,
  sessionId: payload.resume?.sessionKey ?? null,
});

const attach = (
  scanner: UsageScanner,
  supervisor: SessionSupervisor,
  identity: MachineIdentity,
  url: string,
  /**
   * Called once the socket is open and the register has gone out — the moment
   * this connection counts as up. {@link reconnecting} reads it to tell a
   * healthy connection that later died from one that never stood at all; a hub
   * that vanishes during the register's probes never marks it, and so is
   * correctly treated as a flap.
   */
  markLive: () => void = () => {}
) =>
  Effect.gen(function* () {
    const socket = yield* connection(url);
    const payload: RegisterPayload = {
      ...identity,
      instances: supervisor.instanceIds,
      resumable: yield* Effect.promise(() => resumableSessions()),
      harnesses: yield* Effect.promise(() =>
        Promise.all(harnesses().map((adapter) => adapter.detect()))
      ),
      tools: yield* Effect.promise(() => probeTools()),
      build: yield* Effect.promise(() => buildInfo()),
      ...(latestDeploy() ? { deploy: latestDeploy() } : {}),
    };
    send(socket, { verb: 'register', machineId: identity.machineId, payload });
    yield* Effect.logInfo(`registered with ${url}`);
    markLive();

    supervisor.reannounce = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      void Promise.all(harnesses().map((adapter) => adapter.detect())).then((harnesses) => {
        send(socket, {
          verb: 'register',
          machineId: identity.machineId,
          payload: { ...identity, auth: harnesses[0]?.auth ?? identity.auth, harnesses, instances: supervisor.instanceIds },
        });
      });
    };

    // A hand-off leaves as a `send` addressed at the target's machine; the hub
    // relays it the same way it relays a dashboard's.
    supervisor.emit = (envelope) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      send(socket, { ...envelope, machineId: envelope.machineId || identity.machineId });
    };

    supervisor.sink = (frame) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      // Every frame a session sinks is instance-scoped. `usage` is the one
      // FramePayload variant the hub originates for dashboards, so it never
      // arrives here — narrowing on the field keeps that asymmetry honest.
      if (!('instanceId' in frame)) return;
      send(socket, {
        verb: 'frames',
        machineId: identity.machineId,
        instanceId: frame.instanceId,
        requestId: 'requestId' in frame ? frame.requestId : undefined,
        payload: frame,
      });
    };
    /**
     * CUSTODY OFF THE REGISTER ACK (design §7, step 4).
     *
     * A daemon that just restarted holds no sessions, so the hub's answer to
     * its register is: the ledger it has ingested of them (the ack), preceded
     * by a `spawn` for each session it thinks should be running again. Those
     * spawns are the ONLY place this process learns a surviving child's
     * directory and conversation — sessiond hands back procIds and ring heads,
     * never a cwd — so they are held here until the ack arrives rather than
     * dispatched straight into a fresh process.
     *
     * On the ack the supervisor is asked to take custody of them instead:
     * whatever sessiond is still holding is adopted onto its existing pipe and
     * ring, and every spawn it did NOT adopt is dispatched exactly as it would
     * have been. So a machine with no sessiond children behaves precisely as it
     * did before this wiring, and one that has them keeps their processes.
     *
     * The window is this connection's first register ack and nothing else: an
     * operator's spawn, a delegate's, and every later `reannounce` ack go
     * straight through.
     */
    const heldSpawns: Envelope[] = [];
    let awaitingRegisterAck = true;

    const takeCustody = (ackPayload: unknown, spawns: Envelope[]): void => {
      // Nothing to adopt is not a reason to go looking: `reattach` reads
      // sessiond's list first, and dialling it (which may start one) on every
      // register ack would be a new cost paid by every machine, for nothing.
      if (spawns.length === 0) return;
      const rows = spawns.map((envelope) => custodyRow(envelope.payload as SpawnPayload));
      void supervisor
        .reattachFrom(ackPayload, rows)
        .catch((error: unknown) => {
          // A sessiond that cannot be reached is not a reason to lose the
          // hub's restores: adopt nothing, spawn everything, exactly as before.
          Effect.runFork(Effect.logWarning(`reattach failed: ${String(error)}`));
          return [] as string[];
        })
        .then((adopted) => {
          if (adopted.length > 0) {
            Effect.runFork(
              Effect.logInfo(`took custody of ${adopted.length} surviving session(s): ${adopted.join(', ')}`)
            );
          }
          for (const envelope of spawns) {
            if (!adopted.includes((envelope.payload as SpawnPayload).instanceId)) {
              supervisor.dispatch(envelope);
            }
          }
        });
    };

    socket.addEventListener('message', (event) => {
      const envelope = JSON.parse(String(event.data)) as Envelope;
      if (awaitingRegisterAck) {
        if (envelope.verb === 'register') {
          awaitingRegisterAck = false;
          const spawns = heldSpawns.splice(0);
          takeCustody(envelope.payload, spawns);
          return;
        }
        if (envelope.verb === 'spawn' && adoptable(envelope.payload as SpawnPayload | undefined)) {
          heldSpawns.push(envelope);
          return;
        }
      }
      supervisor.dispatch(envelope);
    });

    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.sync(() =>
          send(socket, {
            verb: 'heartbeat',
            machineId: identity.machineId,
            // `instances` rides every beat (not just register) so the hub can
            // reconcile session truth continuously — see HeartbeatPayload.
            // `deploy` rides it for the same reason: it is a live fact, and
            // `diverged` appearing between two registers must not wait for the
            // next one. Omitted entirely until a watcher has ticked.
            payload: {
              at: Date.now(),
              instances: supervisor.instanceIds,
              ...(latestDeploy() ? { deploy: latestDeploy() } : {}),
            } satisfies HeartbeatPayload,
          })
        ),
        Schedule.spaced(HEARTBEAT_INTERVAL)
      )
    );

    // Usage, cost & limits (USAGE-SPEC.md §5): scan the machine's transcripts
    // and opencode DB, then report absolute bucket totals with the live limit
    // windows. A scan failure must never kill the daemon — it hosts the user's
    // live sessions — so the whole tick is caught and logged.
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.gen(function* () {
          const rebuilt = scanner.dueForFullRebuild(USAGE_FULL_REBUILD_MS);
          yield* Effect.promise(() =>
            rebuilt ? scanner.fullRebuild() : scanner.incremental()
          );
          const buckets = scanner.reportBuckets(Date.now());
          const limits = yield* Effect.promise(() => fetchClaudeLimits());
          send(socket, {
            verb: 'usage',
            machineId: identity.machineId,
            payload: { buckets, limits },
          });
        }).pipe(
          Effect.catchDefect((error) =>
            Effect.logWarning(
              `usage scan failed: ${error instanceof Error ? error.message : String(error)}`
            )
          )
        ),
        Schedule.spaced(USAGE_INTERVAL)
      )
    );

    // No periodic auth re-probe. It cost far more than it was worth:
    // `probeAuth` starts a real `query()`, which is a Claude Code process that
    // reads the credentials and may refresh them. Refresh tokens rotate, so a
    // probe that refreshes invalidates the token every other process on this
    // machine is holding — measured: 38 live processes against 10 sessions,
    // with the credentials file rewritten seconds earlier, and sessions dying
    // of "OAuth session expired and could not be refreshed".
    //
    // Auth is read once at start. The authoritative signal was never this
    // probe anyway: a session that cannot answer says so in its own turn,
    // where it is unambiguous and costs nothing to learn.

    return yield* closed(socket, url);
  });

/**
 * Runs until interrupted: connect, register, heartbeat, reconnect on loss.
 *
 * `auth` is what the caller already found out — `cockpit up` probes before it
 * gets here, because it may still be able to fix it. A daemon started any other
 * way asks for itself.
 */
export const startDaemon = (auth?: AuthState) =>
  Effect.gen(function* () {
    const url = process.env[COCKPIT_ENV.hubUrl] ?? DEFAULT_HUB_URL;
    // Re-pinned by `onSustainedFailure` below, read fresh by every attempt
    // `reconnecting` makes — see its own doc for why a plain closure variable
    // is enough: each attempt calls `session` anew, in the same tick that
    // reads this.
    let hubUrl = url;
    // The claude harness's auth is the machine's headline word — the original
    // rail still reads it — while `register` carries every harness's own.
    const claude = harnesses().find((adapter) => adapter.kind === 'claude');
    const machineIdValue = yield* Effect.promise(() => machineId());
    // Child processes — the opencode server and its plugins most of all — read
    // the machine's identity and the hub off the environment they inherit.
    process.env[COCKPIT_ENV.machineId] = machineIdValue;
    process.env[COCKPIT_ENV.hubUrl] = url;
    // The sessions this daemon spawns carry the deny list in their own options;
    // the settings file is how the `claude` the user starts by hand gets it too.
    const denied = yield* Effect.promise(() => convergeDeniedTools());
    if (denied.state === 'applied') {
      yield* Effect.logInfo(`denied ${DENIED_WEB_TOOLS.join(', ')} in ~/.claude/settings.json`);
    } else if (denied.state === 'failed') {
      yield* Effect.logWarning(denied.detail);
    }
    const identity: MachineIdentity = {
      machineId: machineIdValue,
      hostname: hostname(),
      os: `${platform()}-${arch()}`,
      auth: auth ?? (yield* Effect.promise(() => (claude ? claude.detect() : Promise.resolve({ auth: 'unauthenticated' as AuthState })).then((r) => r.auth))),
    };
    if (identity.auth !== 'authenticated') {
      yield* Effect.logWarning(`Claude Code credentials are ${identity.auth} on this machine`);
    }

    // Outlives any one connection: a hub restart must not kill running sessions.
    const supervisor = yield* Effect.acquireRelease(
      Effect.sync(() => new SessionSupervisor()),
      (running) =>
        // Detached, not drained: the sessions outlive this daemon in sessiond,
        // and the next one reattaches to them. See `SessionSupervisor.detach`.
        Effect.logInfo(`detaching ${running.instanceIds.length} session(s)`).pipe(
          Effect.andThen(Effect.sync(() => running.detach()))
        )
    );

    // The usage scanner outlives connections too: its dedup set is rebuilt only
    // on start (USAGE-SPEC.md §5.1), so a reconnect must not reset it.
    const scanner = yield* Effect.promise(() => UsageScanner.load());

    yield* Effect.logInfo(`cockpit agent ${identity.machineId} connecting to ${url}`);
    // The connection — and only the connection — is what the loop re-enters.
    // The supervisor above it keeps its sessions and the scanner keeps its
    // dedup set across every reconnect; an interrupt still unwinds through this
    // to the supervisor's release, so a signalled daemon drains between turns.
    yield* reconnecting(
      (markLive) => Effect.scoped(attach(scanner, supervisor, identity, hubUrl, markLive)),
      {
        rediscover: {
          onTrigger: () =>
            Effect.promise(async () => {
              const winner = await rediscoverHub({
                log: (line) => Effect.runSync(Effect.logInfo(line)),
              });
              if (winner) hubUrl = toWsUrl(winner);
            }).pipe(
              // A rediscovery attempt that throws (a probe rejecting oddly, a
              // malformed tailscale JSON) must never take the reconnect loop
              // down with it — worst case is the pinned URL simply stays put
              // and the backoff series it was already running continues.
              Effect.catchDefect((defect) =>
                Effect.logWarning(`rediscovery failed: ${String(defect)}`)
              )
            ),
        },
      }
    );
  }).pipe(Effect.scoped);

/**
 * Runs {@link startDaemon} until the process is signalled — how a daemon
 * normally ends, on a deliberate restart or a machine going down. Interrupting
 * the fiber runs the supervisor's drain first, so the sessions it owns stop
 * between turns instead of mid-tool. A second signal arrives with the handler
 * already gone, and kills the daemon the usual way.
 */
export const runDaemon = (auth?: AuthState): void => {
  const daemon = Effect.runFork(startDaemon(auth));
  const drain = (signal: NodeJS.Signals): void => {
    // bun-types' `NodeJS.Process` merge redeclares `off` for its own
    // `"memoryPressure"` event only, which shadows @types/node's generic
    // `EventEmitter.off(event: string | symbol, listener)` instead of
    // overloading it — so `process.off(signal, drain)` type-checks against
    // that one unrelated overload and never against a signal. Going through
    // `EventEmitter` directly reaches the generic signature `process.off`
    // itself no longer offers.
    (process as NodeJS.EventEmitter).off(signal, drain);
    void Effect.runPromise(Fiber.interrupt(daemon)).then(() => process.exit(0));
  };
  process.on('SIGINT', drain).on('SIGTERM', drain);
};

import type { AuthState, BuildInfo, Envelope, HarnessReport, HeartbeatPayload, ToolStatus } from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { fetchClaudeLimits } from '@cockpit/core/usage/limits';
import { Data, Duration, Effect, Fiber, Schedule } from 'effect';
import { arch, hostname, platform } from 'node:os';
import { buildInfo } from './build';
import { convergeDeniedTools, DENIED_WEB_TOOLS } from './denied-tools';
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
 */
export const reconnecting = <E extends { readonly reason: string }, R>(
  session: (markLive: () => void) => Effect.Effect<never, E, R>,
  options?: {
    readonly healthyAfter?: Duration.Duration;
    readonly schedule?: typeof reconnect;
    readonly now?: () => number;
  }
) => {
  const healthyAfter = Duration.toMillis(options?.healthyAfter ?? HEALTHY_CONNECTION);
  const now = options?.now ?? (() => Date.now());
  const series = Effect.suspend(() => {
    // Per-pass, and read only after the failure that ends the pass — nothing
    // else can observe it, so a plain binding is the whole of the state.
    let liveAt: number | undefined;
    return session(() => {
      liveAt = now();
    }).pipe(
      Effect.tapError((error) => Effect.logWarning(`${error.reason} — reconnecting`)),
      Effect.catch((error: E) =>
        liveAt !== undefined && now() - liveAt >= healthyAfter
          ? Effect.void
          : Effect.fail(error)
      )
    );
  }).pipe(Effect.retry(options?.schedule ?? reconnect));
  return Effect.forever(series);
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
    socket.addEventListener('message', (event) => {
      supervisor.dispatch(JSON.parse(String(event.data)) as Envelope);
    });

    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.sync(() =>
          send(socket, {
            verb: 'heartbeat',
            machineId: identity.machineId,
            // `instances` rides every beat (not just register) so the hub can
            // reconcile session truth continuously — see HeartbeatPayload.
            payload: { at: Date.now(), instances: supervisor.instanceIds } satisfies HeartbeatPayload,
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
        Effect.logInfo(`draining ${running.instanceIds.length} session(s)`).pipe(
          Effect.andThen(Effect.promise(() => running.shutdown()))
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
    yield* reconnecting((markLive) =>
      Effect.scoped(attach(scanner, supervisor, identity, url, markLive))
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

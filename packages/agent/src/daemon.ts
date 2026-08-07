import type { AuthState, BuildInfo, Envelope, ToolStatus } from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { Data, Duration, Effect, Fiber, Schedule } from 'effect';
import { arch, hostname, platform } from 'node:os';
import { probeAuth } from './auth';
import { buildInfo } from './build';
import { machineId } from './machine-id';
import { resumableSessions, SessionSupervisor } from './session';
import { probeTools } from './tools';

const DEFAULT_HUB_URL = `ws://localhost:${COCKPIT_HUB_PORT}/ws`;
const HEARTBEAT_INTERVAL = Duration.seconds(15);


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
   * The SDK sessions this machine could resume, so the rows the daemon no
   * longer carries settle as sleeping or as lost rather than all alike. Absent
   * when the catalog could not be read.
   */
  resumable?: string[];
  /**
   * What the machine has of the tool catalog (NEW.md §10), so the hub can send
   * an install for whatever its policy requires and this machine lacks. Absent
   * from a register that did not probe.
   */
  tools?: ToolStatus[];
  /**
   * The cockpit this daemon is running (NEW.md §12), so the hub can say which
   * machines are behind it. Absent from the re-announce, which is about
   * credentials and has nothing new to say about the build.
   */
  build?: BuildInfo;
}

export class ConnectionLost extends Data.TaggedError('ConnectionLost')<{
  readonly url: string;
  readonly reason: string;
}> {}

/** 1s, 2s, 4s … capped at 30s, jittered so a fleet never retries in lockstep. */
const reconnect = Schedule.min([
  Schedule.exponential(Duration.seconds(1)),
  Schedule.spaced(Duration.seconds(30)),
]).pipe(Schedule.jittered);

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
    const onClose = (event: CloseEvent) =>
      resume(Effect.fail(new ConnectionLost({ url, reason: closeReason(event) })));
    socket.addEventListener('close', onClose, { once: true });
    return Effect.sync(() => socket.removeEventListener('close', onClose));
  });

const attach = (supervisor: SessionSupervisor, identity: MachineIdentity, url: string) =>
  Effect.gen(function* () {
    const socket = yield* connection(url);
    const payload: RegisterPayload = {
      ...identity,
      instances: supervisor.instanceIds,
      resumable: yield* Effect.promise(() => resumableSessions()),
      tools: yield* Effect.promise(() => probeTools()),
      build: yield* Effect.promise(() => buildInfo()),
    };
    send(socket, { verb: 'register', machineId: identity.machineId, payload });
    yield* Effect.logInfo(`registered with ${url}`);

    // Says this machine over again, with whatever it can do about credentials
    // now. An unlock changes the answer, and the fleet has to hear it or the
    // rail keeps reporting a machine that has just been fixed as broken.
    //
    // No tool report rides along: an install answers with its own status on the
    // `control_result` the hub is already waiting for, and a stale report here
    // would have the hub install a tool it has just watched arrive.
    supervisor.reannounce = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      void probeAuth().then((auth) => {
        send(socket, {
          verb: 'register',
          machineId: identity.machineId,
          payload: { ...identity, auth, instances: supervisor.instanceIds },
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
      send(socket, {
        verb: 'frames',
        machineId: identity.machineId,
        instanceId: frame.instanceId,
        requestId: frame.kind === 'sdk' ? undefined : frame.requestId,
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
            payload: { at: Date.now() },
          })
        ),
        Schedule.spaced(HEARTBEAT_INTERVAL)
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
    const identity: MachineIdentity = {
      machineId: yield* Effect.promise(() => machineId()),
      hostname: hostname(),
      os: `${platform()}-${arch()}`,
      auth: auth ?? (yield* Effect.promise(() => probeAuth())),
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

    yield* Effect.logInfo(`cockpit agent ${identity.machineId} connecting to ${url}`);
    yield* Effect.scoped(attach(supervisor, identity, url)).pipe(
      Effect.tapError((error) => Effect.logWarning(`${error.reason} — reconnecting`)),
      Effect.retry(reconnect)
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
    process.off(signal, drain);
    void Effect.runPromise(Fiber.interrupt(daemon)).then(() => process.exit(0));
  };
  process.on('SIGINT', drain).on('SIGTERM', drain);
};

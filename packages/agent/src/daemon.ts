import type { Envelope } from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { Data, Duration, Effect, Schedule } from 'effect';
import { arch, hostname, platform } from 'node:os';
import { machineId } from './machine-id';
import { SessionSupervisor } from './session';

const DEFAULT_HUB_URL = `ws://localhost:${COCKPIT_HUB_PORT}/ws`;
const HEARTBEAT_INTERVAL = Duration.seconds(15);

/** How the hub identifies this machine in its registry. */
interface MachineIdentity {
  machineId: string;
  hostname: string;
  os: string;
}

/**
 * What `register` carries. The supervisor outlives any one connection, so a
 * register is not a promise of zero sessions — `instances` names the ones still
 * running and the hub marks every other row it calls running as unknown.
 */
export interface RegisterPayload extends MachineIdentity {
  instances: string[];
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
    const payload: RegisterPayload = { ...identity, instances: supervisor.instanceIds };
    send(socket, { verb: 'register', machineId: identity.machineId, payload });
    yield* Effect.logInfo(`registered with ${url}`);

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

    return yield* closed(socket, url);
  });

/** Runs until interrupted: connect, register, heartbeat, reconnect on loss. */
export const startDaemon = Effect.gen(function* () {
  const url = process.env[COCKPIT_ENV.hubUrl] ?? DEFAULT_HUB_URL;
  const identity: MachineIdentity = {
    machineId: yield* Effect.promise(() => machineId()),
    hostname: hostname(),
    os: `${platform()}-${arch()}`,
  };

  // Outlives any one connection: a hub restart must not kill running sessions.
  const supervisor = yield* Effect.acquireRelease(
    Effect.sync(() => new SessionSupervisor()),
    (running) => Effect.promise(() => running.shutdown())
  );

  yield* Effect.logInfo(`cockpit agent ${identity.machineId} connecting to ${url}`);
  yield* Effect.scoped(attach(supervisor, identity, url)).pipe(
    Effect.tapError((error) => Effect.logWarning(`${error.reason} — reconnecting`)),
    Effect.retry(reconnect)
  );
}).pipe(Effect.scoped);

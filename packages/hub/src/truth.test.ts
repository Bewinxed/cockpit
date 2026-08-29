import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { InstanceRow, SessionPulse } from '@cockpit/core';
import { RESTART_LOST, RESTART_RESUMABLE } from '@cockpit/core';
import { makeDb } from './db';
import type { PendingShape } from './pending';
import type { HubSocket, RegistryShape } from './registry';
import { createServer } from './server';

/**
 * Session liveness is the daemon's; the column is history.
 *
 * The defect this file fences, measured before it was fixed: `/api/instances`
 * reported 178 instances `running` on one machine while 42 `claude` processes
 * existed there — all of them at or under 1.5% CPU and 36–44 hours old — and
 * only two of those rows had been touched in the previous 90 minutes. Nothing
 * had gone wrong at any single moment; the hub had simply been writing
 * `running` at every spawn, respawning every resumable orphan on every daemon
 * register, and serving the resulting column back as a statement about the
 * present tense forever afterwards.
 *
 * The fix has four moving parts and this file is the statement of what each
 * one means:
 *
 * - a spawn writes `starting`, because issuing a spawn is not a process;
 * - the daemon's heartbeat is the only thing that mints `running`, and the same
 *   beat's silence is what takes it away again — with no respawn from that path;
 * - a register's recovery is bounded by a horizon and a cap, so a machine that
 *   was away for a day and a half is not handed its whole history as a work
 *   queue;
 * - and every read passes through a presence overlay, so a row on a machine the
 *   hub is not holding a socket for is served `unknown` rather than whatever it
 *   last said.
 *
 * A scratch database, for the reason every other suite here keeps one: `bun
 * test` runs every file in one process, so a shared path is a shared race.
 */
const DB_FILE = `/tmp/cockpit-truth-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

const MACHINE = 'machine-truth';
const OTHER = 'machine-quiet';

/** Mutable, because dropping a socket without telling the database is the subject. */
const makeTestRegistry = (): RegistryShape & { readonly sockets: Map<string, HubSocket> } => {
  const sockets = new Map<string, HubSocket>();
  const dashboards = new Map<string, { socket: HubSocket; subscriptions: Set<string> }>();
  const requesters = new Map<string, HubSocket>();
  return {
    sockets,
    registerAgent: (machineId, socket) => sockets.set(machineId, socket),
    dropAgent: (socketId) => {
      for (const [machineId, socket] of sockets)
        if (socket.id === socketId) {
          sockets.delete(machineId);
          return machineId;
        }
      return undefined;
    },
    agent: (machineId) => sockets.get(machineId),
    machineIds: () => [...sockets.keys()],
    addDashboard: (socket) => dashboards.set(socket.id, { socket, subscriptions: new Set() }),
    dropDashboard: (socket) => dashboards.delete(socket.id),
    broadcast: (envelope) => {
      for (const { socket } of dashboards.values()) socket.send(envelope);
    },
    broadcastFrame: (envelope, instanceId) => {
      for (const { socket, subscriptions } of dashboards.values())
        if (subscriptions.has(instanceId)) socket.send(envelope);
    },
    setSubscriptions: (socket, instanceIds) => {
      const entry = dashboards.get(socket.id);
      if (entry) entry.subscriptions = new Set(instanceIds);
    },
    rememberRequester: (requestId, socket) => requesters.set(requestId, socket),
    takeRequester: (requestId) => {
      const socket = requesters.get(requestId);
      requesters.delete(requestId);
      return socket;
    },
  };
};

const pending: PendingShape = {
  remember: () => {},
  get: () => undefined,
  resolve: () => {},
  forget: () => {},
  list: () => [],
};

const registry = makeTestRegistry();
const app = createServer({ registry, db, pending }).listen(0);
const port = app.server?.port;

db.upsertAgent({ machineId: MACHINE, hostname: 'truth-box', os: 'linux', auth: 'authenticated' });
db.upsertAgent({ machineId: OTHER, hostname: 'quiet-box', os: 'linux', auth: 'unknown' });

/**
 * The one thing the DbShape deliberately cannot do: move a row backwards in
 * time. Age is the whole input to the restore horizon and to the `starting`
 * grace, so the tests have to be able to state it, and a second handle on a
 * scratch file is cheaper than an API that exists only for tests.
 */
const backdate = (id: string, ms: number): void => {
  const raw = new Database(DB_FILE);
  raw.query('update instances set updated_at = ? where id = ?').run(Date.now() - ms, id);
  raw.close();
};

const statusOf = (id: string): string | undefined => {
  const raw = new Database(DB_FILE, { readonly: true });
  const row = raw.query('select status from instances where id = ?').get(id) as
    | { status: string }
    | undefined;
  raw.close();
  return row?.status;
};

const lastErrorOf = (id: string): string | null | undefined => {
  const raw = new Database(DB_FILE, { readonly: true });
  const row = raw.query('select last_error from instances where id = ?').get(id) as
    | { last_error: string | null }
    | undefined;
  raw.close();
  return row?.last_error;
};

interface Peer {
  readonly socket: WebSocket;
  readonly inbox: Record<string, unknown>[];
  readonly close: () => void;
}

const connect = async (path: string): Promise<Peer> => {
  const socket = new WebSocket(`ws://localhost:${port}${path}`);
  const inbox: Record<string, unknown>[] = [];
  socket.addEventListener('message', (event) => {
    inbox.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`could not open ${path}`)), {
      once: true,
    });
  });
  return { socket, inbox, close: () => socket.close() };
};

/** Waits for something the server does in its own time, or gives up loudly. */
const until = async <T>(read: () => T | undefined, what: string): Promise<T> => {
  for (let waited = 0; waited < 400; waited++) {
    const value = read();
    if (value !== undefined) return value;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** A heartbeat carrying exactly what the machine says it is holding (contract C1). */
const beat = async (peer: Peer, instances: string[]): Promise<void> => {
  const before = peer.inbox.length;
  peer.socket.send(
    JSON.stringify({
      verb: 'heartbeat',
      machineId: MACHINE,
      payload: { at: Date.now(), instances },
    })
  );
  // The ack is the server's own word that it finished handling the beat, which
  // is what makes the assertions after this deterministic rather than timed.
  // It echoes the verb it answers rather than saying `ack` — see `ack()`.
  await until(() => acked(peer, 'heartbeat', before), 'the heartbeat ack');
};

/** The server's answer to a verb: the same verb back, with `{ ok: true }`. */
const acked = (peer: Peer, verb: string, from = 0): Record<string, unknown> | undefined =>
  peer.inbox
    .slice(from)
    .find(
      (message) =>
        message.verb === verb && (message.payload as { ok?: unknown } | undefined)?.ok === true
    );

const spawnsIn = (peer: Peer): string[] =>
  peer.inbox
    .filter((message) => message.verb === 'spawn')
    .map((message) => String(message.instanceId));

const readInstances = async (): Promise<InstanceRow[]> => {
  const response = await fetch(`http://localhost:${port}/api/instances`);
  expect(response.status).toBe(200);
  return (await response.json()) as InstanceRow[];
};

const openSession = (id: string, sessionId?: string): void => {
  db.openInstance({
    id,
    machineId: MACHINE,
    cwd: `/tmp/${id}`,
    kind: 'mainline',
    ...(sessionId ? { sessionId } : {}),
  });
};

afterAll(async () => {
  app.stop();
  for (const suffix of ['', '-shm', '-wal']) {
    await Bun.file(`${DB_FILE}${suffix}`).delete().catch(() => {});
  }
});

test('a spawn writes `starting`, not `running` — openInstance no longer lies', () => {
  // The original sin, in one assertion. `openInstance` is called from every
  // spawn path there is, including the fire-and-forget restores at register,
  // and it used to write `running` before any process was confirmed. A row
  // minted by the hub asserting a live process is the 178-vs-42 gap in miniature.
  openSession('inst-open', 'sess-open');
  expect(statusOf('inst-open')).toBe('starting');
});

test('a heartbeat listing a session promotes it to running; one that omits it settles it', async () => {
  openSession('inst-listed', 'sess-listed');
  openSession('inst-resumable', 'sess-resumable');
  openSession('inst-lost');

  const agent = await connect('/ws');
  // Everything is live to begin with, which is also what puts the two soon-to-be
  // orphans into `running` — only the daemon's word can do that.
  await beat(agent, ['inst-listed', 'inst-resumable', 'inst-lost']);
  expect(statusOf('inst-listed')).toBe('running');
  expect(statusOf('inst-resumable')).toBe('running');
  expect(statusOf('inst-lost')).toBe('running');

  const spawnsBefore = spawnsIn(agent).length;

  // And now the machine stops listing two of them. That silence is evidence.
  await beat(agent, ['inst-listed']);
  expect(statusOf('inst-listed')).toBe('running');
  // A conversation survived, so nothing is wrong — the session is asleep.
  expect(statusOf('inst-resumable')).toBe('sleeping');
  expect(lastErrorOf('inst-resumable')).toBeNull();
  // Nothing survived, so this one is a real loss and says why.
  expect(statusOf('inst-lost')).toBe('error');
  expect(lastErrorOf('inst-lost')).toBe(RESTART_LOST);

  // Contract C4's second half: the heartbeat reconciles and does not recover.
  // Respawning from a report that arrives every 15 seconds would relaunch a
  // session every 15 seconds for as long as the hub and the machine disagreed.
  expect(spawnsIn(agent).length).toBe(spawnsBefore);

  // Promotion works in the other direction too — a settled row the machine
  // starts listing again is running, on the machine's word alone.
  await beat(agent, ['inst-listed', 'inst-resumable']);
  expect(statusOf('inst-resumable')).toBe('running');

  agent.close();
});

test('a freshly-issued spawn is not settled by a beat that was already in flight', async () => {
  openSession('inst-racing', 'sess-racing');
  const agent = await connect('/ws');

  // The row was written `starting` a moment ago; the beat cannot know about it
  // yet. Settling it here would kill a session that is launching normally.
  await beat(agent, []);
  expect(statusOf('inst-racing')).toBe('starting');

  // Past the grace, the same silence is an answer: the spawn never landed.
  backdate('inst-racing', 60_000);
  await beat(agent, []);
  expect(statusOf('inst-racing')).toBe('sleeping');

  agent.close();
});

test('a register restores the newest orphans only, within the horizon and under the cap', async () => {
  const raw = new Database(DB_FILE);
  raw.query('delete from instances').run();
  raw.close();

  // 22 sessions that stopped inside the last few minutes, and 3 that stopped
  // two hours ago — the shape of the machine that came back after 36 hours.
  const recent: string[] = [];
  for (let index = 0; index < 22; index++) {
    const id = `inst-recent-${String(index).padStart(2, '0')}`;
    openSession(id, `sess-${id}`);
    // Oldest first, so "newest first" has something to sort.
    backdate(id, (22 - index) * 60_000);
    recent.push(id);
  }
  const stale: string[] = [];
  for (let index = 0; index < 3; index++) {
    const id = `inst-stale-${index}`;
    openSession(id, `sess-${id}`);
    backdate(id, 2 * 60 * 60_000);
    stale.push(id);
  }

  const agent = await connect('/ws');
  agent.socket.send(
    JSON.stringify({
      verb: 'register',
      machineId: MACHINE,
      payload: {
        hostname: 'truth-box',
        os: 'linux',
        // The daemon carries nothing and can resume everything — the maximal
        // case for the old unbounded restore, which would send 25 spawns.
        instances: [],
        resumable: [...recent, ...stale].map((id) => `sess-${id}`),
      },
    })
  );
  await until(() => acked(agent, 'register'), 'the register ack');

  const spawned = spawnsIn(agent);
  expect(spawned.length).toBe(20);
  // Newest first: the 20 most recently-moved sessions, and none of the stale ones.
  expect(new Set(spawned)).toEqual(new Set(recent.slice(2)));
  for (const id of stale) expect(spawned).not.toContain(id);

  // A restored row is `starting`: the spawn is in flight, not confirmed.
  for (const id of recent.slice(2)) expect(statusOf(id)).toBe('starting');
  // And everything the bound excluded is asleep — listed, resumable, one wake
  // away, and emphatically not `error`.
  for (const id of [...recent.slice(0, 2), ...stale]) {
    expect(statusOf(id)).toBe('sleeping');
    expect(lastErrorOf(id)).toBeNull();
  }

  agent.close();
});

test('the boot sweep reclassifies the states the old taxonomy left behind, twice over', () => {
  const raw = new Database(DB_FILE);
  raw.query('delete from instances').run();
  raw.close();

  openSession('sweep-running', 'sess-sweep-running');
  openSession('sweep-starting', 'sess-sweep-starting');
  openSession('sweep-legacy', 'sess-sweep-legacy');
  openSession('sweep-stopped', 'sess-sweep-stopped');
  openSession('sweep-real-error', 'sess-sweep-real-error');
  // The state a live hub is in when it dies, and the two the old taxonomy wrote.
  const seed = new Database(DB_FILE);
  seed.query("update instances set status = 'running' where id = 'sweep-running'").run();
  seed
    .query("update instances set status = 'error', last_error = ? where id = 'sweep-legacy'")
    .run(RESTART_RESUMABLE);
  seed.query("update instances set status = 'stopped' where id = 'sweep-stopped'").run();
  seed
    .query("update instances set status = 'error', last_error = 'the harness exited 1' where id = 'sweep-real-error'")
    .run();
  seed.close();

  const first = db.sweepBootStatuses(RESTART_RESUMABLE);
  expect(first).toEqual({ toUnknown: 2, toSleeping: 1 });
  expect(statusOf('sweep-running')).toBe('unknown');
  expect(statusOf('sweep-starting')).toBe('unknown');
  // A restart was never a failure; it only had nowhere else to be filed.
  expect(statusOf('sweep-legacy')).toBe('sleeping');
  expect(lastErrorOf('sweep-legacy')).toBeNull();
  // A deliberate stop and an actual failure are facts, not artefacts.
  expect(statusOf('sweep-stopped')).toBe('stopped');
  expect(statusOf('sweep-real-error')).toBe('error');
  expect(lastErrorOf('sweep-real-error')).toBe('the harness exited 1');

  // Idempotent, which is what lets this be a boot step rather than a migration
  // somebody has to remember to run exactly once.
  const second = db.sweepBootStatuses(RESTART_RESUMABLE);
  expect(second).toEqual({ toUnknown: 0, toSleeping: 0 });
  expect(statusOf('sweep-running')).toBe('unknown');
  expect(statusOf('sweep-legacy')).toBe('sleeping');
  expect(statusOf('sweep-stopped')).toBe('stopped');
  expect(statusOf('sweep-real-error')).toBe('error');
});

test('a session on a machine the hub cannot reach reads unknown, and the column keeps history', async () => {
  const raw = new Database(DB_FILE);
  raw.query('delete from instances').run();
  raw.close();

  openSession('overlay-live', 'sess-overlay-live');
  openSession('overlay-stopped', 'sess-overlay-stopped');
  const agent = await connect('/ws');
  // Presence is the registry's: a socket the hub is holding is what makes the
  // overlay pass a stored status through rather than answering `unknown`.
  registry.registerAgent(MACHINE, { id: 'sock-truth', send: () => {} });
  await beat(agent, ['overlay-live']);
  expect(statusOf('overlay-live')).toBe('running');
  db.stopInstance('overlay-stopped');

  const held = (await readInstances()).find((row) => row.id === 'overlay-live');
  expect(held?.status).toBe('running');

  // The socket goes away without the database being told — a hub restart, a
  // crash, a daemon killed. Every stored `running` on that machine is now a
  // claim about a process nobody can see.
  registry.sockets.clear();
  agent.close();

  const served = await readInstances();
  expect(served.find((row) => row.id === 'overlay-live')?.status).toBe('unknown');
  // History survives the overlay: the column still says what last happened.
  expect(statusOf('overlay-live')).toBe('running');
  // And a session that was deliberately stopped is not made mysterious by an
  // unreachable machine — nothing about it is in question.
  expect(served.find((row) => row.id === 'overlay-stopped')?.status).toBe('stopped');
});

test('the instances frame carries the same derived status, plus pulses and hubBuild', async () => {
  const raw = new Database(DB_FILE);
  raw.query('delete from instances').run();
  raw.close();
  registry.sockets.clear();

  openSession('frame-live', 'sess-frame-live');
  const agent = await connect('/ws');
  registry.registerAgent(MACHINE, { id: 'sock-truth', send: () => {} });
  await beat(agent, ['frame-live']);

  const pulse: SessionPulse = {
    instanceId: 'frame-live',
    busy: true,
    activity: 'working',
    currentTool: { name: 'Bash', glance: 'bun test' },
    runningSubagents: 0,
    at: Date.now(),
  };
  agent.socket.send(
    JSON.stringify({
      verb: 'frames',
      machineId: MACHINE,
      instanceId: 'frame-live',
      payload: { kind: 'pulse', instanceId: 'frame-live', pulse },
    })
  );

  // The frame a dashboard is handed the moment it connects — the whole point of
  // retaining pulses is that this snapshot already knows what is working.
  const withSocket = await connect('/ws/dashboard');
  const first = await until(
    () =>
      withSocket.inbox.find(
        (message) =>
          message.verb === 'frames' &&
          (message.payload as { kind?: string; pulses?: Record<string, SessionPulse> }).pulses?.[
            'frame-live'
          ] !== undefined
      ) ?? undefined,
    'an opening frame carrying the pulse'
  );
  const payload = first.payload as {
    instances: InstanceRow[];
    pulses: Record<string, SessionPulse>;
    hubBuild?: { version: string };
  };
  expect(payload.pulses['frame-live']).toEqual(pulse);
  expect(payload.instances.find((row) => row.id === 'frame-live')?.status).toBe('running');
  expect(typeof payload.hubBuild?.version).toBe('string');
  withSocket.close();

  // Same drop, both emission points: the frame and the route cannot disagree,
  // because they go through one overlay.
  registry.sockets.clear();
  const dropped = await connect('/ws/dashboard');
  const after = await until(
    () => dropped.inbox.find((message) => message.verb === 'frames') ?? undefined,
    'the opening frame after the socket dropped'
  );
  const framed = (after.payload as { instances: InstanceRow[] }).instances;
  expect(framed.find((row) => row.id === 'frame-live')?.status).toBe('unknown');
  expect((await readInstances()).find((row) => row.id === 'frame-live')?.status).toBe('unknown');
  dropped.close();

  // And a dead session's pulse is dropped with it: a live reading that outlives
  // its process is the same stale-liveness lie, in memory instead of a column.
  registry.registerAgent(MACHINE, { id: 'sock-truth', send: () => {} });
  await beat(agent, []);
  expect(statusOf('frame-live')).toBe('sleeping');
  const later = await connect('/ws/dashboard');
  const settled = await until(
    () => later.inbox.find((message) => message.verb === 'frames') ?? undefined,
    'a frame after the session settled'
  );
  expect(
    (settled.payload as { pulses: Record<string, SessionPulse> }).pulses['frame-live']
  ).toBeUndefined();
  later.close();
  agent.close();
});

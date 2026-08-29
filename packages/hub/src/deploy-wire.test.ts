import { afterAll, expect, test } from 'bun:test';
import type { AgentRow } from '@cockpit/core';
import { makeDb } from './db';
import type { PendingShape } from './pending';
import type { HubSocket, RegistryShape } from './registry';
import { createServer } from './server';

/**
 * The deployment clone's state, end to end across the wire (leaf Y2).
 *
 * Leaf C1 built the watcher and leaf C2 built the board's reader, and for two
 * commits neither could see the other: the watcher reported to an injectable
 * callback and the dashboard read an `AgentRow.deploy` field that did not
 * exist, so update-pending never lit up and — the part that matters — a clone
 * that had DIVERGED and was refusing to deploy said so to a log file nobody
 * reads. This file is the statement that the trip now happens, and that
 * `diverged` survives it intact.
 *
 * A scratch database, for the reason every other suite here keeps one: `bun
 * test` runs every file in one process, so a shared path is a shared race.
 */
const DB_FILE = `/tmp/cockpit-deploy-wire-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

const MACHINE = 'machine-deploy';

const makeTestRegistry = (): RegistryShape => {
  const sockets = new Map<string, HubSocket>();
  const dashboards = new Map<string, { socket: HubSocket; subscriptions: Set<string> }>();
  const requesters = new Map<string, HubSocket>();
  return {
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

const app = createServer({ registry: makeTestRegistry(), db, pending }).listen(0);
const port = app.server?.port;

db.upsertAgent({ machineId: MACHINE, hostname: 'deploy-box', os: 'linux', auth: 'authenticated' });

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
    socket.addEventListener('error', () => reject(new Error(`could not open ${path}`)), { once: true });
  });
  return { socket, inbox, close: () => socket.close() };
};

const until = async <T>(read: () => T | undefined, what: string): Promise<T> => {
  for (let waited = 0; waited < 400; waited++) {
    const value = read();
    if (value !== undefined) return value;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const acked = (peer: Peer, verb: string, from = 0): Record<string, unknown> | undefined =>
  peer.inbox
    .slice(from)
    .find(
      (message) =>
        message.verb === verb && (message.payload as { ok?: unknown } | undefined)?.ok === true
    );

const register = async (peer: Peer, payload: Record<string, unknown>): Promise<void> => {
  const before = peer.inbox.length;
  peer.socket.send(JSON.stringify({ verb: 'register', machineId: MACHINE, payload }));
  await until(() => acked(peer, 'register', before), 'the register ack');
};

const beat = async (peer: Peer, payload: Record<string, unknown>): Promise<void> => {
  const before = peer.inbox.length;
  peer.socket.send(
    JSON.stringify({ verb: 'heartbeat', machineId: MACHINE, payload: { at: Date.now(), instances: [], ...payload } })
  );
  await until(() => acked(peer, 'heartbeat', before), 'the heartbeat ack');
};

const agentRow = async (): Promise<AgentRow> => {
  const response = await fetch(`http://localhost:${port}/api/agents`);
  expect(response.status).toBe(200);
  const rows = (await response.json()) as AgentRow[];
  const row = rows.find((candidate) => candidate.machineId === MACHINE);
  if (!row) throw new Error(`no ${MACHINE} in /api/agents`);
  return row;
};

const IDENTITY = { hostname: 'deploy-box', os: 'linux', auth: 'authenticated', instances: [] };

test('a daemon that says nothing about deployment leaves the field absent, not "current"', async () => {
  const peer = await connect('/ws');
  await register(peer, IDENTITY);
  const row = await agentRow();
  expect(row.deploy).toBeUndefined();
  expect('deploy' in row).toBe(false);
  peer.close();
});

test('a diverged clone reaches the board intact, refusal and all', async () => {
  const peer = await connect('/ws');
  const detail =
    '/home/op/.cockpit/app has DIVERGED from origin — 2 local commit(s) and 3 upstream, head aaa1111 vs bbb2222. Refusing to update: a reset here would destroy work nobody has a copy of. Resolve it by hand.';
  await register(peer, { ...IDENTITY, deploy: { kind: 'diverged', detail } });
  expect(await agentRow().then((row) => row.deploy)).toEqual({ kind: 'diverged', detail });
  peer.close();
});

test('the beat carries a state change, and republishes the board when it does', async () => {
  const peer = await connect('/ws');
  await register(peer, { ...IDENTITY, deploy: { kind: 'current', detail: 'level with origin at aaa1111' } });
  const board = await connect('/ws/dashboard');
  const framesBefore = board.inbox.length;

  // Nothing new to say: the same verdict must not cost every dashboard a frame.
  await beat(peer, { deploy: { kind: 'current', detail: 'level with origin at aaa1111' } });
  expect(board.inbox.length).toBe(framesBefore);

  await beat(peer, { deploy: { kind: 'behind', detail: '1 commit(s) behind origin' } });
  const frame = await until(
    () =>
      board.inbox
        .slice(framesBefore)
        .find((message) => (message.payload as { kind?: string } | undefined)?.kind === 'instances'),
    'the instances frame the deploy change publishes'
  );
  const agents = (frame.payload as { agents: AgentRow[] }).agents;
  expect(agents.find((row) => row.machineId === MACHINE)?.deploy?.kind).toBe('behind');

  board.close();
  peer.close();
});

test('a kind this hub does not know is dropped rather than passed through', async () => {
  const peer = await connect('/ws');
  await register(peer, { ...IDENTITY, deploy: { kind: 'liquefied', detail: 'from the future' } });
  expect(await agentRow().then((row) => row.deploy)).toBeUndefined();
  peer.close();
});

test('the verdict does not outlive the socket that asserted it', async () => {
  const peer = await connect('/ws');
  await register(peer, { ...IDENTITY, deploy: { kind: 'ahead', detail: '1 local commit origin does not have' } });
  expect(await agentRow().then((row) => row.deploy?.kind)).toBe('ahead');
  peer.close();
  // Polled rather than `until`ed: the read is async, and a promise is never
  // `undefined`, so a naive until() would pass without ever checking anything.
  let row = await agentRow();
  for (let waited = 0; waited < 400 && row.deploy !== undefined; waited++) {
    await Bun.sleep(5);
    row = await agentRow();
  }
  expect(row.deploy).toBeUndefined();
  expect(row.status).toBe('offline');
});

afterAll(() => {
  app.stop();
  db.close?.();
});

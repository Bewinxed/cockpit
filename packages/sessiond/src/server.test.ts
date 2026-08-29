/**
 * sessiond's tests drive a REAL daemon over a REAL unix socket with REAL
 * children — the failure modes this daemon exists to prevent (a dead pipe, a
 * bounced session, a spliced stream) are all failures of the actual process
 * and socket plumbing, and none of them reproduce against a mock.
 *
 * Children are `cat` and a tiny `node -e` emitter, never a harness: this
 * machine runs live sessions, and sessiond does not care what the child is —
 * which is exactly the property under test.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessiondServerMessage } from '@cockpit/core';
import { SessiondServer } from './server';

/** Every socket in this file lives in a scratch dir; never the real endpoint. */
const scratch = (): string => join(mkdtempSync(join(tmpdir(), 'sessiond-test-')), 'sessiond.sock');

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const startServer = async (): Promise<{ server: SessiondServer; endpoint: string }> => {
  const endpoint = scratch();
  const server = new SessiondServer();
  await server.listen(endpoint);
  cleanups.push(async () => {
    await server.drain(200);
    await server.close();
  });
  return { server, endpoint };
};

/** A minimal agent: NDJSON in, NDJSON out, everything received kept. */
class Client {
  readonly received: SessiondServerMessage[] = [];
  #buffer = '';
  constructor(readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.#buffer += chunk;
      let nl = this.#buffer.indexOf('\n');
      while (nl >= 0) {
        this.received.push(JSON.parse(this.#buffer.slice(0, nl)) as SessiondServerMessage);
        this.#buffer = this.#buffer.slice(nl + 1);
        nl = this.#buffer.indexOf('\n');
      }
    });
  }
  send(message: unknown): void {
    this.socket.write(`${JSON.stringify(message)}\n`);
  }
  /** `T` is the narrowed shape the caller asserts against, not a constraint. */
  async waitFor<T>(
    match: (message: SessiondServerMessage) => boolean,
    label: string,
    from = 0,
  ): Promise<T> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const hit = this.received.slice(from).find((message) => match(message));
      if (hit) return hit as T;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${label}; saw ${JSON.stringify(this.received)}`);
      }
      await Bun.sleep(10);
    }
  }
  lines(procId: string): Array<{ seq: number; data: string }> {
    return this.received.flatMap((message) =>
      message.type === 'proc.line' && message.event.procId === procId
        ? [{ seq: message.event.seq, data: message.event.data }]
        : [],
    );
  }
}

const connect = async (endpoint: string): Promise<Client> => {
  const socket = createConnection(endpoint);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const client = new Client(socket);
  cleanups.push(() => void socket.destroy());
  await client.waitFor((message) => message.type === 'welcome', 'welcome');
  return client;
};

const catSpec = { command: 'cat', args: [] };
const emitSpec = (count: number) => ({
  command: process.execPath,
  args: ['-e', `for (let i = 1; i <= ${count}; i++) console.log('line ' + i)`],
});

describe('sessiond verbs', () => {
  test('G1: spawn/write/subscribe/list/stdin_end round-trip against a real child', async () => {
    const { endpoint } = await startServer();
    const client = await connect(endpoint);

    client.send({ type: 'spawn', commandId: 'c1', procId: 'p1', spec: catSpec });
    const spawned = await client.waitFor(
      (m) => m.type === 'ack' && m.commandId === 'c1',
      'spawn ack',
    );
    expect(spawned).toMatchObject({ stage: 'applied' });

    client.send({ type: 'subscribe', procId: 'p1' });
    await client.waitFor((m) => m.type === 'proc.backlog', 'empty backlog');

    client.send({ type: 'write', commandId: 'c2', procId: 'p1', data: 'alpha\nbeta\n' });
    await client.waitFor((m) => m.type === 'ack' && m.commandId === 'c2', 'write ack');
    await client.waitFor(
      (m) => m.type === 'proc.line' && m.event.data === 'beta',
      'second line back',
    );
    // Monotonic, one seq per line, in order.
    expect(client.lines('p1')).toEqual([
      { seq: 1, data: 'alpha' },
      { seq: 2, data: 'beta' },
    ]);

    const beforeList = client.received.length;
    client.send({ type: 'list' });
    const listed = await client.waitFor<{ type: 'welcome'; procs: unknown[] }>(
      (m) => m.type === 'welcome',
      'list welcome',
      beforeList,
    );
    expect(listed.procs).toMatchObject([{ procId: 'p1', alive: true, head: 2 }]);
    expect((listed.procs[0] as { pid: number }).pid).toBeGreaterThan(0);

    // stdin_end is the graceful path: `cat` sees EOF and exits 0 on its own.
    client.send({ type: 'stdin_end', commandId: 'c3', procId: 'p1' });
    const exit = await client.waitFor<{ exitCode: number }>(
      (m) => m.type === 'proc.exit' && m.procId === 'p1',
      'exit after stdin_end',
    );
    expect(exit.exitCode).toBe(0);
  });

  test('G1b: signal kills a child that would otherwise run forever', async () => {
    const { endpoint } = await startServer();
    const client = await connect(endpoint);
    client.send({
      type: 'spawn',
      commandId: 's1',
      procId: 'sleeper',
      spec: { command: 'sleep', args: ['120'] },
    });
    await client.waitFor((m) => m.type === 'ack' && m.commandId === 's1', 'spawn ack');
    client.send({ type: 'signal', commandId: 's2', procId: 'sleeper', sig: 'SIGKILL' });
    const exit = await client.waitFor<{ signal: string | null }>(
      (m) => m.type === 'proc.exit' && m.procId === 'sleeper',
      'exit after signal',
    );
    expect(exit.signal).toBe('SIGKILL');
  });

  test('G2: ring overflow answers a stale cursor with reset, never a spliced stream', async () => {
    const { endpoint } = await startServer();
    const client = await connect(endpoint);
    // 5000 lines overflows any replay window this daemon has been configured
    // with (512 today, the 4096 the design budgets for) several times over.
    client.send({ type: 'spawn', commandId: 'o1', procId: 'flood', spec: emitSpec(5000) });
    await client.waitFor((m) => m.type === 'ack' && m.commandId === 'o1', 'spawn ack');
    await client.waitFor((m) => m.type === 'proc.exit' && m.procId === 'flood', 'flood exit');

    // A cursor from the very beginning is long gone.
    client.send({ type: 'subscribe', procId: 'flood', afterSeq: 1 });
    const reset = await client.waitFor<{ nextSeq: number }>(
      (m) => m.type === 'proc.reset' && m.procId === 'flood',
      'reset for stale cursor',
    );
    expect(reset.nextSeq).toBe(5001);
    // The refusal is total: not one line was handed back as if the gap had
    // been covered.
    expect(client.received.some((m) => m.type === 'proc.backlog')).toBe(false);

    // A cursor still inside the window replays whole, from the same daemon.
    client.send({ type: 'subscribe', procId: 'flood', afterSeq: 4998 });
    const backlog = await client.waitFor<{ events: Array<{ seq: number; data: string }> }>(
      (m) => m.type === 'proc.backlog' && m.procId === 'flood',
      'fresh-cursor backlog',
    );
    expect(backlog.events.map((event) => event.seq)).toEqual([4999, 5000]);
    expect(backlog.events[1]?.data).toBe('line 5000');
  });

  test('G3: a re-delivered commandId is re-acked, not re-executed', async () => {
    const { server, endpoint } = await startServer();
    const client = await connect(endpoint);
    client.send({ type: 'spawn', commandId: 'dup', procId: 'once', spec: catSpec });
    await client.waitFor((m) => m.type === 'ack' && m.commandId === 'dup', 'first ack');
    const firstPid = server.procs()[0]?.pid;

    // The retry an agent makes after a socket drop, verbatim.
    client.send({ type: 'spawn', commandId: 'dup', procId: 'once', spec: catSpec });
    await Bun.sleep(150);
    const acks = client.received.filter((m) => m.type === 'ack' && m.commandId === 'dup');
    expect(acks).toHaveLength(2);
    expect(acks[1]).toEqual(acks[0]!);
    // Child count stays 1, and it is the SAME child — not a kill-and-replace.
    expect(server.procs()).toHaveLength(1);
    expect(server.procs()[0]?.pid).toBe(firstPid!);
    expect(server.procs()[0]?.alive).toBe(true);

    // Same for `write`: the model must not be fed the same turn twice.
    client.send({ type: 'subscribe', procId: 'once' });
    client.send({ type: 'write', commandId: 'w1', procId: 'once', data: 'only-once\n' });
    await client.waitFor((m) => m.type === 'proc.line', 'echo');
    client.send({ type: 'write', commandId: 'w1', procId: 'once', data: 'only-once\n' });
    await Bun.sleep(150);
    expect(client.lines('once')).toEqual([{ seq: 1, data: 'only-once' }]);
  });

  test('G4: children survive a socket drop and the backlog replays gap-free from afterSeq', async () => {
    const { server, endpoint } = await startServer();
    const first = await connect(endpoint);
    first.send({ type: 'spawn', commandId: 'k1', procId: 'keep', spec: catSpec });
    await first.waitFor((m) => m.type === 'ack' && m.commandId === 'k1', 'spawn ack');
    first.send({ type: 'subscribe', procId: 'keep' });
    first.send({ type: 'write', commandId: 'k2', procId: 'keep', data: 'a\nb\nc\n' });
    await first.waitFor((m) => m.type === 'proc.line' && m.event.seq === 3, 'three lines');
    const pid = server.procs()[0]?.pid;

    // The agent dies mid-session — a deploy, a crash, an OOM.
    first.socket.destroy();
    await Bun.sleep(100);
    expect(server.procs()[0]?.alive).toBe(true);
    expect(server.procs()[0]?.pid).toBe(pid!);

    // A fresh agent attaches, and the child is simply still there.
    const second = await connect(endpoint);
    second.send({ type: 'write', commandId: 'k3', procId: 'keep', data: 'd\ne\n' });
    await second.waitFor((m) => m.type === 'ack' && m.commandId === 'k3', 'write ack');
    await Bun.sleep(100);
    second.send({ type: 'subscribe', procId: 'keep', afterSeq: 3 });
    const backlog = await second.waitFor<{ events: Array<{ seq: number; data: string }> }>(
      (m) => m.type === 'proc.backlog' && m.procId === 'keep',
      'gap-free backlog',
    );
    expect(backlog.events.map((event) => [event.seq, event.data])).toEqual([
      [4, 'd'],
      [5, 'e'],
    ]);

    // And the stream continues from where the backlog stopped, no duplicates.
    second.send({ type: 'write', commandId: 'k4', procId: 'keep', data: 'f\n' });
    const live = await second.waitFor<{ event: { seq: number } }>(
      (m) => m.type === 'proc.line' && m.event.data === 'f',
      'live line after replay',
    );
    expect(live.event.seq).toBe(6);
  });

  test('G5: an unknown message type is answered `unsupported` and the connection stays open', async () => {
    const { endpoint } = await startServer();
    const client = await connect(endpoint);
    // Exactly the shape of a future agent probing a months-old sessiond.
    client.send({ type: 'teleport', commandId: 'u1', procId: 'nope' });
    const nack = await client.waitFor<{ stage: string; reason?: string }>(
      (m) => m.type === 'ack' && m.commandId === 'u1',
      'unsupported ack',
    );
    expect(nack.stage).toBe('failed');
    expect(nack.reason).toBe('unsupported: teleport');
    expect(client.socket.destroyed).toBe(false);

    // The connection is not merely open, it still works.
    client.send({ type: 'spawn', commandId: 'u2', procId: 'after', spec: catSpec });
    const ack = await client.waitFor<{ stage: string }>(
      (m) => m.type === 'ack' && m.commandId === 'u2',
      'spawn ack after unsupported',
    );
    expect(ack.stage).toBe('applied');
  });
});

describe('sessiond socket and drain', () => {
  test('the socket is 0600 inside a 0700 directory', async () => {
    const { endpoint } = await startServer();
    expect(statSync(endpoint).mode & 0o777).toBe(0o600);
    expect(statSync(join(endpoint, '..')).mode & 0o777).toBe(0o700);
  });

  test('a stale socket file is probed, then unlinked', async () => {
    const endpoint = scratch();
    // A crashed predecessor's leftover: the file exists, nothing answers.
    const corpse = createServer();
    await new Promise<void>((resolve) => corpse.listen(endpoint, resolve));
    await new Promise<void>((resolve) => corpse.close(() => resolve()));
    // node unlinks on clean close, so re-create the file the crash would leave.
    await Bun.write(endpoint, '');

    const server = new SessiondServer();
    await server.listen(endpoint);
    cleanups.push(() => server.close());
    const client = await connect(endpoint);
    expect(client.received[0]).toMatchObject({ type: 'welcome' });
  });

  test('a live sessiond is not evicted by a second one', async () => {
    const { endpoint } = await startServer();
    const intruder = new SessiondServer();
    await expect(intruder.listen(endpoint)).rejects.toThrow(/already listening/);
  });

  test('drain is stdin-EOF, then grace, then SIGKILL', async () => {
    const { server, endpoint } = await startServer();
    const client = await connect(endpoint);
    // `cat` takes the EOF and exits inside the grace window.
    client.send({ type: 'spawn', commandId: 'd1', procId: 'polite', spec: catSpec });
    // `sleep` ignores stdin entirely and must be killed.
    client.send({
      type: 'spawn',
      commandId: 'd2',
      procId: 'stubborn',
      spec: { command: 'sleep', args: ['120'] },
    });
    await client.waitFor((m) => m.type === 'ack' && m.commandId === 'd2', 'spawn acks');

    await server.drain(500);
    const polite = await client.waitFor<{ exitCode: number | null; signal: string | null }>(
      (m) => m.type === 'proc.exit' && m.procId === 'polite',
      'polite exit',
    );
    const stubborn = await client.waitFor<{ signal: string | null }>(
      (m) => m.type === 'proc.exit' && m.procId === 'stubborn',
      'stubborn exit',
    );
    expect(polite.exitCode).toBe(0);
    expect(polite.signal).toBeNull();
    expect(stubborn.signal).toBe('SIGKILL');
    expect(server.procs().every((proc) => !proc.alive)).toBe(true);
  });
});

/**
 * THE REATTACH, against a REAL sessiond in a REAL separate process.
 *
 * This is the glue leaf D2 named and left: `SessionSupervisor.reattach` driven
 * by the ingest ledger the hub hands back on its register ack (design §7). The
 * three behaviours proved here are the ones a model cannot prove, because they
 * live in the seam between the supervisor, the claude adapter's `adopt`, and a
 * daemon holding a pipe in another process:
 *
 *  - a stale-epoch mark replays NOTHING and follows from head (the honest-loss
 *    rule) — and the same for an ack that carries no ledger at all;
 *  - a ring that overflowed while the agent was away produces a
 *    `sessiond_stream_gap` frame in the transcript, never a silent splice;
 *  - a usable mark replays exactly the gap the hub named, in order.
 *
 * SAFETY, the same rules leaf D2's suite states: the children are scripted node
 * emitters, never a harness and NEVER `claude` — this machine runs the
 * operator's live sessions. The endpoint is a scratch path under `tmpdir()`;
 * `sessiondEndpoint()`, the real one, is never bound. The emitter never writes
 * a `result` line, which is the line that would arm the boundary hand-off and
 * ask the supervisor to spawn a real SDK session.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FramePayload, FrameProvenance } from '@cockpit/core';
import { SessiondClient, probeEndpoint } from './sessiond-client';
import { SessionSupervisor } from './session';

const dir = mkdtempSync(join(tmpdir(), 'reattach-ledger-'));
const endpoint = join(dir, 'sessiond.sock');
let daemon: ChildProcess;
let client: SessiondClient;
let epoch: string;

/**
 * A child that emits on demand: a burst at startup, then exactly as many more
 * lines as a number written to its stdin asks for. On-demand rather than on a
 * timer so "nothing was replayed" is an assertion about the code and not about
 * how fast a clock happened to tick.
 */
const emitterPath = join(dir, 'emitter.mjs');
writeFileSync(
  emitterPath,
  [
    'let n = 0;',
    "const emit = () => process.stdout.write(JSON.stringify({ type: 'system', subtype: 'note', n: ++n }) + '\\n');",
    'for (let i = 0; i < Number(process.argv[2] ?? 1); i++) emit();',
    "let buffer = '';",
    "process.stdin.on('data', (chunk) => {",
    '  buffer += chunk;',
    '  let nl = buffer.indexOf(String.fromCharCode(10));',
    '  while (nl >= 0) {',
    '    const asked = Number(buffer.slice(0, nl).trim() || 1);',
    '    buffer = buffer.slice(nl + 1);',
    '    for (let i = 0; i < asked; i++) emit();',
    '    nl = buffer.indexOf(String.fromCharCode(10));',
    '  }',
    '});',
    'process.stdin.resume();',
    "process.stdin.on('end', () => process.exit(0));",
  ].join('\n')
);

const spawned: string[] = [];

beforeAll(async () => {
  // Both halves point at the scratch socket: the adapter reads this env var for
  // exactly this reason (`claude.ts`'s `sessiond()`).
  process.env.COCKPIT_SESSIOND_ENDPOINT = endpoint;
  const main = join(import.meta.dir, '..', '..', 'sessiond', 'src', 'main.ts');
  daemon = spawn(process.execPath, [main], {
    env: { ...process.env, COCKPIT_SESSIOND_ENDPOINT: endpoint },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !(await probeEndpoint(endpoint, 200))) await Bun.sleep(25);
  client = await SessiondClient.connect(endpoint);
  epoch = client.epoch!;
  expect(epoch).toBeTruthy();
});

afterAll(async () => {
  // The children are killed BEFORE the daemon, so nothing is orphaned onto a
  // machine full of the operator's real work.
  for (const procId of spawned) await client.signal(procId, 'SIGKILL').catch(() => {});
  await Bun.sleep(50);
  client.close();
  daemon.kill('SIGKILL');
});

const startChild = async (procId: string, burst: number): Promise<void> => {
  spawned.push(procId);
  // `cwd` is part of the spec sessiond echoes back, and what a reattach needs
  // to adopt a survivor the hub never named. The scratch dir is where these
  // children belong anyway.
  await client.spawnProc(procId, {
    command: process.execPath,
    args: [emitterPath, String(burst)],
    cwd: dir,
  });
};

/** Ask the child for more lines, through sessiond, exactly as the agent would. */
const askFor = (procId: string, lines: number): Promise<void> => client.write(procId, `${lines}\n`);

/** What the daemon's socket writer would put on the wire, captured instead. */
type Sunk = Exclude<FramePayload, { kind: 'instances' }> & Partial<FrameProvenance>;

const supervisorWatching = (sink: Sunk[]): SessionSupervisor => {
  const supervisor = new SessionSupervisor();
  supervisor.sink = (frame) => sink.push(frame as Sunk);
  return supervisor;
};

const noteOf = (frame: Sunk): number | undefined => {
  if (frame.kind !== 'frame') return undefined;
  return (frame.message as unknown as { n?: number }).n;
};

/** The neutral message a frame carries, read structurally. */
const messageOf = (frame: Sunk): { subtype?: string; text?: string } =>
  frame.kind === 'frame' ? (frame.message as unknown as { subtype?: string; text?: string }) : {};

const waitFor = async (predicate: () => boolean | Promise<boolean>, why: string): Promise<void> => {
  for (let waited = 0; waited < 400; waited++) {
    if (await predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${why}`);
};

/** The ring's head for a child, straight from the daemon. */
const headOf = async (procId: string): Promise<number> =>
  (await client.list()).procs.find((proc) => proc.procId === procId)?.head ?? 0;

/** How far the ring's head has to be pushed to guarantee it dropped line 1. */
const OVERFLOW_LINES = 4200; // > SESSIOND_RING_LINES (4096, design §6)

test('a stale-epoch mark replays nothing and follows from head', async () => {
  const procId = `honest-loss-${crypto.randomUUID()}`;
  await startChild(procId, 6);
  await Bun.sleep(150);

  const sunk: Sunk[] = [];
  const supervisor = supervisorWatching(sunk);
  // A mark minted under a sessiond that has since restarted. Its seqs name
  // lines that no longer exist, so the only honest answer is to replay none.
  const adopted = await supervisor.reattachFrom(
    { ok: true, ingested: { [procId]: { epoch: crypto.randomUUID(), srcSeq: 1 } } },
    [{ instanceId: procId, cwd: dir, sessionId: null }]
  );
  expect(adopted).toEqual([procId]);

  await Bun.sleep(200);
  // Nothing from before the reattach. Not one line invented, not one replayed.
  expect(sunk.filter((frame) => noteOf(frame) !== undefined)).toEqual([]);

  // And it IS following: the next line the child writes arrives.
  await askFor(procId, 2);
  await waitFor(() => sunk.filter((f) => noteOf(f) !== undefined).length === 2, 'the live lines');
  expect(sunk.map(noteOf).filter((n) => n !== undefined)).toEqual([7, 8]);
}, 30_000);

test('an ack with no ingested field is tolerated: the agent follows from head', async () => {
  const procId = `old-ack-${crypto.randomUUID()}`;
  await startChild(procId, 5);
  await Bun.sleep(150);

  const sunk: Sunk[] = [];
  const supervisor = supervisorWatching(sunk);
  // THE OLD SHAPE, verbatim: what every hub before this leaf sends back.
  const adopted = await supervisor.reattachFrom({ ok: true }, [
    { instanceId: procId, cwd: dir, sessionId: null },
  ]);
  expect(adopted).toEqual([procId]);

  await Bun.sleep(200);
  expect(sunk.filter((frame) => noteOf(frame) !== undefined)).toEqual([]);
  await askFor(procId, 1);
  await waitFor(() => sunk.some((f) => noteOf(f) === 6), 'the first live line after an old-shape ack');
}, 30_000);

test('a usable mark replays exactly the gap the hub named, in order', async () => {
  const procId = `replay-${crypto.randomUUID()}`;
  await startChild(procId, 9);
  await Bun.sleep(200);

  const sunk: Sunk[] = [];
  const supervisor = supervisorWatching(sunk);
  // The hub says: I have your first four lines of this epoch. Lines 5..9 were
  // written while the agent was dead, and they are exactly what comes back.
  const adopted = await supervisor.reattachFrom({ ok: true, ingested: { [procId]: { epoch, srcSeq: 4 } } }, [
    { instanceId: procId, cwd: dir, sessionId: null },
  ]);
  expect(adopted).toEqual([procId]);

  await waitFor(() => sunk.filter((f) => noteOf(f) !== undefined).length >= 5, 'the replayed backlog');
  await Bun.sleep(100);
  expect(sunk.map(noteOf).filter((n) => n !== undefined)).toEqual([5, 6, 7, 8, 9]);
}, 30_000);

test('a ring that overflowed during the absence lands a sessiond_stream_gap frame, not a splice', async () => {
  const procId = `overflow-${crypto.randomUUID()}`;
  await startChild(procId, 4);
  await Bun.sleep(150);
  // THE ABSENCE, longer than the ring: the mark the hub is about to hand over
  // names a line sessiond has already dropped.
  await askFor(procId, OVERFLOW_LINES);
  // Waited on the daemon's own head rather than on a clock: the ring must
  // actually have passed the mark, or this test proves nothing.
  await waitFor(async () => (await headOf(procId)) > OVERFLOW_LINES, 'the ring to outrun the mark');

  const sunk: Sunk[] = [];
  const supervisor = supervisorWatching(sunk);
  await supervisor.reattachFrom({ ok: true, ingested: { [procId]: { epoch, srcSeq: 2 } } }, [
    { instanceId: procId, cwd: dir, sessionId: null },
  ]);

  await waitFor(
    () =>
      sunk.some((frame) => messageOf(frame).subtype === 'sessiond_stream_gap'),
    'the announced seam'
  );
  const seam = sunk.find((frame) => messageOf(frame).subtype === 'sessiond_stream_gap')!;
  // It says where the seam is, so the operator reads a hole rather than a
  // transcript that quietly skipped four thousand lines.
  expect(messageOf(seam).text).toMatch(/resumes at line \d+/);
  // And no line from before the seam was replayed as if it were current.
  expect(sunk.filter((frame) => noteOf(frame) !== undefined)).toEqual([]);
}, 60_000);

/**
 * THE RESTART, end to end: the property sessiond exists to provide.
 *
 * The daemon's shutdown used to stop every session it held. `stop()` ends the
 * child's stdin and a claude that loses stdin exits, so every deploy — and the
 * deploy path restarts this daemon on every push to main — killed the sessions
 * sessiond was keeping alive one process away. Detaching drops the bookkeeping
 * and leaves the child; the next daemon reattaches to it.
 */
test('detach leaves the child running, and the next daemon adopts it', async () => {
  const procId = `detach-${crypto.randomUUID()}`;
  await startChild(procId, 2);
  await Bun.sleep(150);

  const before: Sunk[] = [];
  const outgoing = supervisorWatching(before);
  expect(
    await outgoing.reattachFrom({ ok: true }, [{ instanceId: procId, cwd: dir, sessionId: null }])
  ).toEqual([procId]);
  expect(outgoing.instanceIds).toEqual([procId]);

  // The restart.
  outgoing.detach();
  expect(outgoing.instanceIds).toEqual([]);
  await Bun.sleep(200);

  // The child is still there. This is the whole assertion.
  expect((await client.list()).procs.find((proc) => proc.procId === procId)?.alive).toBe(true);

  // And it is still usable: the next daemon adopts it and hears what it says.
  const after: Sunk[] = [];
  const incoming = supervisorWatching(after);
  expect(
    await incoming.reattachFrom({ ok: true }, [{ instanceId: procId, cwd: dir, sessionId: null }])
  ).toEqual([procId]);
  await askFor(procId, 1);
  await waitFor(() => after.some((frame) => noteOf(frame) !== undefined), 'a line after the restart');
}, 30_000);

/**
 * A survivor the hub never named is still this machine's to carry.
 *
 * The hub restores from its own rows, so a session it has written off — no
 * `sessionId` to resume, therefore not restorable — was never handed to the
 * reattach, and its child went on running with nobody pumping it. `survivors`
 * is the machine's own answer, read straight off sessiond.
 */
test('survivors reports what sessiond holds, with the cwd needed to adopt it', async () => {
  const procId = `survivor-${crypto.randomUUID()}`;
  await startChild(procId, 1);
  await Bun.sleep(150);

  const supervisor = supervisorWatching([]);
  const found = (await supervisor.survivors()).find((row) => row.instanceId === procId);
  expect(found).toBeDefined();
  // The cwd is what makes it adoptable at all — sessiond echoes back the spec's.
  expect(found?.cwd).toBe(dir);

  // Adoptable on exactly that row, with no help from the hub.
  expect(await supervisor.reattachFrom({ ok: true }, [found!])).toEqual([procId]);
  // And once carried, it is no longer an unclaimed survivor.
  expect((await supervisor.survivors()).some((row) => row.instanceId === procId)).toBe(false);
}, 30_000);

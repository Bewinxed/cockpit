import { afterAll, expect, test } from 'bun:test';
import { Effect } from 'effect';

/**
 * A scratch database, so the fleet's own `cockpit.db` is never what a test
 * writes to. Set before the module is loaded, because `DB_PATH` is read once.
 */
const DB_FILE = `/tmp/cockpit-instance-title-${crypto.randomUUID()}.db`;
process.env.COCKPIT_DB_PATH = DB_FILE;

const { Db, DbLayer } = await import('./db');
const db = await Effect.runPromise(
  Effect.provide(
    Effect.gen(function* () {
      return yield* Db;
    }),
    DbLayer
  )
);

afterAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    await Bun.file(`${DB_FILE}${suffix}`).delete().catch(() => {});
  }
});

const MACHINE = 'machine-1';
db.upsertAgent({ machineId: MACHINE, hostname: 'box', os: 'linux', auth: 'authenticated' });

const rowOf = (id: string) => db.listInstances().find((row) => row.id === id);

test("a delegate's spawn title is what the listing reads back", () => {
  db.openInstance({
    id: 'delegate-1',
    machineId: MACHINE,
    cwd: '/home/o/cockpit',
    parentInstanceId: 'parent-1',
    title: 'Carry the delegate brief headline end to end',
    kind: 'scratch',
  });

  expect(rowOf('delegate-1')?.title).toBe('Carry the delegate brief headline end to end');
});

test('a spawn with no title leaves the row untitled', () => {
  db.openInstance({ id: 'plain-1', machineId: MACHINE, cwd: '/home/o/cockpit', kind: 'mainline' });

  expect(rowOf('plain-1')?.title).toBeNull();
});

test('re-opening a titled row — a restore — keeps the title it already had', () => {
  db.openInstance({
    id: 'delegate-1',
    machineId: MACHINE,
    cwd: '/home/o/cockpit',
    parentInstanceId: 'parent-1',
    kind: 'scratch',
  });

  expect(rowOf('delegate-1')?.title).toBe('Carry the delegate brief headline end to end');
});

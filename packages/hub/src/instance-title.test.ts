import { afterAll, expect, test } from 'bun:test';
import { makeDb } from './db';

/**
 * A scratch database, so the fleet's own `cockpit.db` is never what a test
 * writes to.
 *
 * The path is named rather than set through `COCKPIT_DB_PATH`. `DB_PATH` is
 * read once, when `../config` is first imported, and `bun test` runs every file
 * in one process — so the variable only worked for whichever test won the race
 * to import it, and the losers wrote a stray `cockpit.db` into the repo root.
 */
const DB_FILE = `/tmp/cockpit-instance-title-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

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

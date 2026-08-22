import { afterAll, expect, test } from 'bun:test';
import { deriveTitleFromFirstMessage } from '@cockpit/core';
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

test('a session nobody named is called after what it was first asked', () => {
  db.noteDerivedTitle('plain-1', deriveTitleFromFirstMessage('  Fix the tab strip\n\nplease  '));

  // The listing answers with it, so the first server render already has the
  // name and no label changes once the transcript loads.
  expect(rowOf('plain-1')?.title).toBe('Fix the tab strip please');
  expect(rowOf('plain-1')?.derivedTitle).toBe('Fix the tab strip please');
});

test('a derived name is written once and never rewritten', () => {
  expect(db.noteDerivedTitle('plain-1', 'Something it said later')).toBe(false);

  expect(rowOf('plain-1')?.title).toBe('Fix the tab strip please');
});

test("a spawn title outranks the first message: the derived name is never written over it", () => {
  expect(db.noteDerivedTitle('delegate-1', 'Whatever the delegate was first told')).toBe(false);

  expect(rowOf('delegate-1')?.title).toBe('Carry the delegate brief headline end to end');
  expect(rowOf('delegate-1')?.derivedTitle).toBeNull();
});

test('a slash command names the session by the command, not its markup echo', () => {
  db.openInstance({ id: 'slash-1', machineId: MACHINE, cwd: '/home/o/cockpit', kind: 'mainline' });
  db.noteDerivedTitle(
    'slash-1',
    deriveTitleFromFirstMessage(
      '<command-message>review is running…</command-message><command-name>/review</command-name>'
    )
  );

  expect(rowOf('slash-1')?.title).toBe('review is running…');
});

test('a first message longer than the limit is cut, not stored whole', () => {
  db.openInstance({ id: 'long-1', machineId: MACHINE, cwd: '/home/o/cockpit', kind: 'mainline' });
  db.noteDerivedTitle('long-1', deriveTitleFromFirstMessage('x'.repeat(200)));

  expect(rowOf('long-1')?.title).toBe('x'.repeat(80));
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

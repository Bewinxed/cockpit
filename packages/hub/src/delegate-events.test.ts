import { afterAll, expect, test } from 'bun:test';
import { makeDb } from './db';

/**
 * A scratch database, so the fleet's own `whiffle.db` is never what a test
 * writes to.
 *
 * The path is named rather than set through `WHIFFLE_DB_PATH`. `DB_PATH` is
 * read once, when `../config` is first imported, and `bun test` runs every file
 * in one process — so the variable only worked for whichever test won the race
 * to import it, and the losers wrote a stray `whiffle.db` into the repo root.
 */
const DB_FILE = `/tmp/whiffle-delegate-events-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

afterAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    await Bun.file(`${DB_FILE}${suffix}`).delete().catch(() => {});
  }
});

const PARENT = 'parent-1';
const DELEGATE = 'delegate-1';

const ask = (requestId: string, instanceId = DELEGATE) =>
  db.recordDelegateEvent({
    instanceId,
    parentInstanceId: PARENT,
    kind: 'ask',
    requestId,
    toolName: 'Bash',
    requestKind: 'tool',
    payload: { input: { command: 'rm -rf build' } },
    status: 'pending',
  });

test('an ask is filed against its parent, pending, with the input it asked about', () => {
  const row = ask('req-pending');

  expect(row.kind).toBe('ask');
  expect(row.status).toBe('pending');
  expect(row.parentInstanceId).toBe(PARENT);
  expect(row.toolName).toBe('Bash');
  expect(row.requestKind).toBe('tool');
  expect(row.payload).toEqual({ input: { command: 'rm -rf build' } });
});

test('an allow answers the ask it names, and is a row of its own', () => {
  ask('req-allow');
  db.recordDelegateEvent({
    instanceId: DELEGATE,
    parentInstanceId: PARENT,
    kind: 'answer',
    requestId: 'req-allow',
    payload: { behavior: 'allow', answers: { 'Which one?': 'the second' } },
  });
  db.settleDelegateAsk('req-allow', 'answered');

  expect(db.delegateAsk('req-allow')?.status).toBe('answered');
  const answer = db
    .listDelegateEvents({ instance: DELEGATE })
    .find((row) => row.kind === 'answer' && row.requestId === 'req-allow');
  expect(answer?.payload).toEqual({ behavior: 'allow', answers: { 'Which one?': 'the second' } });
});

test('a deny leaves the ask denied', () => {
  ask('req-deny');
  db.recordDelegateEvent({
    instanceId: DELEGATE,
    parentInstanceId: PARENT,
    kind: 'answer',
    requestId: 'req-deny',
    payload: { behavior: 'deny' },
  });
  db.settleDelegateAsk('req-deny', 'denied');

  expect(db.delegateAsk('req-deny')?.status).toBe('denied');
});

test('an answer to an ask nobody recorded is still stored, and closes nothing', () => {
  const answer = db.recordDelegateEvent({
    instanceId: DELEGATE,
    parentInstanceId: PARENT,
    kind: 'answer',
    requestId: 'req-unknown',
    payload: { behavior: 'allow' },
  });
  db.settleDelegateAsk('req-unknown', 'answered');

  expect(answer.status).toBeNull();
  expect(db.delegateAsk('req-unknown')).toBeUndefined();
});

test('a report carries the body that was delivered and whether the turn failed', () => {
  const row = db.recordDelegateEvent({
    instanceId: DELEGATE,
    parentInstanceId: PARENT,
    kind: 'report',
    payload: { body: 'the migration is applied', failed: false },
  });

  expect(row.kind).toBe('report');
  expect(row.requestId).toBeNull();
  expect(row.payload).toEqual({ body: 'the migration is applied', failed: false });
});

test('the two filters read the parent\'s whole traffic and one delegate\'s own', () => {
  const other = 'delegate-2';
  ask('req-other', other);
  db.recordDelegateEvent({
    instanceId: other,
    parentInstanceId: 'parent-2',
    kind: 'report',
    payload: { body: 'not this parent', failed: false },
  });

  const byParent = db.listDelegateEvents({ parent: PARENT });
  expect(byParent.every((row) => row.parentInstanceId === PARENT)).toBe(true);
  expect(byParent.map((row) => row.instanceId)).toContain(other);
  expect(byParent.map((row) => row.payload)).not.toContainEqual({
    body: 'not this parent',
    failed: false,
  });

  const byInstance = db.listDelegateEvents({ instance: DELEGATE });
  expect(byInstance.every((row) => row.instanceId === DELEGATE)).toBe(true);
  expect(byInstance.map((row) => row.requestId)).not.toContain('req-other');

  // Oldest first, on both reads.
  const ids = byParent.map((row) => row.id);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  expect(byInstance.map((row) => row.kind)[0]).toBe('ask');
});

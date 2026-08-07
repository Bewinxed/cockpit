import { expect, test } from 'bun:test';
import { memoryPlan } from './fleet';

/**
 * The user CLAUDE.md decision (NEW.md §11), row by row. Everything the daemon
 * does to `~/.claude/CLAUDE.md` comes out of these three hashes, so this is
 * where "cockpit overwrote what I wrote" is caught rather than on a machine.
 */
const FLEET = 'aaa';
const MINE = 'bbb';

test('a bare machine takes the fleet document', () => {
  expect(memoryPlan({ hash: FLEET }, null, undefined)).toBe('write');
});

test('an unmanaged file that already says it is taken over', () => {
  expect(memoryPlan({ hash: FLEET }, FLEET, undefined)).toBe('write');
});

test('an unmanaged file that says something else is never clobbered', () => {
  expect(memoryPlan({ hash: FLEET }, MINE, undefined)).toBe('drift');
  expect(memoryPlan({ hash: FLEET, force: true }, MINE, undefined)).toBe('write');
});

test('a managed file that is already the fleet document is left alone', () => {
  expect(memoryPlan({ hash: FLEET }, FLEET, FLEET)).toBe('skip');
});

test('a managed file the fleet has moved on from is rewritten', () => {
  expect(memoryPlan({ hash: FLEET }, MINE, MINE)).toBe('write');
});

test('a managed file edited on the machine drifts until somebody says', () => {
  expect(memoryPlan({ hash: FLEET }, MINE, FLEET)).toBe('drift');
  expect(memoryPlan({ hash: FLEET, force: true }, MINE, FLEET)).toBe('write');
});

test('the fleet keeping none takes back exactly what cockpit wrote', () => {
  expect(memoryPlan(null, FLEET, FLEET)).toBe('remove');
  expect(memoryPlan(undefined, FLEET, FLEET)).toBe('remove');
});

test('and leaves an edited one where it is', () => {
  expect(memoryPlan(null, MINE, FLEET)).toBe('unmanage');
});

test('a machine cockpit never wrote to has nothing to do', () => {
  expect(memoryPlan(null, MINE, undefined)).toBe('none');
  expect(memoryPlan(null, null, undefined)).toBe('none');
});

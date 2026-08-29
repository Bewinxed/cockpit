import { expect, test } from 'bun:test';
import { memoryDocProblem } from '@cockpit/core';
import { memoryPlan, memorySetPlan, withoutHooks } from './fleet';

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

/**
 * And the same decision across the set: the main file's rules held per path,
 * which is the whole of what makes one document safe to edit on a machine
 * without the other nine stopping.
 */
const OPUS = 'models/claude-opus-5.md';
const FABLE = 'models/claude-fable-5.md';

test('a bare machine takes every document of the set', () => {
  const plans = memorySetPlan(
    [
      { path: OPUS, hash: FLEET },
      { path: FABLE, hash: FLEET },
    ],
    {},
    {}
  );
  expect(plans).toEqual({ [OPUS]: 'write', [FABLE]: 'write' });
});

test('one document edited on the machine holds up itself and nothing else', () => {
  const desired = [
    { path: OPUS, hash: FLEET },
    { path: FABLE, hash: FLEET },
  ];
  const onDisk = { [OPUS]: MINE, [FABLE]: FLEET };
  const managed = { [OPUS]: FLEET, [FABLE]: FLEET };

  expect(memorySetPlan(desired, onDisk, managed)).toEqual({ [OPUS]: 'drift', [FABLE]: 'skip' });
  expect(memorySetPlan(desired.map((doc) => ({ ...doc, force: true })), onDisk, managed)).toEqual({
    [OPUS]: 'write',
    [FABLE]: 'skip',
  });
});

test('a document only the sidecar still names is given back, edited ones kept', () => {
  expect(memorySetPlan([], { [OPUS]: FLEET }, { [OPUS]: FLEET })).toEqual({ [OPUS]: 'remove' });
  expect(memorySetPlan([], { [OPUS]: MINE }, { [OPUS]: FLEET })).toEqual({ [OPUS]: 'unmanage' });
});

test('a hub that predates the set takes the whole set back', () => {
  // No `docs` on the config reaches the daemon as an empty desired list, and a
  // machine that has been converging on documents gives every one of them back.
  expect(memorySetPlan([], { [OPUS]: FLEET, [FABLE]: FLEET }, { [OPUS]: FLEET, [FABLE]: FLEET })).toEqual({
    [OPUS]: 'remove',
    [FABLE]: 'remove',
  });
});

test('a daemon that predates the set has no managed documents to lose', () => {
  // A sidecar written before the set names none, so the first sync that carries
  // one writes it and takes nothing away.
  expect(memorySetPlan([{ path: OPUS, hash: FLEET }], {}, {})).toEqual({ [OPUS]: 'write' });
});

test("a document somebody wrote by hand is never taken over silently", () => {
  expect(memorySetPlan([{ path: OPUS, hash: FLEET }], { [OPUS]: MINE }, {})).toEqual({
    [OPUS]: 'drift',
  });
  expect(memorySetPlan([{ path: OPUS, hash: FLEET, force: true }], { [OPUS]: MINE }, {})).toEqual({
    [OPUS]: 'write',
  });
});

/** What a document may be filed under — the hub's refusal and the daemon's. */
test('a document path is relative, forward-slashed markdown', () => {
  expect(memoryDocProblem('models/claude-opus-5.md')).toBeUndefined();
  expect(memoryDocProblem('house-rules.md')).toBeUndefined();
  for (const path of [
    'models/claude-opus-5',
    '/etc/passwd.md',
    '../../.bashrc.md',
    'models\\claude-opus-5.md',
    'models//claude-opus-5.md',
    '.ssh/config.md',
  ]) {
    expect(memoryDocProblem(path)).toBeString();
  }
});

/**
 * And the hook's half: `~/.claude/settings.json` is the user's own file, so
 * registering in it has to be something that can be undone without taking
 * anything of theirs with it.
 */
const OURS = '/home/x/.claude/cockpit-model-memory.sh';

test('removing the hook leaves every other hook where it is', () => {
  const theirs = { hooks: [{ type: 'command', command: '/home/x/bin/notify' }] };
  expect(withoutHooks([theirs, { hooks: [{ type: 'command', command: OURS }] }], [OURS])).toEqual([theirs]);
});

test('a matcher that held ours and theirs keeps theirs', () => {
  expect(
    withoutHooks(
      [{ matcher: 'startup', hooks: [{ command: OURS }, { command: '/home/x/bin/notify' }] }],
      [OURS]
    )
  ).toEqual([{ matcher: 'startup', hooks: [{ command: '/home/x/bin/notify' }] }]);
});

test('a machine with no hooks of ours is not rewritten', () => {
  const theirs = [{ hooks: [{ command: '/home/x/bin/notify' }] }];
  expect(withoutHooks(theirs, [OURS])).toEqual(theirs);
});

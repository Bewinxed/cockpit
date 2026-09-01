import { expect, test } from 'bun:test';
import type { AvailableCommand } from '@whiffle/core';
import {
  commandAt,
  displayName,
  filterCommands,
  groupCommands,
  insertCommand,
  orderCommands,
} from './command-groups';

const builtin = (name: string): AvailableCommand => ({ name, type: 'builtin' });

const plugin = (source: string, leaf: string): AvailableCommand => ({
  name: `${source}:${leaf}`,
  type: 'skill',
  source,
});

const prompt = (server: string, leaf: string): AvailableCommand => ({
  name: `mcp__${server}__${leaf}`,
  type: 'mcp',
  source: server,
});

test('a list with no namespaces keeps the order it arrived in', () => {
  const commands = [builtin('review'), builtin('agents'), builtin('init')];
  expect(orderCommands(commands).map((cmd) => cmd.name)).toEqual([
    'review',
    'agents',
    'init',
  ]);
});

test('unnamespaced first, then plugins alphabetically, then MCP servers', () => {
  const ordered = orderCommands([
    prompt('whiffle', 'handoff'),
    plugin('interfaces', 'better-ui'),
    builtin('review'),
    plugin('mattpocock-skills', 'tdd'),
    builtin('agents'),
    plugin('interfaces', 'better-colors'),
    prompt('gmail', 'draft'),
  ]);

  expect(ordered.map((cmd) => cmd.name)).toEqual([
    'review',
    'agents',
    'interfaces:better-colors',
    'interfaces:better-ui',
    'mattpocock-skills:tdd',
    'mcp__gmail__draft',
    'mcp__whiffle__handoff',
  ]);
});

test('groups start where their first command sits in the flat list', () => {
  const ordered = orderCommands([
    plugin('interfaces', 'better-ui'),
    builtin('review'),
    prompt('whiffle', 'handoff'),
    plugin('interfaces', 'better-colors'),
  ]);

  expect(groupCommands(ordered).map(({ source, start, commands }) => ({
    source,
    start,
    names: commands.map((cmd) => cmd.name),
  }))).toEqual([
    { source: undefined, start: 0, names: ['review'] },
    {
      source: 'interfaces',
      start: 1,
      names: ['interfaces:better-colors', 'interfaces:better-ui'],
    },
    { source: 'whiffle', start: 3, names: ['mcp__whiffle__handoff'] },
  ]);
});

test('a list with no namespaces is one headingless group', () => {
  const groups = groupCommands(orderCommands([builtin('review'), builtin('agents')]));
  expect(groups).toHaveLength(1);
  expect(groups[0].source).toBeUndefined();
});

test('a namespace filtered down to nothing leaves no group behind', () => {
  const commands = [builtin('review'), plugin('interfaces', 'better-ui'), prompt('whiffle', 'handoff')];
  const groups = groupCommands(filterCommands(commands, '/better'));
  expect(groups.map((group) => group.source)).toEqual(['interfaces']);
});

test('a row shows the leaf, never the namespace it sits under', () => {
  expect(displayName(plugin('interfaces', 'better-ui'))).toBe('better-ui');
  expect(displayName(prompt('whiffle', 'handoff'))).toBe('handoff');
  expect(displayName(builtin('review'))).toBe('review');
});

test('a command opens a word at the caret, anywhere in the line', () => {
  expect(commandAt('/rev', 4)).toEqual({ term: 'rev', start: 0 });
  expect(commandAt('have a look, /rev', 17)).toEqual({ term: 'rev', start: 13 });
});

test('a slash inside a word is not a command', () => {
  expect(commandAt('foo/bar', 7)).toBeNull();
  expect(commandAt('src/lib/x', 9)).toBeNull();
});

test('a space ends the command', () => {
  expect(commandAt('/review the diff', 16)).toBeNull();
});

test('the caret has to be inside the command', () => {
  // Caret parked before the `/` — the reader moved away from it.
  expect(commandAt('/review', 0)).toBeNull();
});

test('a bare slash offers everything', () => {
  const found = commandAt('/', 1);
  expect(found).toEqual({ term: '', start: 0 });
  expect(filterCommands([builtin('review'), builtin('agents')], found!.term)).toHaveLength(2);
});

// What ChatInput gates Enter on, and nothing else: a token alone never owns
// Enter, only a token the menu has rows for.
const paletteOwnsEnter = (text: string, caret: number) => {
  const token = commandAt(text, caret);
  return token !== null && filterCommands([builtin('review'), builtin('init')], token.term).length > 0;
};

test('a path is typed and sent as text, however far it is typed', () => {
  expect(paletteOwnsEnter('/home/whiffle', 13)).toBe(false);
  expect(paletteOwnsEnter('see /tmp/x', 10)).toBe(false);
  // Passing through `/home` the token is live, but it matches no command, so
  // the palette never opens and Enter still sends.
  expect(commandAt('/home/whiffle', 5)).toEqual({ term: 'home', start: 0 });
  expect(paletteOwnsEnter('/home/whiffle', 5)).toBe(false);
  expect(paletteOwnsEnter('/rev', 4)).toBe(true);
});

test('a chosen command replaces its token and nothing around it', () => {
  expect(insertCommand('/rev', { start: 0 }, 4, 'review')).toEqual({
    text: '/review ',
    caret: 8,
  });
  expect(insertCommand('have a look, /rev', { start: 13 }, 17, 'review')).toEqual({
    text: 'have a look, /review ',
    caret: 21,
  });
  // Mid-sentence: the space already there is the one that closes the menu, so
  // the insert adds none and the sentence keeps its spacing.
  expect(insertCommand('run /rev on it', { start: 4 }, 8, 'review')).toEqual({
    text: 'run /review on it',
    caret: 11,
  });
});

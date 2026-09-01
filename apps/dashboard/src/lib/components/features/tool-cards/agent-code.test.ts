// The two pure halves of the code pipeline: which grammar a name implies, and
// which tokens may paint the code that is on screen right now. Tokenizing
// itself is Shiki's and is not restated here — what this file guards is the
// streaming rule, where a wrong answer means a live block flashing back to
// plain between two frames.
import { expect, test } from 'bun:test';
import {
  agentCodeLanguage,
  languageForPath,
  paintableTokens,
  type AgentCodeLanguage,
  type AgentCodeTokens,
} from './agent-code';

const paths: ReadonlyArray<readonly [path: string, language: AgentCodeLanguage | null]> = [
  ['/home/bewinxed/whiffle/apps/dashboard/src/lib/prose.ts', 'typescript'],
  ['src/lib/components/ui/markdown/markdown.svelte', 'svelte'],
  ['scripts/deploy.SH', 'bash'],
  ['packages/hub/src/server.mts', 'typescript'],
  ['app.jsx', 'tsx'],
  ['tools/report.py', 'python'],
  ['drizzle/meta/_journal.json', 'json'],
  ['fix.patch', 'diff'],
  ['NEW.md', null],
  ['/etc/hosts', null],
  ['.bashrc', null],
  ['Makefile', null],
];

for (const [path, expected] of paths) {
  test(`languageForPath('${path}') is ${expected}`, () => {
    expect(languageForPath(path)).toBe(expected);
  });
}

const tags: ReadonlyArray<
  readonly [tag: string | undefined, language: AgentCodeLanguage | null]
> = [
  ['ts', 'typescript'],
  ['TSX', 'tsx'],
  ['  js  ', 'tsx'],
  ['sh', 'bash'],
  ['console', 'bash'],
  ['rust', null],
  ['', null],
  [undefined, null],
];

for (const [tag, expected] of tags) {
  test(`agentCodeLanguage(${JSON.stringify(tag)}) is ${expected}`, () => {
    expect(agentCodeLanguage(tag)).toBe(expected);
  });
}

const painted: AgentCodeTokens = {
  code: 'const a = 1',
  language: 'typescript',
  lines: [[{ content: 'const a = 1', offset: 0, light: '#111', dark: '#eee' }]],
};

test('tokens paint the code they were made from', () => {
  expect(paintableTokens(painted, 'const a = 1', 'typescript')).toBe(painted.lines);
});

test('a stream that only grew keeps painting its stale prefix', () => {
  expect(paintableTokens(painted, 'const a = 1\nconst b = 2', 'typescript')).toBe(painted.lines);
});

test('code that is no longer a prefix drops back to plain', () => {
  expect(paintableTokens(painted, 'const b = 2', 'typescript')).toBeNull();
});

test('a prefix in another grammar is not the same paint', () => {
  expect(paintableTokens(painted, 'const a = 1\nconst b = 2', 'tsx')).toBeNull();
});

test('nothing tokenized yet renders plain', () => {
  expect(paintableTokens(null, 'const a = 1', 'typescript')).toBeNull();
});

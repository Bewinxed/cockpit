import { expect, test } from 'bun:test';
import { withDeniedTools } from './denied-tools';

/**
 * `~/.claude/settings.json` is the user's file and the daemon converges it at
 * every boot, so what matters here is what survives: their other keys, their
 * own deny rules, and the order they wrote them in.
 */
const WEB = ['WebSearch', 'WebFetch'];

test('a settings file with no rules takes both', () => {
  expect(withDeniedTools({}, WEB)).toEqual({
    changed: true,
    next: { permissions: { deny: ['WebSearch', 'WebFetch'] } },
  });
});

test('a file that already denies both is not written again', () => {
  const settings = { permissions: { deny: ['WebSearch', 'WebFetch'] } };
  const { changed, next } = withDeniedTools(settings, WEB);
  expect(changed).toBe(false);
  expect(next).toEqual(settings);
});

test('only the missing one is appended', () => {
  expect(withDeniedTools({ permissions: { deny: ['WebSearch'] } }, WEB)).toEqual({
    changed: true,
    next: { permissions: { deny: ['WebSearch', 'WebFetch'] } },
  });
});

test('everything else in the file comes back out as it went in', () => {
  const { next } = withDeniedTools(
    {
      model: 'opus',
      permissions: { allow: ['Bash(git status)'], deny: ['Bash(rm:*)'] },
      hooks: { Stop: [] },
    },
    WEB
  );
  expect(next).toEqual({
    model: 'opus',
    permissions: {
      allow: ['Bash(git status)'],
      deny: ['Bash(rm:*)', 'WebSearch', 'WebFetch'],
    },
    hooks: { Stop: [] },
  });
});

test('a file that is not an object at all becomes one', () => {
  const written = { changed: true, next: { permissions: { deny: ['WebSearch', 'WebFetch'] } } };
  expect(withDeniedTools(null, WEB)).toEqual(written);
  expect(withDeniedTools('permissions', WEB)).toEqual(written);
  expect(withDeniedTools([], WEB)).toEqual(written);
});

test('a deny that is not a list is replaced by one, because nothing appends to it', () => {
  expect(withDeniedTools({ permissions: { deny: 'WebSearch' } }, WEB)).toEqual({
    changed: true,
    next: { permissions: { deny: ['WebSearch', 'WebFetch'] } },
  });
});

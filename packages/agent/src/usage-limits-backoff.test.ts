import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchClaudeLimits } from '@cockpit/core/usage/limits';

/**
 * Backoff & stale retention for `fetchClaudeLimits` (USAGE-SPEC.md §4.5).
 * The module keeps its success/failure caches in module state, so the tests
 * share one instance and drive it with `setSystemTime`; each test starts from
 * a known state via `toCleanState()`. The empty-window case runs first, before
 * any success has set `lastGood` (bun runs tests in declaration order).
 */

const BASE = Date.parse('2026-01-01T00:00:00Z');
const MIN = 60_000;

let dir: string;
let now: number;
let fetchCalls: number;

// `mockFetch` overwrites the global fetch bun's own test runner shares across
// every file in the process; left unrestored, whatever canned Response this
// file installed last (i.e. its final test's 500) answers every `fetch()` call
// made by hub tests running in the same `bun test` invocation, including the
// ones hitting their own ephemeral `.listen(0)` servers.
const realFetch = globalThis.fetch;

const setNow = (t: number): void => {
  now = t;
  setSystemTime(new Date(t));
};
const advance = (ms: number): void => setNow(now + ms);

// The clock only ever moves forward across tests, so a prior failure's backoff
// window (max 60m) is always behind us when a new test begins.
let clock = BASE;

const toCleanState = async (): Promise<void> => {
  clock += 2 * 60 * MIN; // past any prior backoff window
  setNow(clock);
  mockFetch(() => new Response(JSON.stringify(okBody()), { status: 200 }));
  await fetchClaudeLimits({ configDir: dir });
  advance(61_000); // expire the success cache, leaving lastGood set
};

function mockFetch(response: () => Response): void {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return response();
  }) as unknown as typeof fetch;
}

const okBody = () => ({
  limits: [{ kind: 'session', group: 'session', percent: 42, severity: 'normal', resets_at: null, is_active: false }],
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'limits-'));
  writeFileSync(
    join(dir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', expiresAt: Date.parse('2030-01-01T00:00:00Z') },
    })
  );
  setNow(clock);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  setSystemTime();
  globalThis.fetch = realFetch;
});

test('first failure with no prior reading returns empty windows, not stale', async () => {
  mockFetch(() => new Response('{}', { status: 429 }));
  const result = await fetchClaudeLimits({ configDir: dir });

  expect(result.error).toBe('HTTP 429');
  expect(result.windows).toEqual([]);
  expect(result.stale).toBeUndefined();
});

test('429 with a Retry-After header is honoured and cached', async () => {
  await toCleanState();
  mockFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }));

  const first = await fetchClaudeLimits({ configDir: dir });
  expect(first.stale).toBe(true);
  expect(first.error).toBe('HTTP 429');
  expect(first.windows.length).toBeGreaterThan(0);
  expect(fetchCalls).toBe(1);

  advance(1_000);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(1); // still inside the 120s window: no re-fetch

  advance(121_000);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(2); // window expired: fetch again
});

test('429 without Retry-After escalates 5m -> 15m -> 60m', async () => {
  await toCleanState();
  mockFetch(() => new Response('{}', { status: 429 }));

  await fetchClaudeLimits({ configDir: dir }); // streak 1 -> 5m
  expect(fetchCalls).toBe(1);

  advance(MIN);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(1); // within 5m

  advance(4 * MIN + 1_000);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(2); // 5m expired, streak 2 -> 15m

  advance(5 * MIN);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(2); // within 15m

  advance(10 * MIN + 1_000);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(3); // 15m expired, streak 3 -> 60m
});

test('a success resets the failure streak', async () => {
  await toCleanState();
  mockFetch(() => new Response('{}', { status: 429 }));
  await fetchClaudeLimits({ configDir: dir }); // streak 1
  expect(fetchCalls).toBe(1);

  advance(5 * MIN + 1_000); // let the backoff expire
  mockFetch(() => new Response(JSON.stringify(okBody()), { status: 200 }));
  const good = await fetchClaudeLimits({ configDir: dir });
  expect(good.error).toBe(null);
  expect(good.stale).toBeUndefined();

  advance(61_000); // expire the success cache
  mockFetch(() => new Response('{}', { status: 429 }));
  await fetchClaudeLimits({ configDir: dir }); // streak is 1 again -> 5m, not 15m
  expect(fetchCalls).toBe(1);

  advance(6 * MIN);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(2); // 5m backoff (reset) expired; a 15m one would not have
});

test('non-429 failures cool down a fixed 2m', async () => {
  await toCleanState();
  mockFetch(() => new Response('{}', { status: 500 }));

  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(1);

  advance(MIN);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(1); // within 2m

  advance(2 * MIN + 1_000);
  await fetchClaudeLimits({ configDir: dir });
  expect(fetchCalls).toBe(2);
});

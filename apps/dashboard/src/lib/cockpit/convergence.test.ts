// The board's convergence readers (leaf C2): a machine's build against the
// hub's, its fleet-sync failures, and the update-pending state a deploy
// clone reports — all derived from frame data alone, per
// .unlazy-liveness/gates/c2.md's G1.
import { expect, test } from 'bun:test';
import type { BuildInfo, FleetSyncReport } from '@cockpit/core';
import {
  buildConvergence,
  deployInfoOf,
  fleetSyncAgeMs,
  fleetSyncFailures,
  isDeployDiverged,
  isDeployNoteworthy,
} from './convergence';

const build = (commit?: string): BuildInfo => ({ version: '1.0.0', commit, startedAt: 0 });

test('a machine with no reported commit is unknown, never current', () => {
  // The Mac's incident, exactly: 21 days of `commit: None` must not read as
  // "up to date" merely because it also never read as "behind".
  expect(buildConvergence(build(undefined), build('a56a42c'))).toBe('unknown');
  expect(buildConvergence(undefined, build('a56a42c'))).toBe('unknown');
});

test('no hubBuild to compare against is unknown too, not current', () => {
  expect(buildConvergence(build('a56a42c'), undefined)).toBe('unknown');
});

test('a matching commit is current; a different one is behind', () => {
  expect(buildConvergence(build('a56a42c'), build('a56a42c'))).toBe('current');
  expect(buildConvergence(build('old1234'), build('a56a42c'))).toBe('behind');
});

const report = (over: Partial<FleetSyncReport> = {}): FleetSyncReport => ({
  mcp: {},
  marketplaces: {},
  plugins: {},
  at: 1_700_000_000_000,
  ...over,
});

test('no fleet report at all is no failures', () => {
  expect(fleetSyncFailures(undefined)).toEqual([]);
});

test('a failed memory row is a first-class failure carrying its detail', () => {
  const failures = fleetSyncFailures(
    report({ memory: { state: 'failed', detail: 'edited on this machine — adopt it or overwrite' } })
  );
  expect(failures).toEqual([
    { category: 'memory', key: '', detail: 'edited on this machine — adopt it or overwrite' },
  ]);
});

test('every keyed category surfaces its own failed rows, applied and removed do not', () => {
  const failures = fleetSyncFailures(
    report({
      mcp: { exa: { state: 'applied' }, broken: { state: 'failed', detail: 'spawn ENOENT' } },
      plugins: { old: { state: 'removed' } },
      skills: { gone: { state: 'failed' } },
      hooks: { pre: { state: 'failed', detail: 'no checkout here' } },
    })
  );
  expect(failures).toEqual([
    { category: 'mcp', key: 'broken', detail: 'spawn ENOENT' },
    { category: 'skills', key: 'gone', detail: undefined },
    { category: 'hooks', key: 'pre', detail: 'no checkout here' },
  ]);
});

test('a failed memory doc is reported by its own path, main memory left out', () => {
  const failures = fleetSyncFailures(
    report({
      memory: { state: 'applied' },
      memoryDocs: { 'models/deepseek.md': { state: 'failed', detail: 'kept its own copy' } },
    })
  );
  expect(failures).toEqual([{ category: 'memoryDocs', key: 'models/deepseek.md', detail: 'kept its own copy' }]);
});

test('sync age is how long ago the report was taken, in ms', () => {
  const now = 1_700_000_000_000 + 11 * 24 * 60 * 60 * 1000; // 11 days later
  expect(fleetSyncAgeMs(report(), now)).toBe(11 * 24 * 60 * 60 * 1000);
});

test('a machine that never synced has no age at all', () => {
  expect(fleetSyncAgeMs(undefined)).toBeUndefined();
});

test('a machine carrying no deploy field reports nothing, same as a hub that predates it', () => {
  expect(deployInfoOf(undefined)).toBeUndefined();
  expect(deployInfoOf({})).toBeUndefined();
  expect(deployInfoOf('current')).toBeUndefined();
});

test('a well-shaped deploy value reads through', () => {
  const diverged = deployInfoOf({ kind: 'diverged', detail: 'DIVERGED — refusing to update' });
  expect(diverged).toEqual({ kind: 'diverged', detail: 'DIVERGED — refusing to update' });
  expect(isDeployDiverged(diverged)).toBe(true);
});

test('unmarked and current are not noteworthy; every other kind is', () => {
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'unmarked' }))).toBe(false);
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'current' }))).toBe(false);
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'behind' }))).toBe(true);
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'ahead' }))).toBe(true);
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'unreachable' }))).toBe(true);
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'diverged' }))).toBe(true);
  expect(isDeployNoteworthy(undefined)).toBe(false);
});

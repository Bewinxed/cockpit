// The board's convergence readers (leaf C2): a machine's build against the
// hub's, its fleet-sync failures, and the update-pending state a deploy
// clone reports — all derived from frame data alone, per
// .unlazy-liveness/gates/c2.md's G1.
import { expect, test } from 'bun:test';
import type { BuildInfo, FleetSyncReport } from '@whiffle/core';
import {
  buildConvergence,
  deployInfoOf,
  fleetSyncAgeMs,
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

// The fleet-sync failure cases moved with the readers, to fleet-faults.test.ts.

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

// Leaf Y2: the field is real now (`AgentRow.deploy`), and this is the boundary
// where a machine older or newer than this build is read. A kind this build
// cannot render must badge nothing rather than badge something meaningless.
test('a kind this build does not know reads as nothing to report', () => {
  expect(deployInfoOf({ kind: 'liquefied' })).toBeUndefined();
  expect(isDeployNoteworthy(deployInfoOf({ kind: 'liquefied' }))).toBe(false);
});

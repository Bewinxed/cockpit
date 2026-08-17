import { expect, test } from 'bun:test';
import type { InstanceRow } from '@cockpit/core';
import { resolveDelegatePermissionMode } from './server';

/** A row with just the fields the walk reads; the rest are irrelevant to it. */
const row = (id: string, overrides: Partial<InstanceRow> = {}): InstanceRow => ({
  id,
  machineId: 'm',
  cwd: `/home/o/${id}`,
  status: 'running',
  sessionId: null,
  ...overrides,
});

const rootBypass: InstanceRow[] = [
  row('root', { permissionMode: 'bypassPermissions' }),
  row('delegate-1', { parentInstanceId: 'root' }),
  row('delegate-2', { parentInstanceId: 'delegate-1' }),
];

test('a nested delegate inherits the bypassing root', () => {
  expect(resolveDelegatePermissionMode(rootBypass, 'delegate-1')).toBe('bypassPermissions');
  expect(resolveDelegatePermissionMode(rootBypass, 'delegate-2')).toBe('bypassPermissions');
});

test('a delegate of a default-mode root stays default', () => {
  const rows: InstanceRow[] = [
    row('root', { permissionMode: 'default' }),
    row('delegate-1', { parentInstanceId: 'root' }),
  ];
  expect(resolveDelegatePermissionMode(rows, 'delegate-1')).toBe('default');
});

test('the immediate parent does not mask the root', () => {
  // The immediate parent is itself a delegate with no mode of its own; only the
  // root's bypass matters, so the walk must not stop one hop up.
  const rows: InstanceRow[] = [
    row('root', { permissionMode: 'bypassPermissions' }),
    row('delegate-1', { parentInstanceId: 'root', permissionMode: undefined }),
    row('delegate-2', { parentInstanceId: 'delegate-1' }),
  ];
  expect(resolveDelegatePermissionMode(rows, 'delegate-2')).toBe('bypassPermissions');
});

test('an unknown parent yields nothing, not a guess', () => {
  expect(resolveDelegatePermissionMode(rootBypass, 'ghost')).toBeUndefined();
});

test('a parent chain with no mode at the root yields nothing', () => {
  const rows: InstanceRow[] = [
    row('root'),
    row('delegate-1', { parentInstanceId: 'root' }),
  ];
  expect(resolveDelegatePermissionMode(rows, 'delegate-1')).toBeUndefined();
});

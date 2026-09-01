import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyDb } from './index';

/**
 * Scratch directories only, per the C9 leaf brief — this exercises the move
 * logic, never the fleet's own `whiffle.db`.
 */
let scratch: string;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const setup = () => {
  scratch = mkdtempSync(join(tmpdir(), 'whiffle-db-migration-'));
  return {
    legacy: join(scratch, 'legacy', 'whiffle.db'),
    target: join(scratch, 'data', 'whiffle', 'whiffle.db'),
  };
};

test('legacy present, target absent: db, wal and shm all move', () => {
  const { legacy, target } = setup();
  mkdirSync(join(scratch, 'legacy'), { recursive: true });
  writeFileSync(legacy, 'db');
  writeFileSync(`${legacy}-wal`, 'wal');
  writeFileSync(`${legacy}-shm`, 'shm');

  migrateLegacyDb(target, legacy);

  expect(existsSync(target)).toBe(true);
  expect(existsSync(`${target}-wal`)).toBe(true);
  expect(existsSync(`${target}-shm`)).toBe(true);
  expect(existsSync(legacy)).toBe(false);
  expect(existsSync(`${legacy}-wal`)).toBe(false);
  expect(existsSync(`${legacy}-shm`)).toBe(false);
});

test('second boot after a move is a no-op', () => {
  const { legacy, target } = setup();
  mkdirSync(join(scratch, 'legacy'), { recursive: true });
  writeFileSync(legacy, 'db');
  writeFileSync(`${legacy}-wal`, 'wal');
  migrateLegacyDb(target, legacy);
  expect(existsSync(target)).toBe(true);

  // Nothing left in the legacy spot to move, and the target already exists —
  // calling it again (the next boot) must not throw or alter anything.
  migrateLegacyDb(target, legacy);

  expect(existsSync(target)).toBe(true);
  expect(existsSync(legacy)).toBe(false);
});

test('target already present: legacy file is left untouched', () => {
  const { legacy, target } = setup();
  mkdirSync(join(scratch, 'legacy'), { recursive: true });
  mkdirSync(join(scratch, 'data', 'whiffle'), { recursive: true });
  writeFileSync(legacy, 'stale-legacy');
  writeFileSync(target, 'live-target');

  migrateLegacyDb(target, legacy);

  expect(existsSync(legacy)).toBe(true);
  expect(existsSync(target)).toBe(true);
});

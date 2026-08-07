// Two sessions in one repository used to be two rows saying the same directory
// name. The rail folds them; a directory with one session must not change.
import { expect, test } from 'bun:test';
import { groupByCwd, isCwdGroup } from './grouping';

const row = (id: string, cwd: string) => ({ id, cwd });

test('directories with one session each are left as they were', () => {
  const rows = [row('a', '/x'), row('b', '/y'), row('c', '/z')];
  expect(groupByCwd(rows)).toEqual(rows);
});

test('two sessions in one directory become one group', () => {
  const a = row('a', '/x');
  const b = row('b', '/x');
  expect(groupByCwd([a, b])).toEqual([{ cwd: '/x', rows: [a, b] }]);
});

test('a group stands where its first member stood, and singles stay put', () => {
  const a = row('a', '/x');
  const b = row('b', '/y');
  const c = row('c', '/x');
  const d = row('d', '/z');
  expect(groupByCwd([a, b, c, d])).toEqual([{ cwd: '/x', rows: [a, c] }, b, d]);
});

test('a group is told apart from a plain row', () => {
  const [group, single] = groupByCwd([row('a', '/x'), row('b', '/x'), row('c', '/y')]);
  expect(isCwdGroup(group)).toBe(true);
  expect(isCwdGroup(single)).toBe(false);
});

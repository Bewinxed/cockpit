import { expect, test } from 'bun:test';
import { briefTitle } from './brief-title';

test('the headline is the first line that says anything', () => {
  expect(briefTitle('\n\n  Fix the router refusal\nand then the tests\n')).toBe(
    'Fix the router refusal'
  );
});

test('the line is collapsed, not reproduced', () => {
  expect(briefTitle('  Fix\tthe   router     refusal  \nrest of the brief')).toBe(
    'Fix the router refusal'
  );
});

test('a long line is cut at a word boundary and says that it was', () => {
  const title = briefTitle(
    'Carry the delegate brief headline end to end through core, the agent, the hub and the rail'
  );

  expect(title).toBe('Carry the delegate brief headline end to end through core, the agent, the hub…');
  expect(title?.length).toBeLessThanOrEqual(80);
});

test('a line with no boundary to cut at is cut anyway', () => {
  const title = briefTitle('x'.repeat(200));

  expect(title).toBe(`${'x'.repeat(79)}…`);
  expect(title?.length).toBe(80);
});

test('a brief with nothing in it has no headline', () => {
  expect(briefTitle('')).toBeUndefined();
  expect(briefTitle('  \n\t\n ')).toBeUndefined();
});

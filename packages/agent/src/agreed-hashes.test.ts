/**
 * The rule that decides whether the hub may leave content out of a sync.
 *
 * Getting it wrong in the generous direction is the expensive one: the hub
 * stops sending a skill's files, and a harness that never had them can never
 * converge — silently, because every row it can see says `applied`.
 */
import { expect, test } from 'bun:test';
import { agreedHashes } from './session';

test('a hash only one harness holds is not held', () => {
  // claude has it, pi does not: pi still needs the bytes.
  expect(agreedHashes([{ a: 'h1', b: 'h2' }, { b: 'h2' }])).toEqual({ b: 'h2' });
});

test('the same name at different hashes is not held', () => {
  expect(agreedHashes([{ a: 'h1' }, { a: 'h2' }])).toEqual({});
});

test('one claimant is taken at its word', () => {
  expect(agreedHashes([{ a: 'h1' }])).toEqual({ a: 'h1' });
});

test('no claimant agrees on nothing, so everything is sent', () => {
  expect(agreedHashes([])).toEqual({});
});

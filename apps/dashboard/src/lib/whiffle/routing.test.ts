// A delegate's ask carries `routedTo: 'parent'` and must stay out of the user's
// attention queue while remaining on the delegate's own transcript. The
// predicate is the seam the store reads; it is pure so it can be tested alone.
import { expect, test } from 'bun:test';
import { routedToParent } from './frames';

test('an ask tagged routedTo=parent is recognized', () => {
  expect(routedToParent({ routedTo: 'parent' })).toBe(true);
});

test('an untagged ask is not recognized', () => {
  expect(routedToParent({})).toBe(false);
});

test('a differently-tagged ask is not recognized', () => {
  expect(routedToParent({ routedTo: 'dashboard' })).toBe(false);
});

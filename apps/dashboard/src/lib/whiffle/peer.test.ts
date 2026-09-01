import { expect, test } from 'bun:test';
import { matchPeers, mentionAt, type PeerTarget } from './peer';

const peers: PeerTarget[] = [
  { id: '1', machineId: 'm1', label: 'keeboard', hostname: 'mac', busy: false },
  { id: '2', machineId: 'm2', label: 'center.ai', hostname: 'obelisk', busy: true },
];

test('a mention opens a word at the caret', () => {
  expect(mentionAt('@keeb', 5)).toEqual({ term: 'keeb', start: 0 });
  expect(mentionAt('tell @keeb', 10)).toEqual({ term: 'keeb', start: 5 });
});

test('an address inside a word is not a mention', () => {
  // The case that matters: an email, or a path with an @ in it.
  expect(mentionAt('me@example.com', 14)).toBeNull();
  expect(mentionAt('pkg@1.2.3', 9)).toBeNull();
});

test('a space ends the mention', () => {
  expect(mentionAt('@keeboard is working', 20)).toBeNull();
});

test('the caret has to be inside the mention', () => {
  // Caret parked before the `@` — the reader moved away from it.
  expect(mentionAt('@keeboard', 0)).toBeNull();
});

test('a bare @ offers everything', () => {
  const found = mentionAt('@', 1);
  expect(found).toEqual({ term: '', start: 0 });
  expect(matchPeers(peers, found!.term)).toHaveLength(2);
});

test('matching is unanchored and case-insensitive', () => {
  expect(matchPeers(peers, 'BOARD').map((peer) => peer.label)).toEqual(['keeboard']);
  expect(matchPeers(peers, 'center').map((peer) => peer.label)).toEqual(['center.ai']);
});

test('a machine name finds its sessions', () => {
  expect(matchPeers(peers, 'obelisk').map((peer) => peer.label)).toEqual(['center.ai']);
});

test('no match offers nothing rather than everything', () => {
  expect(matchPeers(peers, 'nothing-like-this')).toHaveLength(0);
});

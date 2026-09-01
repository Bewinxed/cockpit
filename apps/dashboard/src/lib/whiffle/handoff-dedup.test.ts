// A hand-off brief must render exactly once in the receiving session: the live
// echo (uuid-less) and the stored copy (uuid-bearing) both map to `user.peer`,
// and the stored copy is upgraded from a plain user turn by its marker prefix.
import { expect, test } from 'bun:test';
import type { SDKMessage, SessionMessage } from '@whiffle/core';
import { mapFrame, mapTranscript, mergePeerMessage } from './frames';

const BODY =
  '[Hand-off from the sender session — another agent, not the user]\n\nplease handle this';

/** The daemon's live peer frame: origin says peer, no uuid. */
const peerFrame = (text: string): SDKMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  origin: { kind: 'peer', from: 'i-sender', name: 'sender', fromSession: 'i-sender' },
});

/** What `getSessionMessages` returns for a user turn: uuid, no origin. */
const storedEntry = (text: string, uuid: string): SessionMessage => ({
  type: 'user',
  uuid,
  session_id: 's1',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
  parent_agent_id: null,
});

/** The backfill seam: the stored transcript replaces the list, live re-appends. */
function foldLiveInto(stored: import('./types').Message[], live: import('./types').Message[]) {
  const merged = [...stored];
  for (const message of live) {
    if (mergePeerMessage(merged, message)) continue;
    merged.push(message);
  }
  return merged;
}

const peers = (messages: import('./types').Message[]) =>
  messages.filter((m) => m.type === 'user.peer').length;
const users = (messages: import('./types').Message[]) =>
  messages.filter((m) => m.type === 'user').length;

test('case 1 — live echo then re-read dedups to one peer bubble', () => {
  const live = mapFrame('i1', peerFrame(BODY)).messages;
  const stored = mapTranscript('i1', [storedEntry(BODY, 'u-1')]).messages;
  const merged = foldLiveInto(stored, live);

  expect(merged).toHaveLength(1);
  expect(peers(merged)).toBe(1);
  expect(users(merged)).toBe(0);
  expect(merged[0].sdkUuid).toBe('u-1');
});

test('case 2 — re-read only upgrades the stored copy via the marker', () => {
  const stored = mapTranscript('i1', [storedEntry(BODY, 'u-2')]).messages;

  expect(stored).toHaveLength(1);
  expect(peers(stored)).toBe(1);
  expect(users(stored)).toBe(0);
  expect(stored[0].metadata?.peerName).toBe('sender');
});

test('case 3 — live only still shows its one peer bubble', () => {
  const live = mapFrame('i1', peerFrame(BODY)).messages;

  expect(live).toHaveLength(1);
  expect(peers(live)).toBe(1);
  expect(users(live)).toBe(0);
  expect(live[0].sdkUuid).toBeUndefined();
});

test('case 4 — an ordinary stored user turn stays a plain user turn', () => {
  const stored = mapTranscript('i1', [storedEntry('a normal message', 'u-4')]).messages;

  expect(stored).toHaveLength(1);
  expect(peers(stored)).toBe(0);
  expect(users(stored)).toBe(1);
});

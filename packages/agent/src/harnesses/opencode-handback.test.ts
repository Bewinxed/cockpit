import { expect, test } from 'bun:test';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { NeutralUserMessage } from '@whiffle/core';
import type { HarnessContext } from '../harness';
import { OpencodeSession } from './opencode';

/**
 * Hand-back delivery (the 2026-08-16 report-amplifier bug). A burst of worker
 * reports must not become a burst of junk "Acknowledged" turns — but delivered
 * work must still run, not sit appended silently forever. The contract: an
 * idle hand-back wakes the session into one turn; while busy it queues, and
 * the idle drain coalesces everything queued into a SINGLE wake turn.
 */
const SESSION = 'ses_handback';

const ctx = (frames: unknown[]): HarnessContext => ({
  instanceId: 'handback',
  cwd: '/tmp/opencode-handback',
  frame: (m) => frames.push(m),
  permission: () => {},
  busy: () => {},
  session: () => {},
  failed: () => {},
  emit: () => {},
  closed: () => {},
});

const handback = (content: string): NeutralUserMessage =>
  ({ type: 'user', message: { role: 'user', content }, shouldQuery: false }) as NeutralUserMessage;

/** One prompt the adapter fired: how many parts, and whether it was a silent append. */
interface PromptCall {
  parts: number;
  noReply: boolean;
}

const makeClient = (calls: PromptCall[]): OpencodeClient =>
  ({
    session: {
      promptAsync: ({ body }: { body: { parts?: unknown[]; noReply?: boolean } }) => {
        calls.push({ parts: body.parts?.length ?? 0, noReply: body.noReply === true });
        return Promise.resolve({});
      },
      abort: () => Promise.resolve({}),
    },
  }) as unknown as OpencodeClient;

test('an idle hand-back wakes the session into one real turn', () => {
  const calls: PromptCall[] = [];
  const session = new OpencodeSession(
    'handback',
    ctx([]),
    makeClient(calls),
    SESSION,
    '/tmp/opencode-handback',
    undefined,
    undefined,
    'http://127.0.0.1:0',
    () => {},
    () => {}
  );

  session.send(handback('worker report'), {});

  expect(calls).toEqual([{ parts: 1, noReply: false }]);
});

test('a busy hand-back queues, and the idle drain coalesces into one turn', () => {
  const calls: PromptCall[] = [];
  const session = new OpencodeSession(
    'handback',
    ctx([]),
    makeClient(calls),
    SESSION,
    '/tmp/opencode-handback',
    undefined,
    undefined,
    'http://127.0.0.1:0',
    () => {},
    () => {}
  );

  session.handle({ type: 'session.status', properties: { sessionID: SESSION, status: { type: 'busy' } } } as never);
  session.send(handback('worker 1'), {});
  session.send(handback('worker 2'), {});
  expect(calls).toEqual([]);

  session.handle({ type: 'session.idle', properties: { sessionID: SESSION } } as never);
  expect(calls).toEqual([{ parts: 2, noReply: false }]);
});

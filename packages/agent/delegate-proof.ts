/**
 * No-network gate for the `delegate` action: proves the shared body emits the
 * right spawn + send envelopes without touching the hub or a server.
 */
import { handoffActions } from './src/harnesses/handoff-shared';
import type { Envelope } from '@whiffle/core';

const envelopes: Envelope[] = [];

const actions = handoffActions({
  instanceId: 'parent-1',
  cwd: '/tmp/x/parentrepo',
  emit: (envelope) => envelopes.push(envelope),
});

let failures = 0;
const check = (name: string, pass: boolean) => {
  if (pass) console.log(`PASS ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}`);
  }
};

await actions.delegate('Do the thing.', { harness: 'opencode', model: 'opencode-go/deepseek-v4-pro' });

check('exactly 2 envelopes', envelopes.length === 2);

const spawn = envelopes[0]?.payload as {
  instanceId?: string;
  cwd?: string;
  harness?: string;
  model?: string;
  scratch?: { baseCwd?: string };
  parent?: { instanceId?: string };
};
const send = envelopes[1]?.payload as {
  instanceId?: string;
  message?: {
    origin?: { kind?: string };
    message?: { content?: string | unknown[] };
  };
};

check('envelope 1 is a spawn', envelopes[0]?.verb === 'spawn');
check('spawn payload.harness is opencode', spawn.harness === 'opencode');
check('spawn payload.model set', spawn.model === 'opencode-go/deepseek-v4-pro');
check('spawn payload.parent.instanceId is parent-1', spawn.parent?.instanceId === 'parent-1');
check('spawn payload.cwd is the parent repo', spawn.cwd === '/tmp/x/parentrepo');
check('spawn payload.scratch.baseCwd is the workdir', spawn.scratch?.baseCwd === '/tmp/x/parentrepo');

check('envelope 2 is a send', envelopes[1]?.verb === 'send');
check(
  'send targets the spawned instance',
  send.instanceId !== undefined && send.instanceId === spawn.instanceId
);

const content =
  typeof send.message?.message?.content === 'string' ? send.message.message.content : '';
check('send content equals the brief exactly', content === 'Do the thing.');
check('send content does NOT contain the delegate protocol', !content.includes('Delegate protocol'));
check('send origin is peer', send.message?.origin?.kind === 'peer');

// fork_of: the roster is the only network hop a fork touches, so stub fetch
// with a fixed instances/agents response rather than reaching a real hub.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.endsWith('/api/instances')) {
    return new Response(
      JSON.stringify([
        {
          id: 'source-delegate-1',
          machineId: 'machine-1',
          cwd: '/tmp/x/parentrepo',
          status: 'running',
          sessionId: 'claude-session-abc',
          parentInstanceId: 'parent-1',
          model: 'claude-opus-4-6',
        },
      ]),
      { status: 200 }
    );
  }
  if (url.endsWith('/api/agents')) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  throw new Error(`unexpected fetch in delegate-proof: ${url}`);
}) as typeof fetch;

envelopes.length = 0;
await actions.delegate('Continue the thing.', { forkOf: 'source-delegate-1' });
globalThis.fetch = realFetch;

check('fork_of: exactly 2 envelopes', envelopes.length === 2);
const forkSpawn = envelopes[0]?.payload as {
  resume?: { sessionKey?: string; fork?: boolean };
};
check('fork_of: envelope 1 is a spawn', envelopes[0]?.verb === 'spawn');
check(
  'fork_of: spawn payload.resume equals {sessionKey, fork: true}',
  forkSpawn.resume?.sessionKey === 'claude-session-abc' && forkSpawn.resume?.fork === true
);

// fork_of pointed at a delegate this session does not own: refused, no spawn.
envelopes.length = 0;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.endsWith('/api/instances')) {
    return new Response(
      JSON.stringify([
        {
          id: 'someone-elses-delegate',
          machineId: 'machine-1',
          cwd: '/tmp/x/other',
          status: 'running',
          sessionId: 'claude-session-xyz',
          parentInstanceId: 'not-parent-1',
        },
      ]),
      { status: 200 }
    );
  }
  if (url.endsWith('/api/agents')) return new Response(JSON.stringify([]), { status: 200 });
  throw new Error(`unexpected fetch in delegate-proof: ${url}`);
}) as typeof fetch;

let refused = false;
try {
  await actions.delegate('Continue the thing.', { forkOf: 'someone-elses-delegate' });
} catch {
  refused = true;
}
globalThis.fetch = realFetch;
check('fork_of: forking a delegate you do not own throws, no spawn', refused && envelopes.length === 0);

// fork_of pointed at your own delegate that never emitted a sessionId: refused, no spawn.
envelopes.length = 0;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.endsWith('/api/instances')) {
    return new Response(
      JSON.stringify([
        {
          id: 'sessionless-delegate',
          machineId: 'machine-1',
          cwd: '/tmp/x/parentrepo',
          status: 'running',
          sessionId: null,
          parentInstanceId: 'parent-1',
        },
      ]),
      { status: 200 }
    );
  }
  if (url.endsWith('/api/agents')) return new Response(JSON.stringify([]), { status: 200 });
  throw new Error(`unexpected fetch in delegate-proof: ${url}`);
}) as typeof fetch;

let refusedNoSession = false;
try {
  await actions.delegate('Continue the thing.', { forkOf: 'sessionless-delegate' });
} catch {
  refusedNoSession = true;
}
globalThis.fetch = realFetch;
check(
  'fork_of: forking a delegate with no sessionId throws, no spawn',
  refusedNoSession && envelopes.length === 0
);

// A named delegate type: its harness/model/denyTools land on the spawn
// payload with no explicit harness/model given.
const typedActions = handoffActions({
  instanceId: 'parent-1',
  cwd: '/tmp/x/parentrepo',
  emit: (envelope) => envelopes.push(envelope),
  delegateTypes: [
    {
      name: 'explore',
      description: 'Read-only codebase exploration and fan-out search.',
      harness: 'claude',
      model: 'sonnet',
      effort: 'low',
      denyTools: ['Write', 'Edit', 'NotebookEdit'],
    },
  ],
});

envelopes.length = 0;
await typedActions.delegate('Find every caller of foo().', { type: 'explore' });

check('type: exactly 2 envelopes', envelopes.length === 2);
const typedSpawn = envelopes[0]?.payload as {
  harness?: string;
  model?: string;
  effort?: string;
  denyTools?: string[];
};
check('type: envelope 1 is a spawn', envelopes[0]?.verb === 'spawn');
check('type: spawn payload.harness comes from the type', typedSpawn.harness === 'claude');
check('type: spawn payload.model comes from the type', typedSpawn.model === 'sonnet');
check('type: spawn payload.effort comes from the type', typedSpawn.effort === 'low');
check(
  'type: spawn payload.denyTools comes from the type',
  JSON.stringify(typedSpawn.denyTools) === JSON.stringify(['Write', 'Edit', 'NotebookEdit'])
);

// An explicit model still overrides the type's own model.
envelopes.length = 0;
await typedActions.delegate('Find every caller of foo().', { type: 'explore', model: 'opus' });
const overriddenSpawn = envelopes[0]?.payload as { harness?: string; model?: string };
check('type: explicit model overrides the type', overriddenSpawn.model === 'opus');
check('type: harness still comes from the type', overriddenSpawn.harness === 'claude');

// Unknown type: refused before any spawn envelope goes out.
envelopes.length = 0;
let unknownTypeRefused = false;
try {
  await typedActions.delegate('Do the thing.', { type: 'nonexistent' });
} catch {
  unknownTypeRefused = true;
}
check('type: unknown type throws, no spawn envelope', unknownTypeRefused && envelopes.length === 0);

// An empty cached list (a hub blip at session start) is not the last word:
// a named `type` retries fetchDelegateTypes once, live, before refusing.
const emptyCacheActions = handoffActions({
  instanceId: 'parent-1',
  cwd: '/tmp/x/parentrepo',
  emit: (envelope) => envelopes.push(envelope),
  delegateTypes: [],
});
envelopes.length = 0;
const realFetchForRefetch = globalThis.fetch;
let refetchCalls = 0;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.endsWith('/api/delegate-types')) {
    refetchCalls++;
    return new Response(
      JSON.stringify({
        types: [
          { name: 'explore', description: 'Read-only exploration.', harness: 'claude', model: 'sonnet' },
        ],
      }),
      { status: 200 }
    );
  }
  throw new Error(`unexpected fetch in delegate-proof: ${url}`);
}) as typeof fetch;

await emptyCacheActions.delegate('Find every caller of foo().', { type: 'explore' });
globalThis.fetch = realFetchForRefetch;

check('type: empty cached list + named type triggers exactly one lazy refetch', refetchCalls === 1);
const refetchedSpawn = envelopes[0]?.payload as { harness?: string; model?: string };
check('type: lazy refetch resolves the type onto the spawn', refetchedSpawn.harness === 'claude' && refetchedSpawn.model === 'sonnet');

if (failures > 0) {
  console.log(`delegate-proof: ${failures} FAIL`);
  process.exit(1);
}
console.log('delegate-proof: all PASS');
process.exit(0);

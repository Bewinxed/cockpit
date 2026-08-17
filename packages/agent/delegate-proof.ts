/**
 * No-network gate for the `delegate` action: proves the shared body emits the
 * right spawn + send envelopes without touching the hub or a server.
 */
import { handoffActions } from './src/harnesses/handoff-shared';
import type { Envelope } from '@cockpit/core';

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

if (failures > 0) {
  console.log(`delegate-proof: ${failures} FAIL`);
  process.exit(1);
}
console.log('delegate-proof: all PASS');
process.exit(0);

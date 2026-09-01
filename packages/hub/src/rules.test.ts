import { afterAll, beforeEach, expect, test } from 'bun:test';
import type { Envelope, NeutralMessage, Rule, RuleDraft, SendPayload } from '@whiffle/core';
import { RULE_FIRE_CEILING } from '@whiffle/core';
import { makeDb } from './db';
import { RuleEngine } from './rules';

/**
 * The engine, against a real database rather than a fake one: the nagging is a
 * state machine that lives in SQL, and a hand-rolled stub of it would be
 * testing the stub. Only the socket is faked, because that is the one thing a
 * test cannot have.
 *
 * The path is named rather than set through `WHIFFLE_DB_PATH`. Under `bun test`
 * every file shares one process, `DB_PATH` is read once at import, and the file
 * that loses that race writes its fixtures into the fleet's real `whiffle.db` —
 * which is exactly what happened before this was pinned.
 */
const DB_FILE = `/tmp/whiffle-rules-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

afterAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    await Bun.file(`${DB_FILE}${suffix}`).delete().catch(() => {});
  }
});

const MACHINE = 'machine-1';
const INSTANCE = 'instance-1';

/** Every envelope the engine tried to put on the wire, newest last. */
let sent: Envelope<SendPayload>[] = [];

const engineFor = (): InstanceType<typeof RuleEngine> =>
  new RuleEngine({
    db,
    agent: (machineId) =>
      machineId === MACHINE ? { send: (envelope) => void sent.push(envelope) } : undefined,
  });

const draft = (over: Partial<RuleDraft> = {}): RuleDraft => ({
  name: 'Honest caveat',
  enabled: true,
  pattern: 'honest caveat',
  matchKind: 'phrase',
  caseSensitive: false,
  wholeWord: false,
  watch: 'text',
  reply: 'your work is not done yet',
  timing: 'turn',
  interrupt: false,
  requireAck: true,
  scope: {},
  ...over,
});

const addRule = (over: Partial<RuleDraft> = {}): Rule =>
  db.putRule({ ...draft(over), id: crypto.randomUUID(), createdAt: Date.now() });

const says = (text: string): NeutralMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { content: [{ type: 'text', text }] },
});

const ends = (subtype = 'success'): NeutralMessage => ({
  type: 'result',
  subtype,
  is_error: false,
});

/** One whole turn: the session says something, then stops. */
function turn(engine: InstanceType<typeof RuleEngine>, text: string) {
  engine.observe(INSTANCE, says(text));
  engine.observe(INSTANCE, ends());
}

const body = (envelope: Envelope<SendPayload>): string => {
  const content = envelope.payload.message.message.content;
  return typeof content === 'string' ? content : '';
};

beforeEach(() => {
  sent = [];
  for (const rule of db.listRules()) db.deleteRule(rule.id);
  db.upsertAgent({ machineId: MACHINE, hostname: 'test', os: 'linux', auth: 'unknown' });
  db.openInstance({
    id: INSTANCE,
    machineId: MACHINE,
    cwd: '/tmp/work',
    harness: 'claude',
    model: 'claude-opus-5-20260101',
    kind: 'mainline',
  });
});

test('a turn rule fires when the turn ends, and wakes the session', () => {
  const rule = addRule();
  const engine = engineFor();

  turn(engine, 'I fixed the parser. One honest caveat: the error path is untested.');

  expect(sent).toHaveLength(1);
  const message = sent[0]!.payload.message;
  // The reply, verbatim and alone. Nothing names whiffle, the rule, or a tool.
  expect(body(sent[0]!)).toBe(rule.reply);
  // `shouldQuery` is the whole point of the `turn` timing: the session is idle,
  // and a queued append it never reads changes nothing.
  expect(message.shouldQuery).toBe(true);
  expect(message.origin?.kind).toBe('system');
  expect(sent[0]!.payload.urgent).toBeFalsy();
});

test('nothing in what the session reads betrays that a rule sent it', () => {
  const rule = addRule({ name: 'Honest caveat', reply: 'your work is not done yet' });
  const engine = engineFor();

  turn(engine, 'One honest caveat: the error path is untested.');

  const text = body(sent[0]!).toLowerCase();
  // A session that can see the detector games the phrase rather than the habit,
  // so none of the machinery may appear in the message it reads.
  for (const tell of ['whiffle', 'rule', 'acknowledge', 'acknowledge_rule', rule.id]) {
    expect(text).not.toContain(tell.toLowerCase());
  }
  expect(body(sent[0]!)).toBe(rule.reply);
});

test('it says nothing when the session says nothing matching', () => {
  addRule();
  const engine = engineFor();

  turn(engine, 'All the tests pass and the error path is covered.');

  expect(sent).toHaveLength(0);
});

test('an aborted turn is not held to what it half-said', () => {
  addRule();
  const engine = engineFor();

  engine.observe(INSTANCE, says('one honest caveat, though'));
  engine.observe(INSTANCE, ends('aborted'));

  expect(sent).toHaveLength(0);
});

test('it keeps firing, and counts up, until the session acknowledges', () => {
  const rule = addRule();
  const engine = engineFor();

  turn(engine, 'an honest caveat here');
  turn(engine, 'another honest caveat here');
  turn(engine, 'still an honest caveat');

  expect(sent).toHaveLength(3);
  // Every fire reads identically: a counter in the text would tell the session
  // it is being watched, which is the one thing that must not happen.
  for (const envelope of sent) expect(body(envelope)).toBe(rule.reply);
  // The escalation is real, it just lives where the reader can see it and the
  // session cannot.
  const standing = db.ruleStateFor(rule.id, INSTANCE);
  expect(standing?.status).toBe('pending');
  expect(standing?.fireCount).toBe(3);
});

test('acknowledging re-arms it, so the next reminder starts over', () => {
  const rule = addRule();
  const engine = engineFor();

  turn(engine, 'an honest caveat');
  turn(engine, 'an honest caveat again');
  expect(db.ruleStateFor(rule.id, INSTANCE)?.fireCount).toBe(2);

  const acked = db.ackRule(rule.id, INSTANCE, 'I went back and tested the error path.');
  expect(acked?.status).toBe('armed');
  expect(acked?.fireCount).toBe(0);

  turn(engine, 'one more honest caveat');
  expect(sent).toHaveLength(3);
  expect(db.ruleStateFor(rule.id, INSTANCE)?.fireCount).toBe(1);
  // History survives an acknowledgement; only the escalation resets.
  expect(db.ruleStateFor(rule.id, INSTANCE)?.totalFires).toBe(3);
});

test('a rule that wants no acknowledgement fires once per session and stops', () => {
  addRule({ requireAck: false });
  const engine = engineFor();

  turn(engine, 'an honest caveat');
  turn(engine, 'an honest caveat again');
  turn(engine, 'and again, an honest caveat');

  expect(sent).toHaveLength(1);
});

test('it stops nagging at the ceiling rather than talking to a wall', () => {
  addRule();
  const engine = engineFor();

  for (let attempt = 0; attempt < RULE_FIRE_CEILING + 5; attempt += 1) {
    turn(engine, 'an honest caveat');
  }

  expect(sent).toHaveLength(RULE_FIRE_CEILING);
});

test('an immediate rule that interrupts is sent urgently, mid-message', () => {
  addRule({ timing: 'immediate', interrupt: true });
  const engine = engineFor();

  engine.observe(INSTANCE, {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'one honest ' } },
  });
  expect(sent).toHaveLength(0);

  engine.observe(INSTANCE, {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'caveat remains' } },
  });

  expect(sent).toHaveLength(1);
  expect(sent[0]!.payload.urgent).toBe(true);
  expect(sent[0]!.payload.message.shouldQuery).toBe(false);
});

test('a delta storm fires the rule once, not once per delta', () => {
  addRule({ timing: 'immediate' });
  const engine = engineFor();

  for (const text of ['an honest caveat', ' and', ' more', ' words']) {
    engine.observe(INSTANCE, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    });
  }

  expect(sent).toHaveLength(1);
});

test('a message rule fires on the message, without waking the session', () => {
  addRule({ timing: 'message' });
  const engine = engineFor();

  engine.observe(INSTANCE, says('one honest caveat'));

  expect(sent).toHaveLength(1);
  expect(sent[0]!.payload.message.shouldQuery).toBe(false);
  expect(sent[0]!.payload.urgent).toBeFalsy();
});

test("a subagent's message is its parent's tool call, not the session speaking", () => {
  addRule({ timing: 'message' });
  const engine = engineFor();

  engine.observe(INSTANCE, {
    type: 'assistant',
    parent_tool_use_id: 'toolu_1',
    message: { content: [{ type: 'text', text: 'an honest caveat' }] },
  });

  expect(sent).toHaveLength(0);
});

test('quoting the nag back does not re-trigger it — the loop this would otherwise make', () => {
  const rule = addRule();
  const engine = engineFor();

  // Exactly what the engine injects, echoed by a session answering it. Without
  // the guard this fires forever: the reply contains the phrase by definition.
  turn(
    engine,
    `You told me: [whiffle rule — ${rule.name}]\n\n${rule.reply}\n\nI have dealt with it.`
  );

  expect(sent).toHaveLength(0);
});

test('but a session tripping the phrase in its own sentence still fires', () => {
  addRule();
  const engine = engineFor();

  turn(engine, 'One honest caveat: I never ran the migration.');

  expect(sent).toHaveLength(1);
});

test('a scope that does not match the session keeps the rule quiet', () => {
  addRule({ scope: { model: 'haiku' } });
  const engine = engineFor();

  turn(engine, 'an honest caveat');

  expect(sent).toHaveLength(0);
});

test('a model scope matches a family across its dated builds', () => {
  addRule({ scope: { model: 'opus' } });
  const engine = engineFor();

  turn(engine, 'an honest caveat');

  expect(sent).toHaveLength(1);
});

test('a disabled rule is not loaded at all', () => {
  addRule({ enabled: false });
  const engine = engineFor();

  turn(engine, 'an honest caveat');

  expect(sent).toHaveLength(0);
});

test('whole-word matching refuses a hit inside a longer word', () => {
  addRule({ pattern: 'caveat', wholeWord: true });
  const engine = engineFor();

  turn(engine, 'the caveats are documented');
  expect(sent).toHaveLength(0);

  turn(engine, 'one caveat remains');
  expect(sent).toHaveLength(1);
});

test('a regex rule fires on what it describes', () => {
  addRule({ pattern: 'should (work|be fine)', matchKind: 'regex' });
  const engine = engineFor();

  turn(engine, 'I have not run it but it should work.');

  expect(sent).toHaveLength(1);
});

test('an offline machine costs the fire nothing but the send', () => {
  addRule();
  const engine = new RuleEngine({ db, agent: () => undefined });

  turn(engine, 'an honest caveat');

  expect(sent).toHaveLength(0);
});

import { expect, test } from 'bun:test';
import { ruleInScope, ruleProblem, ruleSentence, type RuleDraft, type RuleFacts } from './rules';

/**
 * A draft on today's legal defaults — `pattern` + `reply` — the shape every
 * rule saved before trigger/action/prompt existed still has. Individual tests
 * override just the field they are pushing on.
 */
const draft = (over: Partial<RuleDraft> = {}): Partial<RuleDraft> => ({
  name: 'A rule',
  enabled: true,
  trigger: 'pattern',
  pattern: 'placeholder',
  matchKind: 'phrase',
  caseSensitive: false,
  wholeWord: false,
  watch: 'text',
  action: 'reply',
  reply: 'stop that',
  prompt: null,
  timing: 'turn',
  interrupt: false,
  requireAck: true,
  scope: {},
  ...over,
});

test('pattern+reply — the shape every old rule has — is legal', () => {
  expect(ruleProblem(draft())).toEqual({});
});

test('pattern+llm is legal', () => {
  expect(
    ruleProblem(
      draft({ action: 'llm', prompt: 'watch for scope drift', requireAck: false, reply: '' })
    )
  ).toEqual({});
});

test('every-turn+llm is legal', () => {
  expect(
    ruleProblem(
      draft({
        trigger: 'every-turn',
        action: 'llm',
        pattern: '',
        prompt: 'watch every turn for stalls',
        requireAck: false,
        reply: '',
      })
    )
  ).toEqual({});
});

test('every-turn+reply is refused', () => {
  const problem = ruleProblem(draft({ trigger: 'every-turn', action: 'reply' }));
  expect(problem.trigger).toBeDefined();
  expect(problem.trigger).toMatch(/supervisor/);
});

test('llm with timing !== turn is refused', () => {
  const problem = ruleProblem(
    draft({ action: 'llm', prompt: 'a long enough prompt', requireAck: false, timing: 'message' })
  );
  expect(problem.timing).toBeDefined();
});

test('llm with an empty prompt is refused', () => {
  const problem = ruleProblem(draft({ action: 'llm', prompt: '', requireAck: false, reply: '' }));
  expect(problem.prompt).toBeDefined();
});

test('llm with a too-short prompt is refused', () => {
  const problem = ruleProblem(
    draft({ action: 'llm', prompt: 'too short', requireAck: false, reply: '' })
  );
  expect(problem.prompt).toBeDefined();
});

test('llm with requireAck: true is refused', () => {
  const problem = ruleProblem(
    draft({ action: 'llm', prompt: 'a long enough prompt', requireAck: true, reply: '' })
  );
  expect(problem.requireAck).toBeDefined();
});

test('llm does not require a reply', () => {
  const problem = ruleProblem(
    draft({ action: 'llm', prompt: 'a long enough prompt', requireAck: false, reply: '' })
  );
  expect(problem.reply).toBeUndefined();
});

test('pattern checks are skipped when trigger is every-turn', () => {
  const problem = ruleProblem(
    draft({
      trigger: 'every-turn',
      action: 'llm',
      pattern: '',
      prompt: 'a long enough prompt',
      requireAck: false,
      reply: '',
    })
  );
  expect(problem.pattern).toBeUndefined();
});

test('pattern is still required for a pattern-triggered rule', () => {
  const problem = ruleProblem(draft({ pattern: '' }));
  expect(problem.pattern).toBeDefined();
});

test('ruleSentence describes an every-turn LLM rule without a pattern', () => {
  const sentence = ruleSentence(
    draft({ trigger: 'every-turn', action: 'llm', pattern: '', prompt: 'watch everything' })
  );
  expect(sentence).toMatch(/every turn/);
  expect(sentence).toMatch(/supervisor/);
});

test('ruleSentence describes a pattern-triggered LLM rule', () => {
  const sentence = ruleSentence(draft({ action: 'llm', prompt: 'watch for stalls' }));
  expect(sentence).toMatch(/“placeholder”/);
  expect(sentence).toMatch(/supervisor/);
});

test('ruleSentence for pattern+reply is unchanged from before trigger/action existed', () => {
  const sentence = ruleSentence(draft());
  expect(sentence).toBe(
    'When a session says “placeholder”, wait for the turn to end, then wake it with your reply. It keeps firing until the session acknowledges it.'
  );
});

const FACTS = (over: Partial<RuleFacts> = {}): RuleFacts => ({
  machineId: 'machine-1',
  projectId: 'project-1',
  harness: 'claude',
  model: 'claude-opus-4-6',
  ...over,
});

test('ruleInScope: empty scope matches everything', () => {
  expect(ruleInScope({}, FACTS())).toBe(true);
});

test('ruleInScope: machineId narrows and rejects a mismatch', () => {
  expect(ruleInScope({ machineId: 'machine-1' }, FACTS())).toBe(true);
  expect(ruleInScope({ machineId: 'machine-2' }, FACTS())).toBe(false);
});

test('ruleInScope: projectId narrows and rejects a mismatch', () => {
  expect(ruleInScope({ projectId: 'project-1' }, FACTS())).toBe(true);
  expect(ruleInScope({ projectId: 'project-2' }, FACTS())).toBe(false);
});

test('ruleInScope: harness narrows and rejects a mismatch', () => {
  expect(ruleInScope({ harness: 'claude' }, FACTS())).toBe(true);
  expect(ruleInScope({ harness: 'opencode' }, FACTS())).toBe(false);
});

test('ruleInScope: model is a case-insensitive substring test', () => {
  expect(ruleInScope({ model: 'opus' }, FACTS())).toBe(true);
  expect(ruleInScope({ model: 'OPUS' }, FACTS())).toBe(true);
  expect(ruleInScope({ model: 'sonnet' }, FACTS())).toBe(false);
});

test('ruleInScope: a session with no model fails a model-scoped rule', () => {
  expect(ruleInScope({ model: 'opus' }, FACTS({ model: null }))).toBe(false);
});

test('ruleInScope: every field is ANDed', () => {
  const scope = { machineId: 'machine-1', harness: 'claude' as const, model: 'opus' };
  expect(ruleInScope(scope, FACTS())).toBe(true);
  expect(ruleInScope(scope, FACTS({ harness: 'opencode' }))).toBe(false);
  expect(ruleInScope(scope, FACTS({ machineId: 'machine-2' }))).toBe(false);
  expect(ruleInScope(scope, FACTS({ model: 'sonnet' }))).toBe(false);
});

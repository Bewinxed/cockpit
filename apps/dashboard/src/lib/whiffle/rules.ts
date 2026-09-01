import type { Rule, RuleDraft, RuleRow } from '@whiffle/core';
import { RULE_TEMPLATES } from '@whiffle/core';

/**
 * The dashboard's side of rules. Fetch wrappers in the shape `fleet.ts`
 * established — a refusal from the hub is an Elysia bare string, so `said`
 * unwraps it and every call throws a whole sentence the caller can print.
 *
 * The matching and validation live in `@whiffle/core` rather than here, on
 * purpose: the editor's test box and the hub's engine must agree about what
 * fires, and the form's refusals must be the hub's own words.
 */

export { RULE_TEMPLATES };
export type { Rule, RuleDraft, RuleRow };

/** What `GET /api/rules` answers with. */
export interface RulesPayload {
  rules: RuleRow[];
  templates: typeof RULE_TEMPLATES;
}

/**
 * One session's history with a rule, as the activity trail shows it.
 *
 * Sessions are never told that a rule exists, which makes this listing the only
 * place any of it is visible — and the reason the note a session writes is
 * worth writing: this is where it lands.
 */
export interface RuleActivity {
  ruleId: string;
  instanceId: string;
  status: 'armed' | 'pending';
  fireCount: number;
  totalFires: number;
  lastFiredAt: number | null;
  ackedAt: number | null;
  ackNote: string | null;
  /** The directory the session works in, for a reader who has to recognise it. */
  where: string;
  harness: string | null;
}

export const loadRuleActivity = (id: string): Promise<{ activity: RuleActivity[] }> =>
  send<{ activity: RuleActivity[] }>(
    `/api/rules/${encodeURIComponent(id)}/activity`,
    {},
    'load what this rule has caught'
  );

/** Elysia refuses with a bare string; JSON only when something else went wrong. */
async function said(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      return String((parsed as { message: unknown }).message);
    }
  } catch {
    // Not JSON, which is the ordinary case: the string is the sentence.
  }
  return body || `the hub answered ${response.status}`;
}

async function send<T>(url: string, init: RequestInit, attempt: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Could not ${attempt} — ${await said(response)}.`);
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const loadRules = (): Promise<RulesPayload> =>
  send<RulesPayload>('/api/rules', {}, 'load the rules');

/** Create: the hub mints the id and answers with the whole rule. */
export const createRule = (draft: RuleDraft): Promise<Rule> =>
  send<Rule>('/api/rules', { method: 'POST', ...json(draft) }, `save ${draft.name || 'the rule'}`);

/** Edit: strictly an existing id — the hub 404s anything it never minted. */
export const saveRule = (id: string, draft: RuleDraft): Promise<Rule> =>
  send<Rule>(
    `/api/rules/${encodeURIComponent(id)}`,
    { method: 'PUT', ...json(draft) },
    `save ${draft.name || 'the rule'}`
  );

export const removeRule = async (id: string, name: string): Promise<void> => {
  const response = await fetch(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Could not delete ${name} — ${await said(response)}.`);
};

/** A blank rule, on the defaults that make the common case one field of typing. */
export const blankRule = (): RuleDraft => ({
  name: '',
  enabled: true,
  pattern: '',
  matchKind: 'phrase',
  caseSensitive: false,
  wholeWord: false,
  watch: 'text',
  reply: '',
  // Waking an idle session is what makes a rule change what the session does;
  // the other two timings are for the cases where that is too late.
  timing: 'turn',
  interrupt: false,
  requireAck: true,
  scope: {},
});

/** Strips a saved rule back to a draft, so the editor holds one shape either way. */
export const draftOf = (rule: Rule): RuleDraft => ({
  name: rule.name,
  enabled: rule.enabled,
  pattern: rule.pattern,
  matchKind: rule.matchKind,
  caseSensitive: rule.caseSensitive,
  wholeWord: rule.wholeWord,
  watch: rule.watch,
  reply: rule.reply,
  timing: rule.timing,
  interrupt: rule.interrupt,
  requireAck: rule.requireAck,
  scope: { ...rule.scope },
});

/** Whatever the caller threw, as a sentence. Every panel in this app has one. */
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** "3 minutes ago", and "never" for a rule that has not caught anything yet. */
export function since(at: number | null): string {
  if (at === null) return 'never';
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** `1 time` / `4 times`, because "4 time" in a settings list is a tell. */
export const times = (count: number): string => `${count} time${count === 1 ? '' : 's'}`;

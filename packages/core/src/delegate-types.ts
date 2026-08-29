/**
 * Delegate types: named presets a calling agent selects via the `delegate`
 * tool's `type` param, so routing is by description ("explore the codebase")
 * instead of a raw model string the caller has to already know. The hub owns
 * the fleet-wide set; a daemon resolves a name against it before it ever
 * builds a `SpawnPayload`.
 */

/** How hard the model should think — the same vocabulary `effort` already uses elsewhere. */
export type DelegateEffort = 'low' | 'medium' | 'high' | 'max';

/** One named preset. `name` is the key a `delegate` call's `type` asks for. */
export interface DelegateType {
  /** Unique across the fleet; what a `delegate` call's `type` param names. */
  name: string;
  /** What the calling model reads to decide whether this is the right type. */
  description: string;
  harness: 'claude' | 'opencode' | 'pi';
  model: string;
  effort?: DelegateEffort;
  skills?: string[];
  denyTools?: string[];
}

/** What a name may be. Mirrors a subagent's own `AGENT_NAME` — no reason to invent a second rule. */
export const DELEGATE_TYPE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Why this row cannot be stored, in a sentence, or nothing when it can. One
 * rule for the hub's refusal and any editor built on top of it.
 */
export const delegateTypeProblem = (draft: Partial<DelegateType>): string | undefined => {
  if (!draft.name || !DELEGATE_TYPE_NAME.test(draft.name)) {
    return 'a delegate type needs a name: lowercase letters, digits and hyphens only';
  }
  if (!draft.description?.trim()) {
    return 'a delegate type needs a description — it is the whole of how the calling model routes to it';
  }
  if (!draft.harness || !['claude', 'opencode', 'pi'].includes(draft.harness)) {
    return `“${draft.harness}” is not a harness a delegate type can run on`;
  }
  if (!draft.model?.trim()) {
    return 'a delegate type needs a model';
  }
  if (draft.effort && !['low', 'medium', 'high', 'max'].includes(draft.effort)) {
    return `“${draft.effort}” is not an effort level`;
  }
  // denyTools is enforced by the claude adapter alone — it writes into the
  // spawned session's own settings.deny, the mechanism opencode and pi have
  // no equivalent of. A type that names denyTools on another harness would
  // store a promise nothing enforces, which is worse than refusing it here.
  if (draft.denyTools?.length && draft.harness !== 'claude') {
    return `denyTools only applies to the claude harness — “${draft.harness}” cannot enforce it`;
  }
  return undefined;
};

/**
 * The fleet's seed set (inserted once, only when the table is empty): the
 * five routing decisions already made for cockpit's own delegation surface.
 */
export const DEFAULT_DELEGATE_TYPES: DelegateType[] = [
  {
    name: 'explore',
    description:
      'Read-only codebase exploration and fan-out search; returns conclusions, not file dumps.',
    harness: 'claude',
    model: 'sonnet',
    effort: 'low',
    denyTools: ['Write', 'Edit', 'NotebookEdit'],
  },
  {
    name: 'plan',
    description:
      'Architecture and implementation planning; returns a step-by-step plan with file paths and tradeoffs.',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    denyTools: ['Write', 'Edit', 'NotebookEdit'],
  },
  {
    name: 'code',
    description: 'Implementation from a clear spec: write/edit code, run tests, report with evidence.',
    harness: 'claude',
    model: 'sonnet',
    effort: 'high',
  },
  {
    name: 'review',
    description: 'Fresh-eyes code review of a diff or change set; returns ranked findings with file:line.',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    denyTools: ['Write', 'Edit', 'NotebookEdit'],
  },
  {
    name: 'research',
    description: 'Web and docs research; returns a cited factual brief.',
    harness: 'claude',
    model: 'sonnet',
    effort: 'medium',
  },
];

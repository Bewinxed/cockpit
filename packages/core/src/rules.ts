import type { HarnessKind } from "./harness";

/**
 * Rules: standing instructions the hub enforces on every session, without the
 * model's cooperation and without touching any harness's own hook system.
 *
 * The hub already watches every frame from every machine on its way to the
 * dashboards, so it is the one place that can read what a session said and
 * answer it. A rule is a phrase to watch for and a sentence to send back when
 * it shows up.
 *
 * The part that makes a rule stick is the acknowledgement. A nudge the model
 * can read and move past is a nudge the model will read and move past, so a
 * fired rule stays *pending* until the session calls `acknowledge_rule` and
 * says what it did about it. While it is pending every further match fires
 * again — the rule nags. Acknowledging re-arms it, so the same rule can catch
 * the same habit later in the same session.
 */

/** How {@link Rule.pattern} is read. */
export type RuleMatchKind = "phrase" | "regex";

/** Which part of the session's output a rule reads. */
export type RuleWatch = "text" | "thinking" | "both";

/**
 * When the reply is delivered.
 *
 * - `turn` — the session has stopped and is idle, so the reply wakes it into a
 *   new turn. This is the one that makes a session keep working.
 * - `message` — queued the moment the assistant message that matched is
 *   complete; the session reads it at the next turn boundary without being
 *   interrupted.
 * - `immediate` — sent the moment the phrase appears mid-stream, optionally
 *   interrupting the turn in flight ({@link Rule.interrupt}).
 */
export type RuleTiming = "turn" | "message" | "immediate";

/**
 * What starts a rule's evaluation.
 *
 * - `pattern` — the phrase/regex match this file has always done: a rule
 *   fires when {@link Rule.pattern} shows up.
 * - `every-turn` — there is nothing to match; every turn end is itself the
 *   trigger. Only the supervisor can act on that (see {@link RuleAction}),
 *   since nothing about the turn has been read yet to answer with a fixed
 *   reply.
 */
export type RuleTrigger = "pattern" | "every-turn";

/**
 * What a firing rule does.
 *
 * - `reply` — send {@link Rule.reply}, verbatim, the way every rule has
 *   always fired.
 * - `llm` — hand the turn to the supervisor and send back whatever it
 *   decides. Only fires at the `turn` timing (the supervisor judges a
 *   finished turn, not a half-typed message) and never waits for an
 *   acknowledgement (it decides fresh every time, rather than nagging).
 */
export type RuleAction = "reply" | "llm";

/**
 * What narrows a rule from "every session on the fleet" to some of them. Every
 * field is optional and they are ANDed; an empty scope is the default and means
 * everywhere. `model` is a substring test, so `opus` covers every dated build
 * of it.
 */
export interface RuleScope {
  harness?: HarnessKind;
  machineId?: string;
  model?: string;
  projectId?: string;
}

/** The instance facts a {@link RuleScope} is tested against. */
export interface RuleFacts {
  harness: string | null;
  machineId: string;
  model: string | null;
  projectId: string | null;
}

/** One standing instruction. */
export interface Rule {
  /** What the rule does when it fires. Default `'reply'` — the only kind before this existed. */
  action: RuleAction;
  caseSensitive: boolean;
  createdAt: number;
  enabled: boolean;
  id: string;
  /** `immediate` only: cut into the running turn rather than queueing. */
  interrupt: boolean;
  matchKind: RuleMatchKind;
  /** What the rule is called in the list, and in the reply the session reads. */
  name: string;
  /** The phrase to watch for, or a regular expression when `matchKind` says so. */
  pattern: string;
  /** `action: 'llm'` only: the operator's standing instructions for the supervisor. */
  prompt: string | null;
  /** What the session is sent when the rule fires. Ignored (and not required) when `action` is `'llm'`. */
  reply: string;
  /**
   * Stay pending until the session acknowledges, firing again on every further
   * match. Off makes the rule fire once per session and then go quiet.
   */
  requireAck: boolean;
  scope: RuleScope;
  timing: RuleTiming;
  /** What starts the evaluation. Default `'pattern'` — every rule before this existed. */
  trigger: RuleTrigger;
  watch: RuleWatch;
  /** Phrase mode only: refuse matches that sit inside a longer word. */
  wholeWord: boolean;
}

/** A rule as it arrives from the dashboard, before the hub gives it an id. */
export type RuleDraft = Omit<Rule, "id" | "createdAt">;

/** Where one rule stands with one session. */
export interface RuleState {
  ackedAt: number | null;
  /** What the session said it did about it, when it acknowledged. */
  ackNote: string | null;
  /** Fires since the last acknowledgement. Drives the escalating reminder. */
  fireCount: number;
  instanceId: string;
  lastFiredAt: number | null;
  ruleId: string;
  /** `pending` means fired and not yet acknowledged — it will fire again. */
  status: "armed" | "pending";
  /** Fires over the session's whole life, which acknowledging does not reset. */
  totalFires: number;
}

/** What the list needs to show about a rule without loading every session's state. */
export interface RuleStats {
  lastFiredAt: number | null;
  /** Sessions that have fired this rule and not answered for it yet. */
  pending: number;
  ruleId: string;
  /** Every fire, ever. */
  totalFires: number;
}

/** A rule plus what it has been doing. */
export interface RuleRow extends Rule {
  stats: RuleStats;
}

/** How long a body of text a rule will read. Longer than this and it reads the tail. */
export const RULE_SCAN_LIMIT = 200_000;

/** The most times a rule nags one session before the hub gives up on it. */
export const RULE_FIRE_CEILING = 10;

const RESERVED = /[.*+?^${}()|[\]\\]/g;
const escape = (text: string): string => text.replace(RESERVED, "\\$&");

/**
 * The matcher, shared deliberately: the hub decides with it and the editor's
 * test box previews with it, so what the editor shows is what the fleet does.
 * Returns undefined for a pattern that cannot compile — {@link ruleProblem}
 * is what explains why.
 */
export function ruleRegex(
  rule: Pick<Rule, "pattern" | "matchKind" | "caseSensitive" | "wholeWord">
): RegExp | undefined {
  const flags = rule.caseSensitive ? "g" : "gi";
  const body =
    rule.matchKind === "regex"
      ? rule.pattern
      : rule.wholeWord
        ? `\\b${escape(rule.pattern)}\\b`
        : escape(rule.pattern);
  try {
    return new RegExp(body, flags);
  } catch {
    return undefined;
  }
}

/** Every place `rule` hits `text`, as offsets — the test box highlights these. */
export function ruleHits(
  rule: Pick<Rule, "pattern" | "matchKind" | "caseSensitive" | "wholeWord">,
  text: string
): { start: number; end: number }[] {
  if (rule.pattern.trim() === "") {
    return [];
  }
  const expression = ruleRegex(rule);
  if (!expression) {
    return [];
  }
  const read =
    text.length > RULE_SCAN_LIMIT ? text.slice(-RULE_SCAN_LIMIT) : text;
  const found: { start: number; end: number }[] = [];
  const offset = text.length - read.length;
  for (const match of read.matchAll(expression)) {
    if (match.index === undefined) {
      continue;
    }
    // A zero-width pattern matches everywhere and highlights nothing; treating
    // it as no match is kinder than freezing the editor on every keystroke.
    if (match[0] === "") {
      continue;
    }
    found.push({
      start: offset + match.index,
      end: offset + match.index + match[0].length,
    });
    if (found.length >= 500) {
      break;
    }
  }
  return found;
}

/** Whether `rule` fires on `text` at all. */
export const ruleMatches = (
  rule: Pick<Rule, "pattern" | "matchKind" | "caseSensitive" | "wholeWord">,
  text: string
): boolean => ruleHits(rule, text).length > 0;

/**
 * The shortest an LLM rule's prompt (or an autopilot standing prompt) can be
 * and still count as an instruction rather than noise. Matches the
 * acknowledgement-note floor the hub already enforces
 * (`packages/hub/src/server.ts`, `/api/rules/ack`) — under ten characters is
 * not a sentence there either.
 */
const MIN_LLM_PROMPT = 10;

/**
 * Everything wrong with a draft, as whole sentences the form can print under
 * the field that caused it. Empty means it is safe to save.
 */
export function ruleProblem(draft: Partial<RuleDraft>): Record<string, string> {
  const wrong: Record<string, string> = {};
  if (!draft.name?.trim()) {
    wrong.name = "Give the rule a name so you can recognise it later.";
  }

  const trigger = draft.trigger ?? "pattern";
  const action = draft.action ?? "reply";

  // `every-turn` has nothing to match against — a fixed reply cannot answer a
  // turn it never read, so only the supervisor can be behind it.
  if (trigger === "every-turn" && action !== "llm") {
    wrong.trigger =
      "An every-turn rule has nothing to match, so only the supervisor can act on it — set the action to LLM.";
  }

  if (trigger === "pattern") {
    const pattern = draft.pattern ?? "";
    if (pattern.trim() === "") {
      wrong.pattern = "A rule needs something to watch for.";
    } else if (draft.matchKind === "regex") {
      try {
        const compiled = new RegExp(pattern);
        if (compiled.test("")) {
          wrong.pattern =
            "This expression matches empty text, so it would fire on every message.";
        }
      } catch (error) {
        wrong.pattern = `That is not a valid regular expression — ${
          error instanceof Error
            ? error.message.replace(/^Invalid regular expression:\s*/, "")
            : "it will not compile"
        }.`;
      }
    } else if (pattern.trim().length < 3) {
      wrong.pattern =
        "Two characters will match almost everything. Watch for something longer.";
    }
  }

  if (action === "reply" && !draft.reply?.trim()) {
    wrong.reply = "Write what the session should be told when this fires.";
  }

  if (action === "llm") {
    if (draft.timing !== undefined && draft.timing !== "turn") {
      wrong.timing =
        "The supervisor judges a finished turn, not a message in progress — an LLM rule only fires at the turn boundary.";
    }
    if ((draft.prompt ?? "").trim().length < MIN_LLM_PROMPT) {
      wrong.prompt =
        "Tell the supervisor what to watch for and how to respond — that is too short to be an instruction.";
    }
    if (draft.requireAck) {
      wrong.requireAck =
        "The supervisor decides fresh every time it fires — it does not wait for the session to acknowledge.";
    }
  }

  if (draft.timing !== "immediate" && draft.interrupt) {
    wrong.interrupt =
      "Only an immediate rule can interrupt — the other two wait for a boundary.";
  }
  return wrong;
}

/**
 * The rule read back as one English sentence. The editor prints it live above
 * the form, so the thing being configured stays legible while it is configured.
 */
export function ruleSentence(rule: Partial<RuleDraft>): string {
  const narrowing: string[] = [];
  if (rule.scope?.harness) {
    narrowing.push(`${rule.scope.harness} sessions`);
  }
  if (rule.scope?.model) {
    narrowing.push(`models matching ${rule.scope.model}`);
  }
  if (rule.scope?.projectId) {
    narrowing.push("one project");
  }
  if (rule.scope?.machineId) {
    narrowing.push("one machine");
  }
  const scope = narrowing.length ? ` In ${narrowing.join(" and ")} only.` : "";

  if (rule.trigger === "every-turn") {
    // Nothing is matched — every turn end is the trigger, and only the
    // supervisor can be behind that (ruleProblem refuses any other action).
    return `At the end of every turn, ask the supervisor to judge it and reply as it decides.${scope}`;
  }

  const where =
    rule.watch === "thinking"
      ? "thinks"
      : rule.watch === "both"
        ? "says or thinks"
        : "says";
  const what =
    rule.matchKind === "regex"
      ? // Quoted like a phrase is: an expression set loose in the middle of a
        // sentence has no visible end, and `|` reads as prose punctuation.
        `something matching “${rule.pattern || "…"}”`
      : `“${rule.pattern || "…"}”`;

  if (rule.action === "llm") {
    // Illegal to pair with anything but `timing: 'turn'`, so the wake-into-a-
    // new-turn phrasing is the only one that ever applies here.
    return `When a session ${where} ${what}, wait for the turn to end, then ask the supervisor to judge it and reply as it decides.${scope}`;
  }

  const when =
    rule.timing === "immediate"
      ? rule.interrupt
        ? "interrupt it straight away and send"
        : "send, without waiting for the message to finish"
      : rule.timing === "message"
        ? "wait for that message to finish, then send"
        : "wait for the turn to end, then wake it with";
  const nag = rule.requireAck
    ? " It keeps firing until the session acknowledges it."
    : " It fires once per session.";
  return `When a session ${where} ${what}, ${when} your reply.${scope}${nag}`;
}

/**
 * Starting points offered on the empty state. The first is the one this whole
 * feature was built for.
 */
export const RULE_TEMPLATES: {
  title: string;
  blurb: string;
  draft: RuleDraft;
}[] = [
  {
    title: "Honest caveat",
    blurb: "Catches a session reporting a known problem instead of fixing it.",
    draft: {
      name: "Honest caveat",
      enabled: true,
      trigger: "pattern",
      pattern: "honest caveat",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "reply",
      reply:
        "if there's an honest caveat that you are aware of and you're just reporting it to the user instead of fixing it, then your work is not done yet",
      prompt: null,
      timing: "turn",
      interrupt: false,
      requireAck: true,
      scope: {},
    },
  },
  {
    title: "Placeholder code",
    blurb: "Catches a stub left behind where an implementation was asked for.",
    draft: {
      name: "Placeholder code",
      enabled: true,
      trigger: "pattern",
      pattern: "for (now|brevity)|placeholder|TODO: implement|stub(bed)? out",
      matchKind: "regex",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "reply",
      reply:
        "You left a placeholder. Go back and write the real implementation, or tell me exactly what is blocking you from writing it.",
      prompt: null,
      timing: "turn",
      interrupt: false,
      requireAck: true,
      scope: {},
    },
  },
  {
    title: "Unverified claim",
    blurb: 'Catches "should work" before anything was actually run.',
    draft: {
      name: "Unverified claim",
      enabled: true,
      trigger: "pattern",
      pattern: "should (work|be fine)|probably works|I believe (this|it) works",
      matchKind: "regex",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "reply",
      reply:
        "You said it should work. Run it and report what actually happened, with the output.",
      prompt: null,
      timing: "turn",
      interrupt: false,
      requireAck: true,
      scope: {},
    },
  },
];

/**
 * Whether a scope covers a session with these facts — the check both engines
 * make before a matched rule is allowed to fire, so a rule scoped to one
 * machine or one model stays quiet everywhere else. Every field is ANDed; an
 * empty scope matches everything.
 */
export function ruleInScope(scope: RuleScope, facts: RuleFacts): boolean {
  if (scope.machineId && scope.machineId !== facts.machineId) {
    return false;
  }
  if (scope.projectId && scope.projectId !== facts.projectId) {
    return false;
  }
  if (scope.harness && scope.harness !== facts.harness) {
    return false;
  }
  if (scope.model) {
    // Substring, so `opus` covers every dated build of it and the user does
    // not have to keep the filter in step with model releases.
    if (!facts.model?.toLowerCase().includes(scope.model.toLowerCase())) {
      return false;
    }
  }
  return true;
}

import type {
  Envelope,
  NeutralMessage,
  NeutralAssistantMessage,
  Rule,
  RuleFacts,
  SendPayload,
  SupervisorEvent,
} from '@whiffle/core';
import {
  RULE_FIRE_CEILING,
  RULE_SCAN_LIMIT,
  readEnv,
  ruleInScope,
  ruleMatches,
  WHIFFLE_ENV,
} from '@whiffle/core';
import type { DbShape } from './db';
import { verdictFor } from './llm';

// ── constants (all sourced from PLAN.md C3) ────────────────────────────

/** Two concurrent LLM calls — one GPU box; slot 2 stops cold-start head-of-line blocking. */
const SUPERVISOR_MAX_CONCURRENT = 2;

/** Pending evaluations beyond this are dropped as `skipped`. */
const SEMAPHORE_QUEUE_CAP = 16;

/** The most supervisor-initiated turns before a forced escalation (PLAN.md C3: our choice). */
const SUPERVISOR_CONSECUTIVE_MAX = 3;

/** Per-evaluation budget including cold-start time (PLAN.md C3: 240 000 ms). */
const EVALUATION_TIMEOUT_MS = 240_000;

/** User block size cap (PLAN.md C2: ~6K tokens, our choice). */
const USER_BLOCK_LIMIT = 24_000;

/** Files touched per turn cap (PLAN.md C2: our choice). */
const FILES_CAP = 40;

// ── sender shape (mirrors RuleEngine's RuleSender) ─────────────────────

export interface SupervisorSender {
  send: (envelope: Envelope<SendPayload>) => void;
}

export interface SupervisorEngineDeps {
  db: DbShape;
  agent: (machineId: string) => SupervisorSender | undefined;
  telegram?: { onSupervisor(instanceId: string, text: string): void };
  publish: (instanceId: string, event: SupervisorEvent) => void;
}

// ── per-instance state ─────────────────────────────────────────────────

interface InstanceState {
  /** Text the session spoke this turn (subagent frames excluded). */
  turn: string[];
  /** Files touched this turn, deduped. */
  files: Set<string>;
  /** Bash commands this turn. */
  commands: string[];
  /** Whether the last turn was initiated by our own reply. */
  initiatedTurn: boolean;
  /** How many consecutive supervisor-initiated turns. */
  consecutive: number;
  /** Muted until a non-supervisor-initiated turn resets. */
  muted: boolean;
  /** Whether an evaluation is currently in flight. */
  inFlight: boolean;
  /** Timestamp of the result frame that triggered the current/last evaluation. */
  resultTimestamp: number;
}

const freshState = (): InstanceState => ({
  turn: [],
  files: new Set(),
  commands: [],
  initiatedTurn: false,
  consecutive: 0,
  muted: false,
  inFlight: false,
  resultTimestamp: 0,
});

// ── semaphore ──────────────────────────────────────────────────────────

class Semaphore {
  #active = 0;
  readonly #max: number;
  readonly #queueCap: number;
  readonly #queue: Array<() => void> = [];

  constructor(max: number, queueCap: number) {
    this.#max = max;
    this.#queueCap = queueCap;
  }

  /** Returns true if a slot is available (possibly after waiting), false if the queue overflowed. */
  async acquire(): Promise<boolean> {
    if (this.#active < this.#max) {
      this.#active++;
      return true;
    }
    if (this.#queue.length >= this.#queueCap) return false;
    return new Promise<boolean>((resolve) => {
      this.#queue.push(() => {
        this.#active++;
        resolve(true);
      });
    });
  }

  release(): void {
    const next = this.#queue.shift();
    if (next) {
      next();
    } else {
      this.#active--;
    }
  }
}

// ── the engine ─────────────────────────────────────────────────────────

/** The text blocks of an assistant message, joined — tool calls are not speech. */
const spoken = (message: NeutralAssistantMessage): string =>
  message.message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');

/**
 * The fixed adversarial harness preamble (PLAN.md C2 "Prompt assembly").
 * Stance: skeptical auditor, operator's voice, opaque to the session.
 *
 * Anti-tell variation (operator rationale): if the session model detects
 * automated or repetitive supervision it will adapt to evade detection —
 * manipulating phrasing to slip past the pattern rather than fixing the
 * behavior. So the preamble enforces: (1) never reuse phrasing from prior
 * messages (the log is in the payload), (2) prefer escalate over a similar
 * reply when the same violation recurs, (3) keep replies short and irregular
 * like real operator messages, not uniform paragraph-shaped critiques.
 */
const HARNESS_PREAMBLE = `You are the operator supervising an AI coding-agent session. You reply on the operator's behalf — write in first person, terse, the way a human operator types into a chat. You are NEVER revealed to the agent: do not mention "the supervisor", "as an AI", "monitoring", "automated", rules, or any meta about this system. The agent must read your words as the operator's own.

Be a skeptical auditor:
- A completion claim without evidence (test output, a screenshot, a measurement) is unverified — demand the proof.
- "Would you like me to…" is a stall — tell it to proceed.
- Numbers without a source are suspect — ask where they came from.
- Silently narrowed scope is desertion — call it out and demand the full scope.
- Files touched without evidence they are in scope is drift — point it out.

You NEVER answer permission prompts. Those go to the operator through a different channel.

Default to silent when the turn is honest work in progress. Only speak when there is something worth correcting, and be brief when you do.

Anti-tell variation — read these rules carefully:
- The payload includes your last 3 messages to this session. NEVER reuse phrasing from those prior messages — vary your wording naturally as a human would. A repeated sentence is a tell.
- If the SAME violation recurs after a prior intervention (check the log), prefer verdict "escalate" over sending a similar reply. A repeated correction is both a tell and evidence that your intervention is not working.
- Keep replies short and irregular — two words, half a sentence, a blunt question. Never write uniform paragraph-shaped critiques. Real operator messages are clipped, uneven, and unstyled.

Your verdict must be one of:
- "silent" — the turn is fine; say nothing.
- "reply" — send your message into the session as the operator.
- "escalate" — flag this for the operator's attention via Telegram.
- "ask_operator" — ask the operator a question via Telegram (autopilot only).

Return a JSON object with fields: verdict, message, note.`;

export class SupervisorEngine {
  readonly #db: DbShape;
  readonly #agent: (machineId: string) => SupervisorSender | undefined;
  readonly #telegram?: { onSupervisor(instanceId: string, text: string): void };
  readonly #publish: (instanceId: string, event: SupervisorEvent) => void;
  readonly #state = new Map<string, InstanceState>();
  readonly #semaphore = new Semaphore(SUPERVISOR_MAX_CONCURRENT, SEMAPHORE_QUEUE_CAP);

  constructor({ db, agent, telegram, publish }: SupervisorEngineDeps) {
    this.#db = db;
    this.#agent = agent;
    this.#telegram = telegram;
    this.#publish = publish;
  }

  /** Drop all tracked state for a finished session. */
  forget(instanceId: string): void {
    this.#state.delete(instanceId);
  }

  /**
   * The operator touched this session — a dashboard or Telegram send relayed
   * by the hub. This is the ONLY thing that clears a consecutive-cap mute:
   * the cap exists to hand control back to the human, so only the human's
   * hand takes it off.
   */
  noteHumanSend(instanceId: string): void {
    const state = this.#state.get(instanceId);
    if (!state) return;
    state.consecutive = 0;
    state.initiatedTurn = false;
    state.muted = false;
  }

  /**
   * One frame — called right after `ruleEngine.observe`, same throw-nothing
   * envelope. Never awaits the LLM; evaluation is fire-and-forget.
   */
  observe(instanceId: string, message: NeutralMessage): void {
    try {
      this.#observe(instanceId, message);
    } catch (error) {
      console.error(`[supervisor] ${instanceId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  #observe(instanceId: string, message: NeutralMessage): void {
    if (message.type === 'assistant') {
      // Subagent frames excluded — same discipline as RuleEngine (rules.ts:152).
      if (message.parent_tool_use_id) return;
      const state = this.#ensureState(instanceId);
      const text = spoken(message);
      if (text) state.turn.push(text);
      this.#extractFiles(state, message);
      return;
    }

    if (message.type === 'result') {
      const state = this.#ensureState(instanceId);
      if (message.subtype === 'aborted') {
        // Aborted: flush buffers, no evaluation.
        state.turn = [];
        state.files.clear();
        state.commands = [];
        return;
      }
      // Schedule evaluation — fire-and-forget, off the frame path.
      const turnText = state.turn.join('\n\n');
      const files = [...state.files].slice(0, FILES_CAP);
      const commands = [...state.commands];
      const now = Date.now();
      state.resultTimestamp = now;
      // Flush buffers for the next turn.
      state.turn = [];
      state.files.clear();
      state.commands = [];
      // Attribution: consume the initiatedTurn flag.
      if (state.initiatedTurn) {
        state.consecutive++;
        state.initiatedTurn = false;
      } else {
        // A non-supervisor turn resets the streak, but NOT the mute: rules
        // and delegates also start turns, and letting them unmute would let
        // the supervisor ping-pong with another automated sender forever.
        // Only an actual human send (noteHumanSend, called from the hub's
        // relay points) takes the mute off.
        state.consecutive = 0;
      }
      void this.#evaluate(instanceId, turnText, files, commands, now).catch(() => {});
      return;
    }
  }

  /** Walk assistant frames for tool_use blocks to extract file paths and commands. */
  #extractFiles(state: InstanceState, message: NeutralAssistantMessage): void {
    for (const block of message.message.content) {
      if (block.type !== 'tool_use') continue;
      const input = block.input as Record<string, unknown>;
      for (const key of ['file_path', 'path', 'notebook_path'] as const) {
        const val = input[key];
        if (typeof val === 'string' && val) state.files.add(val);
      }
      if (typeof input.command === 'string' && input.command) {
        state.commands.push(input.command);
      }
    }
  }

  #ensureState(instanceId: string): InstanceState {
    const found = this.#state.get(instanceId);
    if (found) return found;
    const made = freshState();
    this.#state.set(instanceId, made);
    return made;
  }

  // ── evaluation ─────────────────────────────────────────────────────────

  async #evaluate(
    instanceId: string,
    turnText: string,
    files: string[],
    commands: string[],
    resultTimestamp: number,
  ): Promise<void> {
    const state = this.#ensureState(instanceId);

    // Loop guard 1: one in flight per instance.
    if (state.inFlight) {
      const event = this.#record(instanceId, {
        source: 'autopilot',
        verdict: 'skipped',
        note: 'in-flight',
      });
      this.#publish(instanceId, event);
      return;
    }

    // Loop guard: muted until the operator sends into the session
    // (noteHumanSend) — no turn, however initiated, clears it on its own.
    if (state.muted) {
      const event = this.#record(instanceId, {
        source: 'autopilot',
        verdict: 'skipped',
        note: 'muted (consecutive cap reached)',
      });
      this.#publish(instanceId, event);
      return;
    }

    // Resolve config at evaluation time — DB wins, env fallback.
    const config = this.#resolveConfig();
    if (!config) return; // Not configured — engine inert.

    // Look up the instance row for facts and autopilot.
    const row = this.#db.listInstances().find((r) => r.id === instanceId);
    if (!row) return;

    const facts: RuleFacts = {
      machineId: row.machineId,
      projectId: (row as { projectId?: string | null }).projectId ?? null,
      harness: (row as { harness?: string | null }).harness ?? null,
      model: (row as { model?: string | null }).model ?? null,
    };

    // Selection: autopilot enabled > first in-scope llm rule (createdAt asc).
    const selection = this.#select(instanceId, row, facts, turnText);
    if (!selection) return;

    state.inFlight = true;

    // Global semaphore — cap concurrent LLM calls.
    const acquired = await this.#semaphore.acquire();
    if (!acquired) {
      state.inFlight = false;
      const event = this.#record(instanceId, {
        source: selection.source,
        ruleId: selection.ruleId,
        verdict: 'skipped',
        note: 'semaphore queue full',
      });
      this.#publish(instanceId, event);
      return;
    }

    try {
      // Assemble the prompt.
      const system = `${HARNESS_PREAMBLE}\n\nOperator instructions:\n${selection.prompt}`;
      const user = this.#assembleUserBlock(instanceId, row, facts, turnText, files, commands, state);

      const result = await verdictFor({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        system,
        user,
        timeoutMs: EVALUATION_TIMEOUT_MS,
      });

      // Loop guard 4: staleness — a newer result arrived before we could deliver.
      if (state.resultTimestamp > resultTimestamp) {
        state.inFlight = false;
        const event = this.#record(instanceId, {
          source: selection.source,
          ruleId: selection.ruleId,
          verdict: 'skipped',
          note: 'stale (newer result arrived)',
        });
        this.#publish(instanceId, event);
        return;
      }

      if ('error' in result) {
        state.inFlight = false;
        const event = this.#record(instanceId, {
          source: selection.source,
          ruleId: selection.ruleId,
          verdict: 'error',
          note: result.error,
          model: config.model,
        });
        this.#publish(instanceId, event);
        return;
      }

      const { verdict } = result;

      // Coerce ask_operator from a rule to escalate (PLAN.md C2).
      let effectiveVerdict = verdict.verdict;
      let coercionNote: string | undefined;
      if (verdict.verdict === 'ask_operator' && selection.source === 'rule') {
        effectiveVerdict = 'escalate';
        coercionNote = 'ask_operator coerced to escalate (from rule)';
      }

      // Loop guard 3: consecutive cap — force escalate + mute.
      if (effectiveVerdict === 'reply' && state.consecutive >= SUPERVISOR_CONSECUTIVE_MAX) {
        effectiveVerdict = 'escalate';
        coercionNote = `autopilot hit its consecutive-reply limit (${SUPERVISOR_CONSECUTIVE_MAX})`;
        state.muted = true;
      }

      if (effectiveVerdict === 'silent') {
        state.inFlight = false;
        const event = this.#record(instanceId, {
          source: selection.source,
          ruleId: selection.ruleId,
          verdict: 'silent',
          note: verdict.note || null,
          model: result.model,
          latencyMs: result.latencyMs,
        });
        this.#publish(instanceId, event);
        return;
      }

      if (effectiveVerdict === 'reply') {
        // Re-check instance + agent reachability before delivery.
        const freshRow = this.#db.listInstances().find((r) => r.id === instanceId);
        const sender = freshRow ? this.#agent(freshRow.machineId) : undefined;
        if (!sender || !freshRow) {
          state.inFlight = false;
          const event = this.#record(instanceId, {
            source: selection.source,
            ruleId: selection.ruleId,
            verdict: 'skipped',
            note: 'unreachable',
            model: result.model,
            latencyMs: result.latencyMs,
          });
          this.#publish(instanceId, event);
          return;
        }

        // Deliver: same envelope shape as RuleEngine.#fire (rules.ts:284-304).
        const originName = selection.source === 'autopilot'
          ? 'supervisor:autopilot'
          : `supervisor:${selection.ruleName}`;

        sender.send({
          verb: 'send',
          machineId: freshRow.machineId,
          instanceId,
          payload: {
            instanceId,
            message: {
              type: 'user',
              message: { role: 'user', content: verdict.message },
              parent_tool_use_id: null,
              origin: { kind: 'system', name: originName },
              shouldQuery: true,
            },
            urgent: false,
          },
        });

        // Mark that we initiated the next turn.
        state.initiatedTurn = true;

        // Rule bookkeeping: non-silent rule verdicts call noteRuleFire.
        if (selection.source === 'rule' && selection.ruleId) {
          const standing = this.#db.ruleStateFor(selection.ruleId, instanceId);
          if (!standing || standing.fireCount < RULE_FIRE_CEILING) {
            this.#db.noteRuleFire(selection.ruleId, instanceId, false);
          }
        }

        state.inFlight = false;
        const event = this.#record(instanceId, {
          source: selection.source,
          ruleId: selection.ruleId,
          verdict: 'reply',
          message: verdict.message,
          note: coercionNote || verdict.note || null,
          model: result.model,
          latencyMs: result.latencyMs,
        });
        this.#publish(instanceId, event);
        return;
      }

      // escalate / ask_operator
      const eventVerdict = effectiveVerdict === 'ask_operator' ? 'ask' as const : 'escalate' as const;
      state.inFlight = false;

      // Rule bookkeeping for non-silent rule verdicts.
      if (selection.source === 'rule' && selection.ruleId) {
        const standing = this.#db.ruleStateFor(selection.ruleId, instanceId);
        if (!standing || standing.fireCount < RULE_FIRE_CEILING) {
          this.#db.noteRuleFire(selection.ruleId, instanceId, false);
        }
      }

      const event = this.#record(instanceId, {
        source: selection.source,
        ruleId: selection.ruleId,
        verdict: eventVerdict,
        message: verdict.message,
        note: coercionNote || verdict.note || null,
        model: result.model,
        latencyMs: result.latencyMs,
      });
      this.#publish(instanceId, event);

      // Telegram notification for escalate/ask.
      this.#telegram?.onSupervisor(instanceId, verdict.message);

    } finally {
      this.#semaphore.release();
      // Safety: ensure inFlight is cleared even on unexpected errors.
      const s = this.#state.get(instanceId);
      if (s) s.inFlight = false;
    }
  }

  // ── selection ──────────────────────────────────────────────────────────

  #select(
    instanceId: string,
    row: { autopilot?: { enabled: boolean; prompt: string; updatedAt: number } | null },
    facts: RuleFacts,
    turnText: string,
  ): { source: 'autopilot' | 'rule'; prompt: string; ruleId?: string; ruleName?: string } | null {
    // Autopilot takes priority.
    if (row.autopilot?.enabled && row.autopilot.prompt) {
      return { source: 'autopilot', prompt: row.autopilot.prompt };
    }

    // First enabled in-scope action==='llm' rule, createdAt asc.
    const rules = this.#db.listRules()
      .filter((r): r is Rule => r.enabled && r.action === 'llm' && r.timing === 'turn')
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const rule of rules) {
      if (!ruleInScope(rule.scope, facts)) continue;
      // Trigger check: every-turn always matches; pattern uses core matcher.
      if (rule.trigger === 'pattern') {
        const text = turnText.length > RULE_SCAN_LIMIT
          ? turnText.slice(-RULE_SCAN_LIMIT)
          : turnText;
        if (!ruleMatches(rule, text)) continue;
      }
      if (!rule.prompt) continue;
      return { source: 'rule', prompt: rule.prompt, ruleId: rule.id, ruleName: rule.name };
    }

    return null;
  }

  // ── prompt assembly ────────────────────────────────────────────────────

  #assembleUserBlock(
    instanceId: string,
    row: Record<string, unknown>,
    facts: RuleFacts,
    turnText: string,
    files: string[],
    commands: string[],
    state: InstanceState,
  ): string {
    const parts: string[] = [];

    // Session metadata.
    const cwd = typeof row.cwd === 'string' ? row.cwd.split('/').pop() || row.cwd : '(unknown)';
    const machine = facts.machineId;
    const harness = facts.harness || '(unknown)';
    const model = facts.model || '(unknown)';
    const title = (typeof row.title === 'string' ? row.title : null)
      || (typeof row.derivedTitle === 'string' ? row.derivedTitle : null)
      || '(untitled)';
    parts.push(`Session: ${title}\nDirectory: ${cwd} | Machine: ${machine} | Harness: ${harness} | Model: ${model}`);

    // Turn attribution.
    const selfInitiated = state.consecutive > 0;
    parts.push(`This turn was started by your own previous message: ${selfInitiated ? 'yes' : 'no'} (consecutive: ${state.consecutive})`);

    // Files touched.
    if (files.length > 0) {
      parts.push(`Files touched this turn:\n${files.map((f) => `  ${f}`).join('\n')}`);
    }
    if (commands.length > 0) {
      const shown = commands.slice(0, FILES_CAP);
      parts.push(`Commands run this turn:\n${shown.map((c) => `  ${c}`).join('\n')}`);
    }

    // Agent's final text, tail-clamped (RULE_SCAN_LIMIT precedent, core/rules.ts:153).
    if (turnText) {
      const clamped = turnText.length > RULE_SCAN_LIMIT
        ? turnText.slice(-RULE_SCAN_LIMIT)
        : turnText;
      parts.push(`Agent's turn output:\n${clamped}`);
    }

    // Last 3 supervisor log rows for this instance.
    const recentEvents = this.#db.listSupervisorEvents({ instanceId, limit: 3 });
    if (recentEvents.length > 0) {
      const lines = recentEvents.map((e) => {
        const ts = new Date(e.createdAt).toISOString();
        const msg = e.message ? ` — ${e.message.slice(0, 200)}` : '';
        const note = e.note ? ` [${e.note.slice(0, 100)}]` : '';
        return `  ${ts} ${e.verdict}${msg}${note}`;
      });
      parts.push(`Recent supervisor log:\n${lines.join('\n')}`);
    }

    // Total user block clamped to 24,000 chars (PLAN.md C2: our choice).
    let block = parts.join('\n\n');
    if (block.length > USER_BLOCK_LIMIT) {
      block = block.slice(-USER_BLOCK_LIMIT);
    }
    return block;
  }

  // ── config resolution ──────────────────────────────────────────────────

  #resolveConfig(): { baseUrl: string; model: string; apiKey?: string } | null {
    // DB row wins, env bootstraps (PLAN.md C4). A stored row — even with
    // enabled:false — is authoritative; env only fills in while no row exists.
    const dbConfig = this.#db.getSupervisorConfig();
    if (dbConfig) {
      if (!dbConfig.enabled || !dbConfig.baseUrl || !dbConfig.model) return null;
      return {
        baseUrl: dbConfig.baseUrl,
        model: dbConfig.model,
        apiKey: dbConfig.apiKey ?? undefined,
      };
    }

    // Env fallback — no DB row exists.
    const baseUrl = readEnv(WHIFFLE_ENV.supervisorUrl);
    const model = readEnv(WHIFFLE_ENV.supervisorModel);
    if (baseUrl && model) {
      return {
        baseUrl,
        model,
        apiKey: readEnv(WHIFFLE_ENV.supervisorKey),
      };
    }

    return null;
  }

  // ── recording ──────────────────────────────────────────────────────────

  #record(instanceId: string, data: {
    source: 'rule' | 'autopilot';
    ruleId?: string;
    verdict: SupervisorEvent['verdict'];
    message?: string | null;
    note?: string | null;
    model?: string | null;
    latencyMs?: number | null;
  }): SupervisorEvent {
    return this.#db.recordSupervisorEvent({
      instanceId,
      source: data.source,
      ruleId: data.ruleId,
      verdict: data.verdict,
      message: data.message ?? undefined,
      note: data.note ?? undefined,
      model: data.model ?? undefined,
      latencyMs: data.latencyMs ?? undefined,
    });
  }
}

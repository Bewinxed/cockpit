/**
 * The Claude Code adapter.
 *
 * The original harness — everything whiffle did before harnesses existed ran on
 * it, so this file is the quarry the other adapters are measured against. It
 * spawns `@anthropic-ai/claude-agent-sdk`'s `query()`, feeds it an
 * `AsyncIterable` prompt, parks `canUseTool` under the SDK's `requestId`, and
 * translates SDK messages into the neutral spine. The translation is a re-tag:
 * the neutral types mirror the SDK's field names, so a message crosses the wire
 * with its `raw` self attached and nothing lost.
 */
import {
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  tagSession,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AuthState,
  EffortLevel,
  HarnessCapabilities,
  HarnessReport,
  NeutralMessage,
  NeutralSessionInfo,
  NeutralUserMessage,
  QueuedMessage,
  SendPayload,
  SessionMessage,
  SpawnPayload,
  UserAnswers,
  UserQuestion,
  UserQuestionAnswered,
  UserQuestionResult,
} from '@whiffle/core';
import {
  ASK_USER_QUESTION,
  CONTROL_CONTEXT_USAGE,
  CONTROL_MCP_STATUS,
  CONTROL_SET_EFFORT,
  CONTROL_SUPPORTED_COMMANDS,
  CONTROL_SUPPORTED_MODELS,
  INSPECT_CONFIG,
  MARKETPLACE_CATALOG,
  MESSAGE_DEQUEUED,
  MESSAGE_QUEUED,
  READ_MEMORY_FILE,
  READ_SKILL_FILES,
  isInjected,
  settledQuestionResult,
} from '@whiffle/core';
import {
  fleetStatus,
  inspectConfig,
  marketplaceCatalog,
  readMemoryFile,
  readSkillFiles,
  syncFleetConfig,
} from '../fleet';
import { DENIED_NATIVE_SUBAGENT_TOOLS, DENIED_WEB_TOOLS } from '../denied-tools';
import { MCP_SERVER_NAME, handoffServer } from '../handoff';
import { fetchDelegateTypes } from './handoff-shared';
import { probeAuth, unlockKeychain } from '../auth';
import { beginLogin, clearCredentials, completeLogin, exportCredentials, importCredentials } from '../login';
import { resolveBin } from '../tools';
import { claudeConfigDirs } from '../usage/scan-claude';
import type { Harness, HarnessContext, HarnessSession } from '../harness';
import {
  ensureSessiond,
  sessiondBridge,
  SessiondClient,
  type SessiondWelcomeInfo,
} from '../sessiond-client';
import { sessiondEndpoint } from '@whiffle/core/sessiond';
// Type-only, and deliberately so: `session.ts` imports the harness registry
// this file is part of, so a value import here would close a module cycle.
import type { SessiondAwareContext } from '../session';

/** The neutral frame is the SDK frame re-tagged: same fields, plus the original. */
export const toNeutral = (sdk: SDKMessage): NeutralMessage => {
  if (sdk.type === 'result') {
    // The SDK's own usage carries cache_creation/cache_read counts; re-tag them
    // under the harness-neutral `cache` shape the opencode adapter's result
    // frame also populates.
    const usage = (
      sdk as { usage?: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number } }
    ).usage;
    return {
      ...sdk,
      raw: sdk,
      ...(usage
        ? { cache: { read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 } }
        : {}),
    } as unknown as NeutralMessage;
  }
  if (
    sdk.type === 'assistant' ||
    sdk.type === 'user' ||
    sdk.type === 'stream_event' ||
    sdk.type === 'system'
  ) {
    return { ...sdk, raw: sdk } as unknown as NeutralMessage;
  }
  // `auth_status` is MCP server auth plumbing — surface it as a quiet system
  // message so the QUIET set silences it instead of the dashboard showing a
  // bare "⚙ raw" banner. The MCP status panel already shows auth failures.
  if (sdk.type === 'auth_status') {
    return {
      type: 'system',
      subtype: 'auth_status',
      uuid: sdk.uuid,
      session_id: sdk.session_id,
      raw: sdk,
    } as unknown as NeutralMessage;
  }
  return { type: 'raw', harness: 'claude', uuid: sdk.uuid, message: sdk };
};

/**
 * The Claude SDK's `AskUserQuestionOutput` (`tool_use_result` on a user
 * message), normalised into the neutral {@link UserQuestionResult}. The SDK
 * types `answers` values as `string` ("multi-select answers are
 * comma-separated"), but a real transcript carries `string[]` for a multi-select
 * answer, and freeform "Other" text also lands inside `answers` — so the values
 * are passed through as `string | string[]` rather than coerced. `null` when the
 * payload is not a question result, which the caller treats as absent, never as
 * an empty answer.
 */
function normalizeQuestionResult(raw: unknown): UserQuestionResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { questions, answers, response, annotations } = raw as {
    questions?: unknown;
    answers?: unknown;
    response?: unknown;
    annotations?: unknown;
  };
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return null;
  const normalized = normalizeQuestions(questions);
  if (!normalized) return null;
  return {
    outcome: 'answered',
    questions: normalized,
    answers: answers as UserAnswers,
    ...(typeof response === 'string' ? { response } : {}),
    ...(annotations && typeof annotations === 'object' && !Array.isArray(annotations)
      ? { annotations: annotations as UserQuestionAnswered['annotations'] }
      : {}),
  };
}

/**
 * The `questions` array of an `AskUserQuestion`, normalised. Shared by the
 * answered payload and by the tool's own input, which is all a dismissal has
 * left to say what was asked. `null` when the array is not questions at all.
 */
function normalizeQuestions(raw: unknown): UserQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  const normalized: UserQuestion[] = [];
  for (const question of raw) {
    if (typeof question !== 'object' || question === null) return null;
    const q = question as { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown };
    if (typeof q.question !== 'string' || !Array.isArray(q.options)) return null;
    const options: UserQuestion['options'] = [];
    for (const option of q.options) {
      if (typeof option !== 'object' || option === null) continue;
      const o = option as { label?: unknown; description?: unknown };
      if (typeof o.label !== 'string') continue;
      options.push({ label: o.label, description: typeof o.description === 'string' ? o.description : '' });
    }
    normalized.push({
      question: q.question,
      header: typeof q.header === 'string' ? q.header : 'Question',
      options,
      multiSelect: q.multiSelect === true,
    });
  }
  return normalized;
}

/**
 * Folds a question result onto the `tool_result` block of a stored entry's
 * inner message. `getSessionMessages` returns `message` as the raw MessageParam,
 * so this is where the dashboard's folding layer finds `questionResult` — the
 * same place the live path writes it.
 */
function attachQuestionResult(message: unknown, result: UserQuestionResult): unknown {
  if (typeof message !== 'object' || message === null) return message;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return message;
  return {
    ...(message as object),
    content: content.map((block) =>
      block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result'
        ? { ...(block as object), questionResult: result }
        : block
    ),
  };
}

/**
 * The CLI writes each `tool_result`'s structured output as a top-level
 * `toolUseResult` sidecar on the transcript line, but the SDK's
 * `getSessionMessages` maps a stored entry to `{type, uuid, session_id, message,
 * parent_tool_use_id, parent_agent_id}` and drops it — so an `AskUserQuestion`'s
 * answers are gone from a transcript read back after the fact. This reads the
 * session file the SDK would have read and lifts the sidecars back, keyed by
 * uuid, so the answer survives a reload the way it survives the live stream.
 */
async function readQuestionSidecars(sessionId: string, dir?: string): Promise<Map<string, UserQuestionResult>> {
  const file = await claudeSessionFile(sessionId, dir);
  if (!file) return new Map();
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return new Map();
  }
  const sidecars = new Map<string, UserQuestionResult>();
  for (const line of text.split('\n')) {
    if (!line.includes('"toolUseResult"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const { uuid, toolUseResult } = entry as { uuid?: unknown; toolUseResult?: unknown };
    if (typeof uuid !== 'string') continue;
    const result = normalizeQuestionResult(toolUseResult);
    if (result) sidecars.set(uuid, result);
  }
  return sidecars;
}

/** The session file the CLI stores a session under, or null when it is not found. */
async function claudeSessionFile(sessionId: string, dir?: string): Promise<string | null> {
  const projects = claudeConfigDirs().map((config) => join(config, 'projects'));
  const fileName = `${sessionId}.jsonl`;
  // The CLI names the project dir from the session's cwd: realpath, then every
  // non-alphanumeric byte becomes '-'. Try that first — it is the exact file
  // `getSessionMessages` reads — and only scan when the cwd is gone or the slug
  // no longer resolves (a cwd that has since moved).
  let slug: string | null = null;
  if (dir) {
    try {
      slug = (await realpath(dir)).replace(/[^a-zA-Z0-9]/g, '-');
    } catch {
      slug = null;
    }
  }
  if (slug) {
    for (const projectsDir of projects) {
      const candidate = join(projectsDir, slug, fileName);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // not under this config dir
      }
    }
  }
  for (const projectsDir of projects) {
    let entries;
    try {
      entries = await readdir(projectsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(projectsDir, entry.name, fileName);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // not in this project
      }
    }
  }
  return null;
}

export const CLAUDE_CAPABILITIES: HarnessCapabilities = {
  interrupt: true,
  permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
  setModel: true,
  effort: true,
  contextUsage: true,
  supportedModels: true,
  supportedCommands: true,
  mcpStatus: true,
  mcpControl: true,
  listSessions: true,
  getSessionMessages: true,
  renameSession: true,
  deleteSession: true,
  fork: true,
  rewind: true,
  tagSession: true,
  skills: true,
  subagents: true,
  tasks: true,
  compaction: true,
  costUsd: true,
  thinking: true,
  images: true,
  handoff: true,
  hooks: true,
  plugins: true,
  fleet: true,
};

/** The blocks a user turn is made of, taken from the SDK rather than re-modelled. */
type ContentBlock = Extract<SDKUserMessage['message']['content'], unknown[]>[number];
type Base64Source = Extract<Extract<ContentBlock, { type: 'image' }>['source'], { type: 'base64' }>;

/**
 * A turn's images and pasted text folded into the message the SDK iterates.
 * Images lead, so the model has seen them by the time it reads what was said
 * about them, and each paste is tagged.
 */
function withExtras(
  message: SDKUserMessage,
  attachments: SendPayload['attachments'],
  images: SendPayload['images']
): SDKUserMessage {
  if (!attachments?.length && !images?.length) return message;

  const typed = typeof message.message.content === 'string' ? message.message.content : '';
  const pasted = (attachments ?? [])
    .map(({ name, content }) => `\n\n<pasted-text name="${name}">\n${content}\n</pasted-text>`)
    .join('');

  const content: ContentBlock[] = [
    ...(images ?? []).map(({ mediaType, data }) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: mediaType as Base64Source['media_type'], data },
    })),
    { type: 'text' as const, text: typed + pasted },
  ];

  return { ...message, message: { ...message.message, content } };
}

/**
 * The prompt `query()` iterates, kept unresolved between turns.
 *
 * Whether a push WAITS here is the whole of what "queued" means for this
 * harness: the iterator is parked on `next()` exactly when the model is ready
 * for its next turn, so a push that finds it parked flows straight through and
 * one that does not is a message the session is too busy to start. That is a
 * fact only this class knows, so it is the one that reports it — {@link push}
 * answers with it, and {@link onConsume} fires at the moment the wait ends.
 */
export class InputStream implements AsyncIterable<SDKUserMessage> {
  #queue: { message: SDKUserMessage; queueId?: string }[] = [];
  #waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  #ended = false;

  /** Called with the id of a tagged message at the moment the model pulls it. */
  constructor(private readonly onConsume: (queueId: string) => void = () => {}) {}

  /**
   * Hands one turn to the model, or holds it until the running one is done.
   * Returns whether it had to wait — `false` means the model took it now.
   */
  push(message: SDKUserMessage, queueId?: string): boolean {
    const waiting = this.#waiting;
    if (waiting) {
      this.#waiting = null;
      waiting({ done: false, value: message });
      return false;
    }
    this.#queue.push({ message, ...(queueId ? { queueId } : {}) });
    return true;
  }

  end(): void {
    this.#ended = true;
    this.#waiting?.({ done: true, value: undefined });
    this.#waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const queued = this.#queue.shift();
        if (queued) {
          if (queued.queueId) this.onConsume(queued.queueId);
          return Promise.resolve({ done: false, value: queued.message });
        }
        if (this.#ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.#waiting = resolve;
        });
      },
    };
  }
}

/**
 * What a turn was typed as, before the adapter folded pastes and images into
 * it. This is what a queued row renders, and it is deliberately the text the
 * dashboard's own local copy holds — matching them is how the queue's truth
 * replaces the client's guess without doubling the message on screen.
 */
export const queuedText = (message: NeutralUserMessage): string => {
  const content = message.message.content;
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
};

/** The `message_queued` announcement for one held turn. */
export const queuedFrame = (
  queued: QueuedMessage,
  sessionId: string | null
): NeutralMessage => ({
  type: 'system',
  subtype: MESSAGE_QUEUED,
  ...(sessionId ? { session_id: sessionId } : {}),
  queueId: queued.queueId,
  text: queued.text,
  timestamp: queued.timestamp,
  ...(queued.images ? { images: queued.images } : {}),
});

/** And the one that retires it, at the moment the model pulled it. */
export const dequeuedFrame = (queueId: string, sessionId: string | null): NeutralMessage => ({
  type: 'system',
  subtype: MESSAGE_DEQUEUED,
  ...(sessionId ? { session_id: sessionId } : {}),
  queueId,
});

/** Whether a turn is in flight, and a way to wait for the one that is. */
class Turn {
  busy = false;
  #ended = Promise.withResolvers<void>();

  start(): void {
    this.busy = true;
  }

  end(): void {
    this.busy = false;
    this.#ended.resolve();
    this.#ended = Promise.withResolvers<void>();
  }

  async settle(ms: number): Promise<void> {
    if (!this.busy) return;
    await Promise.race([this.#ended.promise, Bun.sleep(ms)]);
  }
}

const SETTLE_TIMEOUT_MS = 5_000;

/**
 * How long a custody `stop` waits for the child to die after its stdin is
 * ended, before and again after a SIGKILL. Our choice: an idle claude exits on
 * stdin EOF within tens of milliseconds; a couple of seconds separates slow
 * from stuck, and stuck gets SIGKILL.
 */
const CUSTODY_EXIT_MS = 2_000;

/** Whether `promise` settled within `ms`. The timer is cleared either way. */
const within = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), expiry]);
  } finally {
    clearTimeout(timer);
  }
};

/** How many consumed turns wait to be matched to their frame before the oldest is dropped. */
const AWAITING_ECHO_LIMIT = 32;

/** The `canUseTool` callback, parked until `resolvePermission` answers it. */
type PermissionResolver = (result: PermissionResult) => void;

class ClaudeSession implements HarnessSession {
  readonly harness = 'claude' as const;
  sessionId: string | null = null;
  readonly #handle: Query;
  readonly #input: InputStream;
  readonly #turn: Turn;
  readonly #pump: Promise<void>;
  readonly #ctx: HarnessContext;
  readonly #permissions = new Map<string, PermissionResolver>();
  /**
   * MCP tool handlers return `structuredContent` on `CallToolResult`, but the
   * SDK strips it from the `tool_result` content blocks it forwards. The
   * handlers store their structured data here keyed by the result text, and
   * {@link #pumpMessages} injects it back onto the matching `tool_result` block
   * before the frame leaves the daemon.
   */
  readonly #pendingStructured = new Map<string, Record<string, unknown>>();
  /**
   * The open `AskUserQuestion` permissions, keyed by request id, holding the
   * tool call they park and the questions they ask. A dismissal is a denial,
   * and the CLI answers a denied tool call with prose and no `toolUseResult`
   * sidecar — indistinguishable, from the block alone, from an answer that went
   * missing. Remembering the ask is what lets {@link #pumpMessages} say which
   * of the two it is.
   *
   * The tool call's own `input` is kept beside them for the opposite case: an
   * answer that arrives from off this machine carries the reader's choices and
   * nothing else, and the SDK validates the whole `AskUserQuestion` schema on
   * the way back in. This is the only copy of the input there is to answer with.
   */
  readonly #openQuestions = new Map<
    string,
    { toolUseID: string; questions: UserQuestion[]; input: Record<string, unknown> }
  >();
  /** Denied questions, keyed by tool call, until their `tool_result` goes past. */
  readonly #dismissedQuestions = new Map<string, UserQuestionResult>();
  /**
   * Messages waiting for a turn to end, oldest first — the queue as observable
   * state ({@link QueuedMessage}). This is the daemon's own copy of what
   * {@link InputStream} is holding, kept so the queue can be announced,
   * snapshotted and retired by id rather than inferred by a client.
   */
  readonly #queued: QueuedMessage[] = [];
  /**
   * Turns the model has pulled but whose own frame has not gone past yet,
   * oldest first. The SDK echoes a consumed turn back as an ordinary `user`
   * message with a uuid of its own making — there is no id on it that says
   * which send it was — so the text is what matches it to its queue entry, and
   * {@link #pumpMessages} tags the frame before it leaves the daemon.
   */
  readonly #awaitingEcho: { queueId: string; text: string }[] = [];

  constructor(
    readonly instanceId: string,
    ctx: HarnessContext,
    workdir: string,
    options: unknown,
    permissionMode: string | undefined,
    model: string | undefined,
    effort: EffortLevel | undefined,
    resume: SpawnPayload['resume'],
    persistSession: boolean | undefined,
    skills?: string[],
    denyTools?: string[],
    /** Fetched once by `spawn()` before this session existed; frozen from here on. */
    delegateTypes?: import('@whiffle/core').DelegateType[],
    /** `false` on a leaf delegate: no spawning tools at all. Absent = allowed. */
    canDelegate?: boolean,
    /**
     * The sessiond connection this session's CLI child lives under. Not
     * optional in practice — `spawn()` always supplies it, and there is no
     * in-process fallback (PLAN.md C7: full cutover, rollback is a revert).
     */
    sessiond?: { client: SessiondClient; procId: string }
  ) {
    this.#ctx = ctx;
    // The model just pulled a held turn: retire the queue entry, and remember
    // the text so the frame that echoes it can be tagged with the same id.
    const input = new InputStream((queueId) => this.#dequeue(queueId));
    this.#input = input;
    const turn = new Turn();
    this.#turn = turn;

    // Claude in Chrome is on by default for every whiffle session.
    //
    // The CLI resolves it in `shouldEnableClaudeInChrome`, in this order:
    // OAuth scope -> `--chrome`/`--no-chrome` -> `CLAUDE_CODE_ENABLE_CFC` ->
    // `if (!isInteractive()) return false` -> `~/.claude.json`'s
    // `claudeInChromeDefaultEnabled`. Every whiffle session is non-interactive
    // stream-json, so it always trips the interactive gate and never reads the
    // config key — setting `claudeInChromeDefaultEnabled: true` cannot work
    // here at any value. `--chrome` short-circuits above that gate.
    //
    // A spec that names `chrome` or `no-chrome` itself still wins.
    const callerArgs =
      (options as { extraArgs?: Record<string, string | null> } | undefined)?.extraArgs ?? {};
    const extraArgs: Record<string, string | null> = {
      ...('no-chrome' in callerArgs ? {} : { chrome: null }),
      ...callerArgs,
    };

    const handle = query({
      prompt: input,
      options: {
        forwardSubagentText: true,
        agentProgressSummaries: true,
        ...(options as Record<string, unknown> | undefined),
        extraArgs,
        mcpServers: {
          ...((options as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers ?? {}),
          [MCP_SERVER_NAME]: handoffServer(
            { instanceId, cwd: workdir, emit: (envelope) => ctx.emit(envelope), delegateTypes, canDelegate },
            // Keyed under BOTH the handler's text and the serialized payload:
            // CLIs before ~2.1.x forward the handler's text block, current ones
            // (verified on 2.1.233) replace it with JSON.stringify(structuredContent).
            (text, data) => {
              this.#pendingStructured.set(text, data);
              this.#pendingStructured.set(JSON.stringify(data), data);
            }
          ),
        },
        // Fleet policy: search is the Exa MCP and fetch is the firecrawl MCP,
        // both fleet-synced onto every machine. The spec's own denials stand.
        // `DENIED_NATIVE_SUBAGENT_TOOLS` keeps delegation on one visible door
        // (see denied-tools.ts); `denyTools` is a resolved delegate type's own
        // ask, threaded through from the spawn.
        disallowedTools: [
          ...new Set([
            ...((options as { disallowedTools?: string[] } | undefined)?.disallowedTools ?? []),
            ...DENIED_WEB_TOOLS,
            ...DENIED_NATIVE_SUBAGENT_TOOLS,
            ...(denyTools ?? []),
          ]),
        ],
        ...(resume
          ? {
              resume: resume.sessionKey,
              ...(resume.fork ? { forkSession: true } : {}),
              ...(resume.atMessage ? { resumeSessionAt: resume.atMessage } : {}),
            }
          : {}),
        ...(persistSession === false ? { persistSession: false } : {}),
        ...(permissionMode ? { permissionMode: permissionMode as import('@anthropic-ai/claude-agent-sdk').PermissionMode } : {}),
        ...(model && { model }),
        // Left out entirely when nobody chose: the SDK's own default is the
        // model's, and writing a level here would put whiffle's guess in its
        // place on every model whose scale we cannot see.
        ...(effort && { effort }),
        ...(permissionMode === 'bypassPermissions' && {
          allowDangerouslySkipPermissions: true,
          // Bypass mode must also let the model run commands outside the sandbox
          // via `dangerouslyDisableSandbox` — otherwise the SDK auto-denies such
          // Bash calls (`sandboxOverride`) without ever reaching `canUseTool`.
          sandbox: {
            ...((options as { sandbox?: Record<string, unknown> } | undefined)?.sandbox ?? {}),
            allowUnsandboxedCommands: true,
          },
        }),
        cwd: workdir,
        includePartialMessages: true,
        // THE SEAM (design §4.1). The SDK builds the CLI's command line and
        // hands it here instead of spawning it; we forward it to sessiond and
        // hand back a `SpawnedProcess` over the socket. Nothing downstream —
        // `canUseTool` parking, `InputStream`, the queue frames, the whiffle
        // MCP server on the control channel — can tell the difference, which
        // is exactly the contract this option exists to provide. What changes
        // is custody: the child is sessiond's, and it outlives this agent.
        //
        // Placed AFTER the caller's `options` spread on purpose: a spawn
        // payload may not opt out of it. There is no flag and no in-process
        // fallback (PLAN.md C7).
        ...(sessiond
          ? {
              spawnClaudeCodeProcess: (spawnOptions: import('@anthropic-ai/claude-agent-sdk').SpawnOptions) =>
                sessiondBridge(sessiond.client, sessiond.procId, spawnOptions),
            }
          : {}),
        canUseTool: (toolName, toolInput, { requestId, suggestions, toolUseID }) =>
          new Promise<PermissionResult>((resolve) => {
            this.#permissions.set(requestId, resolve);
            if (toolName === ASK_USER_QUESTION) {
              const questions = normalizeQuestions((toolInput as { questions?: unknown }).questions);
              if (questions)
                this.#openQuestions.set(requestId, {
                  toolUseID,
                  questions,
                  input: toolInput as Record<string, unknown>,
                });
            }
            ctx.permission({ requestId, toolName, input: toolInput, suggestions });
          }),
      },
    });

    this.#handle = handle;

    // Load skills natively: push /skill messages into the input stream before
    // any user prompt. The SDK handles them as slash commands — same as the
    // user typing /skill-name in the session.
    if (skills?.length) {
      for (const skill of skills) {
        input.push({
          type: 'user',
          message: { role: 'user', content: `/${skill}` },
          parent_tool_use_id: null,
        } as SDKUserMessage);
      }
    }

    this.#pump = this.#pumpMessages(ctx, handle, turn);
  }

  /**
   * The model pulled a held turn. Announced immediately rather than waiting for
   * the turn's own frame: the two can be seconds apart, and a row that is no
   * longer waiting should stop saying it is.
   */
  #dequeue(queueId: string): void {
    const at = this.#queued.findIndex((entry) => entry.queueId === queueId);
    if (at === -1) return;
    const [entry] = this.#queued.splice(at, 1);
    this.#awaitingEcho.push({ queueId, text: entry.text });
    // A turn nothing ever echoed would otherwise sit here for the session's
    // life. The tag is a nicety — `message_dequeued` already retired the row —
    // so the oldest unmatched entries are simply dropped.
    if (this.#awaitingEcho.length > AWAITING_ECHO_LIMIT) {
      this.#awaitingEcho.splice(0, this.#awaitingEcho.length - AWAITING_ECHO_LIMIT);
    }
    this.#ctx.frame(dequeuedFrame(queueId, this.sessionId));
  }

  /**
   * Tags a consumed turn's own frame with the queue entry it came from, so a
   * client retires the queued row even if the `message_dequeued` frame raced it
   * or never arrived. Matched on text, oldest first — the queue is a queue —
   * and only for the main loop's own plain turns: a subagent's frames and the
   * tool_result traffic are nobody's send.
   */
  #tagEcho(neutral: NeutralMessage): void {
    if (neutral.type !== 'user' || this.#awaitingEcho.length === 0) return;
    if (neutral.parent_tool_use_id) return;
    const text = queuedText(neutral);
    if (!text) return;
    // `startsWith`, not equality: a turn that carried pasted text has it folded
    // in after the sentence (`withExtras`). An entry with no text of its own —
    // an images-only send — is never matched by prefix, which every string
    // would satisfy; its `message_dequeued` is what retires it.
    const at = this.#awaitingEcho.findIndex(
      (entry) => entry.text !== '' && text.startsWith(entry.text)
    );
    if (at === -1) return;
    const [entry] = this.#awaitingEcho.splice(at, 1);
    neutral.queueId = entry.queueId;
  }

  async #pumpMessages(ctx: HarnessContext, handle: Query, turn: Turn): Promise<void> {
    try {
      for await (const message of handle) {
        const neutral = toNeutral(message);
        // The turn this frame is, when it is one the session had to hold.
        this.#tagEcho(neutral);
        // The Claude SDK emits `AskUserQuestion`'s structured output as a
        // top-level `tool_use_result` on the user message (the prose alone is
        // what lands in the `tool_result` block's `content`). Normalise it onto
        // the block so the dashboard reads one neutral shape and never parses
        // prose.
        if (neutral.type === 'user') {
          const result = normalizeQuestionResult((message as SDKUserMessage).tool_use_result);
          if (result && Array.isArray(neutral.message.content)) {
            for (const block of neutral.message.content) {
              if (block.type === 'tool_result') block.questionResult = result;
            }
          }
        }
        // A dismissed question has no sidecar to normalise — the denial was
        // recorded when it was made, and this is the block it belongs to.
        if (neutral.type === 'user' && this.#dismissedQuestions.size > 0) {
          const content = neutral.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type !== 'tool_result') continue;
              const dismissed = this.#dismissedQuestions.get(block.tool_use_id);
              if (!dismissed) continue;
              this.#dismissedQuestions.delete(block.tool_use_id);
              block.questionResult = dismissed;
            }
          }
        }
        // The Claude SDK strips `structuredContent` from MCP CallToolResults
        // before forwarding tool_result blocks. The tool handlers stored their
        // structured data in #pendingStructured keyed by result text; inject it
        // back onto the matching block so downstream consumers see it.
        if (neutral.type === 'user' && this.#pendingStructured.size > 0) {
          const content = neutral.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type !== 'tool_result') continue;
              const text =
                typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? (block.content as { text?: string }[])
                        .map((b) => b.text ?? '')
                        .filter(Boolean)
                        .join('\n')
                    : '';
              const sc = this.#pendingStructured.get(text);
              if (sc) {
                (block as Record<string, unknown>).structuredContent = sc;
                // Both keys (handler text + serialized payload) point at this
                // value; sweep them so neither lingers.
                for (const [key, value] of this.#pendingStructured) {
                  if (value === sc) this.#pendingStructured.delete(key);
                }
              }
            }
          }
        }
        if (message.type === 'system' && message.subtype === 'init') {
          this.sessionId = message.session_id;
          ctx.session(message.session_id);
        }
        // TODO(servedModel wiring): a spawn's own `model` can be an alias
        // ('sonnet') the SDK resolves to a dated id; `neutral.message.model`
        // on this first assistant frame is what really served the turn, and
        // the hub — which already reads the first user message here for
        // `deriveTitleFromFirstMessage` — should read this the same way into
        // an `instances.served_model` column. Left undone: `db/schema.ts`,
        // `db/index.ts` and `server.ts` are mid-edit in another session's
        // working tree and a migration on top of that is unsafe right now.
        if (message.type === 'result') {
          turn.end();
          ctx.busy(false);
        }
        ctx.frame(neutral);
      }
    } catch (error) {
      ctx.busy(false);
      ctx.failed(error);
    } finally {
      ctx.closed?.();
    }
  }

  send(message: NeutralUserMessage, extras: Pick<SendPayload, 'attachments' | 'images' | 'urgent'>): void {
    const sdk = message as unknown as SDKUserMessage;
    const queued = (message as { shouldQuery?: boolean }).shouldQuery === false;

    // A mid-turn injection: the model reads it at the next tool boundary without
    // losing work. If the stream is gone, fall back to queueing it.
    if (extras.urgent && this.#turn.busy) {
      const outgoing = withExtras(sdk, extras.attachments, extras.images);
      const stream = (async function* (): AsyncGenerator<SDKUserMessage> {
        yield outgoing;
      })();
      void this.#handle.streamInput(stream).catch(() => {
        this.#input.push(outgoing);
      });
      if (isInjected(message.origin)) {
        this.#ctx.frame(toNeutral(message as unknown as SDKMessage));
      }
      return;
    }

    // A queued hand-off picked up while the session is idle is the turn that
    // wakes it; otherwise it stays out of the way of the turn in flight.
    const wake = queued && !this.#turn.busy;
    if (!queued || wake) this.#ctx.busy(true);
    const outgoing = wake ? ({ ...sdk, shouldQuery: undefined } as typeof sdk) : sdk;

    // Announced only if it actually waits, and only for what the reader typed.
    //
    // Two conditions, because either alone lies. A turn already in flight is
    // what makes a send wait — but the input stream is the only thing that
    // knows whether the model was in fact ready for it, and between `query()`
    // being constructed and its first pull nothing is waiting on the stream
    // while the session is plainly idle. So: the turn says it is busy AND the
    // push had to hold it. Anything whiffle INJECTS (a hand-off brief, a rule's
    // message) is already echoed as a real user frame at the bottom of this
    // method — announcing it here would draw the same message twice, once
    // waiting and once said.
    const holding = this.#turn.busy && !isInjected(message.origin);
    this.#turn.start();
    const queueId = holding ? crypto.randomUUID() : undefined;
    const waiting = this.#input.push(
      withExtras(outgoing, extras.attachments, extras.images),
      queueId
    );
    if (waiting && queueId) {
      const entry: QueuedMessage = {
        queueId,
        text: queuedText(message),
        timestamp: new Date().toISOString(),
        ...(extras.images?.length ? { images: extras.images.length } : {}),
      };
      this.#queued.push(entry);
      this.#ctx.frame(queuedFrame(entry, this.sessionId));
    }

    // A hand-off is queued rather than asked (`shouldQuery: false`), so the SDK
    // appends it and emits nothing until the session next takes a turn. Echoed
    // as the frame the SDK will not send, so it appears the moment it lands.
    // The same is true of anything else whiffle injects — a rule's message has
    // no local copy in any dashboard, so without this echo it stays invisible
    // until the transcript is read back from disk.
    if (isInjected(message.origin)) {
      this.#ctx.frame(toNeutral(message as unknown as SDKMessage));
    }
  }

  async control(method: string, args: unknown[]): Promise<unknown> {
    // Effort is the one neutral verb with no `Query` method behind it: it is a
    // flag setting, applied over user/project/local settings and never written
    // to any of them, which is exactly a session-scoped switch. `max` is only
    // reachable this way — the persisted setting excludes it.
    if (method === CONTROL_SET_EFFORT) {
      return await this.#handle.applyFlagSettings({ effortLevel: args[0] as EffortLevel });
    }
    const handle = this.#handle as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (typeof handle[method] !== 'function') throw new Error(`unknown control method: ${method}`);
    return await handle[method](...args);
  }

  resolvePermission(requestId: string, result: PermissionResult): void {
    const resolve = this.#permissions.get(requestId);
    if (!resolve) throw new Error(`no permission request ${requestId}`);
    this.#permissions.delete(requestId);
    const question = this.#openQuestions.get(requestId);
    if (!question) return resolve(result);

    this.#openQuestions.delete(requestId);
    // Answering runs the tool, and the CLI writes the answers itself; walking
    // away leaves nothing behind, so the dismissal is recorded here for the
    // `tool_result` that is about to carry the CLI's denial prose.
    if (result.behavior === 'deny') {
      this.#dismissedQuestions.set(question.toolUseID, {
        outcome: 'dismissed',
        questions: question.questions,
      });
    }
    // A question can be answered by someone who never held the tool call: a
    // parent session's `answer_delegate` sends the chosen labels alone, and the
    // SDK rejects that input for the `questions` it no longer has. The parked
    // call is put back underneath, which is what the dashboard sends when it
    // answers one of these itself.
    resolve(settledQuestionResult(question, result));
  }

  async interrupt(): Promise<void> {
    await this.#handle.interrupt().catch(() => {});
  }

  async stop(): Promise<void> {
    this.#input.end();
    // Nothing left to hold these for: the stream is closed, so no queue entry
    // here will ever be pulled, and the hub drops the session's queue with the
    // row. Retired quietly rather than announced — the reader is watching a
    // session end, not a message being read.
    this.#queued.length = 0;
    this.#awaitingEcho.length = 0;
    for (const resolve of this.#permissions.values()) resolve({ behavior: 'deny', message: 'session stopped' });
    this.#permissions.clear();
    // Not dismissals: the session is going away, and no `tool_result` will
    // arrive for these to be folded onto.
    this.#openQuestions.clear();
    await this.#handle.interrupt().catch(() => {});
    await this.#turn.settle(SETTLE_TIMEOUT_MS);
    this.#handle.close();
    await this.#pump.catch(() => {});
  }

  async dispose(): Promise<void> {
    this.#input.end();
    this.#handle.close();
  }
}

/** How long the `claude update` control gets. */
const TAIL_LINES = 4;
const tail = (output: string): string => output.trim().split('\n').slice(-TAIL_LINES).join('\n');

/** Updates the Claude Code the machine's sessions run on. */
const updateClaudeCode = async (): Promise<string> => {
  const updated = await Bun.$`claude update`.quiet().nothrow();
  const said = tail(updated.stdout.toString()) || tail(updated.stderr.toString());
  if (updated.exitCode !== 0) throw new Error(said || `claude update exited ${updated.exitCode}`);
  return said;
};

const toInfo = (info: import('@anthropic-ai/claude-agent-sdk').SDKSessionInfo): NeutralSessionInfo => ({
  sessionId: info.sessionId,
  harness: 'claude',
  ...(info.summary !== undefined ? { summary: info.summary } : {}),
  lastModified: info.lastModified,
  ...(info.fileSize !== undefined ? { fileSize: info.fileSize } : {}),
  ...(info.customTitle !== undefined ? { customTitle: info.customTitle } : {}),
  ...(info.firstPrompt !== undefined ? { firstPrompt: info.firstPrompt } : {}),
  ...(info.gitBranch !== undefined ? { gitBranch: info.gitBranch } : {}),
  ...(info.cwd !== undefined ? { cwd: info.cwd } : {}),
  ...(info.tag !== undefined ? { tag: info.tag } : {}),
  ...(info.createdAt !== undefined ? { createdAt: info.createdAt } : {}),
});

const toEntry = (
  entry: import('@anthropic-ai/claude-agent-sdk').SessionMessage
): SessionMessage => {
  // Every stored line carries the ISO time the turn was written, and the SDK
  // passes it through — but its `SessionMessage` type does not declare it, so
  // reading it needs the widening. Without this the dashboard has no honest
  // time for a replayed session and shows none. Read defensively rather than
  // asserted: a field absent from the type may go absent from the payload.
  const written = (entry as { timestamp?: unknown }).timestamp;
  return {
    type: entry.type,
    uuid: entry.uuid,
    session_id: entry.session_id,
    // The SDK stores the *inner* message (its content blocks / text), which is
    // exactly what the dashboard's folding layer reads off `message.content`.
    message: entry.message,
    parent_tool_use_id: entry.parent_tool_use_id,
    parent_agent_id: entry.parent_agent_id,
    ...(typeof written === 'string' ? { timestamp: written } : {}),
  };
};


/**
 * A line off a child's stdout, as the CLI writes it. Only two shapes matter
 * during custody — an SDK message (which becomes a neutral frame) and a
 * `control_request` (which is either a permission to re-park or a control the
 * absent agent cannot serve). Everything else passes as `raw`.
 */
type CustodyLine =
  | (SDKMessage & { type: string })
  | { type: 'control_request'; request_id: string; request: { subtype: string } & Record<string, unknown> }
  | { type: string; [key: string]: unknown };

/** The raw `control_response` the CLI reads off its stdin, both polarities. */
export const controlSuccess = (requestId: string, response: unknown): string =>
  `${JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response },
  })}\n`;

export const controlError = (requestId: string, error: string): string =>
  `${JSON.stringify({
    type: 'control_response',
    response: { subtype: 'error', request_id: requestId, error },
  })}\n`;

/** The in-band notice a custody refusal writes into the transcript. */
export const CUSTODY_DEGRADED = 'custody_degraded';

/** The three fields of a ring line that adoption reads; `undefined` when it is not JSON. */
const parseLine = (data: string): { type?: unknown; subtype?: unknown; session_id?: unknown } | undefined => {
  try {
    return JSON.parse(data) as { type?: unknown; subtype?: unknown; session_id?: unknown };
  } catch {
    return undefined;
  }
};

/**
 * A child whose last written line is this one is waiting for input: the CLI
 * writes nothing after a `result` until the next user message, and a child
 * that has been asked nothing yet writes its `init` and stops there.
 */
const isWaiting = (line: { type?: unknown; subtype?: unknown }): boolean =>
  line.type === 'result' || (line.type === 'system' && line.subtype === 'init');

/**
 * Controls that only READ the session. A dashboard asks these on every open
 * (and a looping one asked them thousands of times in seconds), and nothing
 * in the session changes when they are refused — so the refusal goes back to
 * the caller as the rejection alone. Writing it into the transcript as well
 * told the operator nothing and buried the turn under notices. Everything
 * that would have CHANGED the session keeps its in-band notice: those are the
 * refusals the operator has to see. `accountInfo` has no core constant; it is
 * the SDK's own method name, asked by the dashboard verbatim.
 */
const READ_ONLY_CONTROLS: ReadonlySet<string> = new Set([
  CONTROL_SUPPORTED_MODELS,
  CONTROL_SUPPORTED_COMMANDS,
  CONTROL_MCP_STATUS,
  CONTROL_CONTEXT_USAGE,
  'accountInfo',
]);

/**
 * CUSTODY (design §4.1) — the session while the agent that owned it is gone.
 *
 * A restarted agent cannot reconstruct a live `Query` around a mid-stream
 * child: the SDK offers spawn substitution, not adoption of a half-initialized
 * protocol state (§4.1, and the spike recorded in this leaf's report did not
 * overturn it). So the returning agent takes CUSTODY instead — cursor
 * arithmetic and raw control answers, nothing more:
 *
 *  - ring lines are re-derived into neutral frames through {@link toNeutral},
 *    which is already a pure function over parsed JSON and needs no `Query`;
 *  - an unanswered `control_request`/`can_use_tool` is re-parked under the
 *    SDK's own `requestId`, so the hub's parked ask stays answerable — and the
 *    answer goes back as a raw `control_response` line, because that is what
 *    the `Query` would have written anyway;
 *  - any OTHER control the CLI asks of the absent agent (an `mcp_message` for
 *    the whiffle server, a hook callback) is answered with an explicit in-band
 *    error, so the tool call FAILS VISIBLY instead of hanging forever on a
 *    handler that no longer exists;
 *  - at the turn's next `result` line the child's stdin is EOF'd and the
 *    hand-off fires: the owner respawns through the full SDK with
 *    `resume: sessionId`. The in-flight turn completed and was captured; the
 *    cost is one respawn at a turn boundary. A child that was already between
 *    turns when adopted has no next `result` coming, so {@link ClaudeHarness.adopt}
 *    fires the same hand-off from the ring's last line instead.
 *
 * Custody is a degraded mode measured in seconds, not a second implementation
 * of the SDK. Everything it refuses, it refuses out loud.
 */
export class ClaudeCustody implements HarnessSession {
  readonly harness = 'claude' as const;
  sessionId: string | null = null;
  /** requestId → the parked ask, until an answer or the hand-off clears it. */
  readonly #parked = new Set<string>();
  /** Turns pushed during custody; delivered by the respawned session. */
  readonly #held: { message: NeutralUserMessage; extras: Pick<SendPayload, 'attachments' | 'images' | 'urgent'> }[] = [];
  #handedOff = false;
  /** Settled by {@link exited} when sessiond reports the child gone. */
  readonly #exit = Promise.withResolvers<void>();

  constructor(
    readonly instanceId: string,
    private readonly ctx: HarnessContext,
    private readonly write: (data: string) => void,
    /** Ends the child's stdin — the graceful half of the boundary hand-off. */
    private readonly stdinEnd: () => void,
    /** Fired at the turn boundary; the owner respawns with `resume: sessionId`. */
    private readonly onHandoff: (handoff: {
      instanceId: string;
      sessionId: string | null;
      held: { message: NeutralUserMessage; extras: Pick<SendPayload, 'attachments' | 'images' | 'urgent'> }[];
    }) => void,
    sessionId: string | null = null,
    /** Signals the child; what a `stop` falls back to when EOF alone does not end it. */
    private readonly kill: (sig: NodeJS.Signals) => void = () => {}
  ) {
    this.sessionId = sessionId;
  }

  /** The child is gone — from the ring subscription's `exit`, whatever caused it. */
  exited(): void {
    this.#exit.resolve();
  }

  /** The asks still waiting for an answer — what a reattach re-announces. */
  get parked(): string[] {
    return [...this.#parked];
  }

  get handedOff(): boolean {
    return this.#handedOff;
  }

  /**
   * One raw stdout line, from the ring's backlog or live. Replay and live use
   * the same path on purpose: the daemon's single-threaded delivery is what
   * makes backlog-then-live gapless, and a second code path would be a second
   * place for a hole to open.
   */
  ingest(line: string): void {
    let parsed: CustodyLine;
    try {
      parsed = JSON.parse(line) as CustodyLine;
    } catch {
      // A line the CLI wrote that is not JSON is not a frame; sessiond never
      // promised us one, and inventing a frame from it would be a lie.
      return;
    }

    if (parsed.type === 'control_request') {
      this.#onControlRequest(parsed as Extract<CustodyLine, { type: 'control_request' }>);
      return;
    }
    // A control_response is the CLI answering something the dead agent asked;
    // nobody is waiting for it any more.
    if (parsed.type === 'control_response' || parsed.type === 'control_cancel_request') return;

    const sdk = parsed as SDKMessage;
    if (sdk.type === 'system' && (sdk as { subtype?: string }).subtype === 'init') {
      this.sessionId = sdk.session_id;
      this.ctx.session(sdk.session_id);
    }
    this.ctx.frame(toNeutral(sdk));
    if (sdk.type === 'result') {
      this.ctx.busy(false);
      // THE BOUNDARY. The turn that was in flight when the agent died has now
      // completed and been captured; this is the one moment at which handing
      // the session back to a full `Query` costs nothing but a respawn.
      this.handOff();
    }
  }

  #onControlRequest(request: Extract<CustodyLine, { type: 'control_request' }>): void {
    const requestId = request.request_id;
    if (request.request?.subtype === 'can_use_tool') {
      // Re-parked under the SDK's own requestId — the same id the hub's parked
      // ask has carried end-to-end since this adapter first wrote it.
      this.#parked.add(requestId);
      const inner = request.request as { tool_name?: string; input?: Record<string, unknown>; permission_suggestions?: unknown };
      this.ctx.permission({
        requestId,
        toolName: inner.tool_name ?? 'unknown',
        input: inner.input ?? {},
        ...(Array.isArray(inner.permission_suggestions)
          ? { suggestions: inner.permission_suggestions as import('@whiffle/core').PermissionUpdate[] }
          : {}),
        ...(inner.tool_name === ASK_USER_QUESTION ? { requestKind: 'question' as const } : {}),
      });
      return;
    }
    // Everything else: the handler it is addressed to died with the agent.
    // Refused in-band and said out loud, so the tool call fails where the
    // reader can see it rather than hanging on a promise nobody holds.
    const subtype = request.request?.subtype ?? 'unknown';
    const reason = `whiffle: agent restarted; \`${subtype}\` cannot be served during custody`;
    this.write(controlError(requestId, reason));
    this.ctx.frame({
      type: 'system',
      subtype: CUSTODY_DEGRADED,
      ...(this.sessionId ? { session_id: this.sessionId } : {}),
      control: subtype,
      requestId,
      text: reason,
    } as unknown as NeutralMessage);
  }

  /**
   * Answer a parked permission. The `control_response` is written raw: there is
   * no `Query` to route it through, and the CLI reads exactly this shape off
   * its stdin either way (verified against the SDK's own writer, `sdk.mjs`
   * `handleControlRequest`).
   */
  resolvePermission(requestId: string, result: PermissionResult): void {
    if (!this.#parked.delete(requestId)) throw new Error(`no permission request ${requestId}`);
    this.write(controlSuccess(requestId, result));
  }

  /**
   * A turn sent during custody. Held rather than written: a raw user message on
   * the child's stdin would bypass the queue machinery, the echo tagging and
   * the busy accounting that the `Query` owns, and there is no way to know from
   * here whether the model is ready for it. The hand-off is seconds away and
   * delivers it through the real path.
   */
  send(message: NeutralUserMessage, extras: Pick<SendPayload, 'attachments' | 'images' | 'urgent'>): void {
    this.#held.push({ message, extras });
  }

  /**
   * Every non-permission control fails, for the reason above; only the ones
   * that would have changed the session fail in the transcript too (see
   * {@link READ_ONLY_CONTROLS}).
   */
  control(method: string): Promise<unknown> {
    const reason = `whiffle: agent restarted; control \`${method}\` is unavailable until this session hands back (custody)`;
    if (!READ_ONLY_CONTROLS.has(method)) {
      this.ctx.frame({
        type: 'system',
        subtype: CUSTODY_DEGRADED,
        ...(this.sessionId ? { session_id: this.sessionId } : {}),
        control: method,
        text: reason,
      } as unknown as NeutralMessage);
    }
    return Promise.reject(new Error(reason));
  }

  /**
   * An interrupt cannot wait for a turn boundary — that is the whole point of
   * one — so it is written as the raw control_request the `Query` would have
   * sent, and the hand-off follows on the `result` the interrupt produces.
   */
  async interrupt(): Promise<void> {
    const requestId = crypto.randomUUID();
    this.write(`${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })}\n`);
  }

  /** stdin EOF + the hand-off, once. */
  handOff(): void {
    if (this.#handedOff) return;
    this.#handedOff = true;
    this.stdinEnd();
    this.onHandoff({ instanceId: this.instanceId, sessionId: this.sessionId, held: [...this.#held] });
    this.#held.length = 0;
  }

  async stop(): Promise<void> {
    // A stop during custody is the operator ending the session, not a
    // hand-off: nothing is parked afterwards and nothing is respawned.
    for (const requestId of this.#parked) this.write(controlError(requestId, 'whiffle: session stopped'));
    this.#parked.clear();
    this.#held.length = 0;
    this.#handedOff = true;
    this.stdinEnd();
    // Returned only once the child is actually dead. The supervisor's relaunch
    // awaits this before spawning under the same procId, and sessiond's spawn
    // SIGKILLs a still-alive predecessor and broadcasts its exit to whoever is
    // subscribed under that id by then — which would be the new session.
    if (await within(this.#exit.promise, CUSTODY_EXIT_MS)) return;
    this.kill('SIGKILL');
    await within(this.#exit.promise, CUSTODY_EXIT_MS);
  }

  async dispose(): Promise<void> {
    this.#parked.clear();
    this.#held.length = 0;
  }
}

export class ClaudeHarness implements Harness {
  readonly kind = 'claude' as const;
  readonly capabilities = CLAUDE_CAPABILITIES;
  auth: AuthState = 'authenticated';

  async detect(): Promise<HarnessReport> {
    const auth = await probeAuth();
    this.auth = auth;
    return {
      harness: 'claude',
      installed: resolveBin('claude') !== undefined || auth === 'authenticated',
      version: undefined,
      auth,
      capabilities: CLAUDE_CAPABILITIES,
    };
  }

  /**
   * The machine's one sessiond connection, dialled lazily and shared by every
   * claude session. Lazy rather than eager so a machine with no sessions never
   * needs a daemon, and so the install-time error lands on the spawn that
   * needed it (with an instance to report against) rather than at import time.
   */
  #sessiond: Promise<SessiondClient> | undefined;

  async sessiond(
    // `WHIFFLE_SESSIOND_ENDPOINT` is sessiond's own override
    // (`sessiond/src/main.ts`), honoured on this side too so a dev run — or a
    // test — can point both halves at a scratch socket instead of the real one.
    endpoint: string = process.env.WHIFFLE_SESSIOND_ENDPOINT ?? sessiondEndpoint()
  ): Promise<SessiondClient> {
    const existing = await this.#sessiond?.catch(() => undefined);
    if (existing && !existing.closed) return existing;
    // A dead connection is re-dialled; the CHILDREN are unaffected, which is
    // the whole property sessiond exists to provide.
    this.#sessiond = (async () => {
      await ensureSessiond(endpoint);
      return SessiondClient.connect(endpoint);
    })();
    return this.#sessiond;
  }

  async spawn(spec: SpawnPayload, ctx: HarnessContext): Promise<HarnessSession> {
    // Fetched once, before the session (and its `delegate` tool description)
    // exists — see `fetchDelegateTypes`'s own comment for why this is a plain
    // per-spawn HTTP read rather than a fleet-sync field.
    // A leaf never builds the tool that needs the list, so skip the HTTP read.
    const delegateTypes = spec.canDelegate === false ? [] : await fetchDelegateTypes();
    // The child is spawned under sessiond, unconditionally — no flag, no
    // in-process fallback (PLAN.md C7). `procId` is the instance id: stable
    // across agent restarts, which is what lets the returning agent match a
    // surviving child to the row it belongs to.
    const client = await this.sessiond();
    return new ClaudeSession(
      ctx.instanceId,
      ctx,
      ctx.cwd,
      spec.options,
      spec.permissionMode,
      spec.model,
      spec.effort,
      spec.resume,
      spec.persistSession,
      spec.skills,
      spec.denyTools,
      delegateTypes,
      spec.canDelegate,
      { client, procId: ctx.instanceId }
    );
  }

  /**
   * Take custody of a child that outlived the agent (design §4.1). The caller
   * supplies the cursor it wants resumed from — the hub's own ingest mark when
   * it has one, `undefined` to follow from now — and the hand-off it wants at
   * the turn boundary.
   *
   * THE IDLE CHILD (the boundary that never comes). Custody hands back at the
   * next `result`, and a child whose turn finished BEFORE the agent died never
   * writes another one: stream-json is silent after a `result` until the next
   * user message, and custody holds every message. Left to the rule above such
   * a session stays in custody for good — turns held, controls refused. So the
   * ring's LAST line is read before anything else (`head`, from the welcome the
   * caller already has): a `result`, or the `system`/`init` of a fresh child
   * that has been asked nothing yet, means the child is waiting on us, and the
   * hand-off fires at adoption. Anything else — or nothing to read — means a
   * turn is in flight, and the boundary is waited for as before.
   *
   * The peek is one line of the same subscribe, not a second read: the cursor
   * is opened one seq earlier than the caller asked for, and what comes back
   * at or below the caller's own cursor is looked at and NOT re-emitted — the
   * hub already has it, and `ingest` would hand it a frame it holds.
   */
  async adopt(
    instanceId: string,
    ctx: HarnessContext,
    options: {
      afterSeq?: number;
      sessionId?: string | null;
      /** The ring's last seq as the welcome reported it; absent means no peek. */
      head?: number;
      onHandoff: (handoff: {
        instanceId: string;
        sessionId: string | null;
        held: { message: NeutralUserMessage; extras: Pick<SendPayload, 'attachments' | 'images' | 'urgent'> }[];
      }) => void;
    }
  ): Promise<ClaudeCustody> {
    const client = await this.sessiond();
    const custody = new ClaudeCustody(
      instanceId,
      ctx,
      (data) => void client.write(instanceId, data).catch(() => {}),
      () => void client.stdinEnd(instanceId).catch(() => {}),
      options.onHandoff,
      options.sessionId ?? null,
      (sig) => void client.signal(instanceId, sig).catch(() => {})
    );
    // Everything at or below `boundary` the hub has already seen; everything
    // above it is the replay the caller asked for. A cursor past `head` names
    // lines the ring never assigned — sessiond's refusal covers that, and a
    // peek would only muddle whose refusal it was.
    const head = options.head ?? 0;
    const boundary = options.afterSeq ?? head;
    const peekSeq = head >= 1 && boundary <= head ? Math.min(boundary, head - 1) : undefined;
    // PROVENANCE (design §7). This frame came from exactly one sessiond line,
    // and this is the only place that knows which: the stamp goes one
    // statement before the ingest that emits it, because `ingest` emits
    // synchronously and so the stamp lands on that frame and no other.
    // Without it the hub has nothing to dedupe a replayed or re-sent line by.
    //
    // `client.epoch` is read here rather than asserted once at adopt time: it
    // is only defined after sessiond's welcome, and reading it per line keeps
    // the stamp truthful if a client ever re-welcomes under a new epoch.
    // Undefined means no stamp at all — an unstamped frame is the pre-ledger
    // behaviour the honest-loss rule already covers, which is strictly better
    // than a frame stamped with an epoch nobody minted.
    const stamp = (seq: number): void => {
      const srcEpoch = client.epoch;
      if (srcEpoch !== undefined) {
        (ctx as Partial<SessiondAwareContext>).line?.(srcEpoch, seq);
      }
    };
    client.subscribe(
      instanceId,
      {
        line: (event) => {
          // The ring's last line is the one that says whether the child is
          // waiting. It is read the same way whether it is peeked or replayed
          // for real: a replayed `result` hands off inside `ingest` anyway,
          // but a replayed `init` would not, and a fresh child the hub saw
          // nothing of is exactly that case.
          const last = event.seq === head && head >= 1 ? parseLine(event.data) : undefined;
          if (peekSeq !== undefined && event.seq <= boundary) {
            // Peek-only: looked at, never emitted. The session id is the one
            // thing taken from it — a survivor the hub never named arrives
            // without one, and the hand-off's `resume` cannot do without it.
            if (custody.sessionId === null && typeof last?.session_id === 'string') custody.sessionId = last.session_id;
          } else {
            stamp(event.seq);
            custody.ingest(event.data);
          }
          // There is no backlog-complete event; the ring's last line is it.
          if (last !== undefined && isWaiting(last)) custody.handOff();
        },
        // A child that dies during custody is the session ending on its own,
        // and the supervisor's `closed` hook retires the row. After the
        // hand-off (or a stop) its death is the EOF doing what it was sent to
        // do — expected, and not the session ending — so only `stop`'s wait
        // hears of it.
        exit: () => {
          custody.exited();
          if (!custody.handedOff) ctx.closed?.();
        },
        // §6's honest refusal, surfaced rather than smoothed over — unless the
        // refusal is of the peek alone. The caller's own cursor sits at `head`
        // and is always replayable; only the one seq before it can be gone,
        // and a gap nobody asked to see is not a seam in the transcript.
        reset: (nextSeq) => {
          if (peekSeq !== undefined && peekSeq < boundary) return;
          ctx.frame({
            type: 'system',
            subtype: 'sessiond_stream_gap',
            text: `whiffle: sessiond's replay window overflowed; this transcript resumes at line ${nextSeq}`,
          } as unknown as NeutralMessage);
        },
      },
      peekSeq ?? options.afterSeq
    );
    return custody;
  }

  /** What sessiond is still holding for this machine — the reattach's first read. */
  async custodyCandidates(): Promise<SessiondWelcomeInfo> {
    const client = await this.sessiond();
    return client.list();
  }

  listSessions(dir?: string): Promise<NeutralSessionInfo[]> {
    return listSessions({ ...(dir ? { dir } : {}) }).then((rows) => rows.map(toInfo));
  }

  async getSessionInfo(sessionKey: string, dir?: string): Promise<NeutralSessionInfo | undefined> {
    const info = await getSessionInfo(sessionKey, { ...(dir ? { dir } : {}) });
    return info ? toInfo(info) : undefined;
  }

  async getSessionMessages(sessionKey: string, dir?: string): Promise<SessionMessage[]> {
    const rows = await getSessionMessages(sessionKey, { ...(dir ? { dir } : {}) });
    // Only a transcript that asked the reader has a `toolUseResult` sidecar to
    // recover — skip the extra file read for everything else.
    const asksQuestion = rows.some((entry) => {
      const content = (entry.message as { content?: unknown } | null)?.content;
      return (
        Array.isArray(content) &&
        content.some((block) => (block as { type?: string; name?: string }).type === 'tool_use' && (block as { name?: string }).name === 'AskUserQuestion')
      );
    });
    if (!asksQuestion) return rows.map(toEntry);
    const sidecars = await readQuestionSidecars(sessionKey, dir);
    if (sidecars.size === 0) return rows.map(toEntry);
    return rows.map((entry) => {
      const result = sidecars.get(entry.uuid);
      if (!result) return toEntry(entry);
      return { ...toEntry(entry), message: attachQuestionResult(entry.message, result) };
    });
  }

  renameSession(sessionKey: string, title: string, dir?: string): Promise<void> {
    return renameSession(sessionKey, title, { ...(dir ? { dir } : {}) });
  }

  tagSession(sessionKey: string, tag: string | null, dir?: string): Promise<void> {
    return tagSession(sessionKey, tag, { ...(dir ? { dir } : {}) });
  }

  deleteSession(sessionKey: string, dir?: string): Promise<void> {
    return deleteSession(sessionKey, { ...(dir ? { dir } : {}) });
  }

  async machine(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'updateClaudeCode':
        return updateClaudeCode();
      case MARKETPLACE_CATALOG:
        return marketplaceCatalog(args[0] as string);
      case READ_MEMORY_FILE:
        return readMemoryFile();
      case READ_SKILL_FILES:
        return readSkillFiles(args[0] as string, args[1] as string | undefined);
      case INSPECT_CONFIG:
        return inspectConfig(args[0] as string | undefined);
      case 'beginLogin':
        return beginLogin();
      case 'completeLogin':
        return completeLogin(args[0] as string);
      case 'clearCredentials':
        return clearCredentials();
      case 'exportCredentials':
        return exportCredentials();
      case 'importCredentials':
        return importCredentials(args[0] as Record<string, unknown>);
      case 'unlockKeychain':
        return unlockKeychain(args[0] as string);
      case 'probeAuth':
        return probeAuth();
      default:
        return undefined;
    }
  }

  syncFleet(config: import('@whiffle/core').FleetConfig) {
    return syncFleetConfig(config);
  }

  fleetStatus() {
    return fleetStatus();
  }
}

export const claudeHarness: Harness = new ClaudeHarness();

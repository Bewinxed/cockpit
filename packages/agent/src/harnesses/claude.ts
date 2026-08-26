/**
 * The Claude Code adapter.
 *
 * The original harness — everything cockpit did before harnesses existed ran on
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
  SendPayload,
  SessionMessage,
  SpawnPayload,
  UserAnswers,
  UserQuestion,
  UserQuestionAnswered,
  UserQuestionResult,
} from '@cockpit/core';
import {
  ASK_USER_QUESTION,
  CONTROL_SET_EFFORT,
  INSPECT_CONFIG,
  MARKETPLACE_CATALOG,
  READ_MEMORY_FILE,
  READ_SKILL_FILES,
  isInjected,} from '@cockpit/core';
import {
  fleetStatus,
  inspectConfig,
  marketplaceCatalog,
  readMemoryFile,
  readSkillFiles,
  syncFleetConfig,
} from '../fleet';
import { DENIED_WEB_TOOLS } from '../denied-tools';
import { handoffServer } from '../handoff';
import { probeAuth, unlockKeychain } from '../auth';
import { beginLogin, clearCredentials, completeLogin, exportCredentials, importCredentials } from '../login';
import { resolveBin } from '../tools';
import { claudeConfigDirs } from '../usage/scan-claude';
import type { Harness, HarnessContext, HarnessSession } from '../harness';

/** The neutral frame is the SDK frame re-tagged: same fields, plus the original. */
export const toNeutral = (sdk: SDKMessage): NeutralMessage => {
  if (
    sdk.type === 'assistant' ||
    sdk.type === 'user' ||
    sdk.type === 'stream_event' ||
    sdk.type === 'result' ||
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

/** The prompt `query()` iterates, kept unresolved between turns. */
class InputStream implements AsyncIterable<SDKUserMessage> {
  #queue: SDKUserMessage[] = [];
  #waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  #ended = false;

  push(message: SDKUserMessage): void {
    const waiting = this.#waiting;
    if (waiting) {
      this.#waiting = null;
      waiting({ done: false, value: message });
      return;
    }
    this.#queue.push(message);
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
        if (queued) return Promise.resolve({ done: false, value: queued });
        if (this.#ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.#waiting = resolve;
        });
      },
    };
  }
}

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
   */
  readonly #openQuestions = new Map<string, { toolUseID: string; questions: UserQuestion[] }>();
  /** Denied questions, keyed by tool call, until their `tool_result` goes past. */
  readonly #dismissedQuestions = new Map<string, UserQuestionResult>();

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
    skills?: string[]
  ) {
    this.#ctx = ctx;
    const input = new InputStream();
    this.#input = input;
    const turn = new Turn();
    this.#turn = turn;

    // Claude in Chrome is on by default for every cockpit session.
    //
    // The CLI resolves it in `shouldEnableClaudeInChrome`, in this order:
    // OAuth scope -> `--chrome`/`--no-chrome` -> `CLAUDE_CODE_ENABLE_CFC` ->
    // `if (!isInteractive()) return false` -> `~/.claude.json`'s
    // `claudeInChromeDefaultEnabled`. Every cockpit session is non-interactive
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
          outpost: handoffServer(
            { instanceId, cwd: workdir, emit: (envelope) => ctx.emit(envelope) },
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
        disallowedTools: [
          ...new Set([
            ...((options as { disallowedTools?: string[] } | undefined)?.disallowedTools ?? []),
            ...DENIED_WEB_TOOLS,
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
        // model's, and writing a level here would put cockpit's guess in its
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
        canUseTool: (toolName, toolInput, { requestId, suggestions, toolUseID }) =>
          new Promise<PermissionResult>((resolve) => {
            this.#permissions.set(requestId, resolve);
            if (toolName === ASK_USER_QUESTION) {
              const questions = normalizeQuestions((toolInput as { questions?: unknown }).questions);
              if (questions) this.#openQuestions.set(requestId, { toolUseID, questions });
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

  async #pumpMessages(ctx: HarnessContext, handle: Query, turn: Turn): Promise<void> {
    try {
      for await (const message of handle) {
        const neutral = toNeutral(message);
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

    this.#turn.start();
    this.#input.push(withExtras(outgoing, extras.attachments, extras.images));

    // A hand-off is queued rather than asked (`shouldQuery: false`), so the SDK
    // appends it and emits nothing until the session next takes a turn. Echoed
    // as the frame the SDK will not send, so it appears the moment it lands.
    // The same is true of anything else cockpit injects — a rule's message has
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
    if (question) {
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
    }
    resolve(result);
  }

  async interrupt(): Promise<void> {
    await this.#handle.interrupt().catch(() => {});
  }

  async stop(): Promise<void> {
    this.#input.end();
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

const toEntry = (entry: import('@anthropic-ai/claude-agent-sdk').SessionMessage): SessionMessage => ({
  type: entry.type,
  uuid: entry.uuid,
  session_id: entry.session_id,
  // The SDK stores the *inner* message (its content blocks / text), which is
  // exactly what the dashboard's folding layer reads off `message.content`.
  message: entry.message,
  parent_tool_use_id: entry.parent_tool_use_id,
  parent_agent_id: entry.parent_agent_id,
});

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

  async spawn(spec: SpawnPayload, ctx: HarnessContext): Promise<HarnessSession> {
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
      spec.skills
    );
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

  syncFleet(config: import('@cockpit/core').FleetConfig) {
    return syncFleetConfig(config);
  }

  fleetStatus() {
    return fleetStatus();
  }
}

export const claudeHarness: Harness = new ClaudeHarness();

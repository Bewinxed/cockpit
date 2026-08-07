/**
 * Raw `SDKMessage` → the `Message` shape the ported renderers already consume.
 *
 * Pure by design: it returns what a frame means and the client store applies it.
 * The SDK's own types are the input contract (tunnelled through `@cockpit/core`),
 * so nothing here re-models them.
 */
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKStatus,
  SendPayload,
  SessionMessage,
  SlashCommand,
} from '@cockpit/core';
import type { SubagentState } from '$lib/utils/flow-types';
import { getToolGlance } from '$lib/utils/tool-display';
import type { Message, MessageMetadata, MessageType } from './types';
import { newId } from './id';

type AssistantBlock = SDKAssistantMessage['message']['content'][number];

/** A tool result to fold into the `tool.use` message that opened it. */
export interface ToolResult {
  toolId: string;
  result: string;
  isError: boolean;
}

/** The tool a session is running right now — the fleet view's glance line. */
export interface ToolGlance {
  toolId: string;
  name: string;
  glance: string;
}

/**
 * How one frame moves a subagent branch. Branches are keyed by the Task
 * `tool_use_id`, which is what forwarded subagent messages carry as their
 * `parent_tool_use_id`; the `task_*` system messages that report progress carry
 * a `task_id` instead, so a branch remembers both.
 */
export interface BranchEvent {
  toolUseId?: string;
  taskId?: string;
  subagentType?: string;
  description?: string;
  status?: SubagentState['status'];
  /** `agentProgressSummaries`' present-tense line, when enabled. */
  summary?: string;
  lastToolName?: string;
  result?: string;
  /** Requested alias from the spawn input, or the wire id an assistant frame answered with. */
  model?: string;
}

export interface FrameMapping {
  /** Appended to the transcript, in order. */
  messages: Message[];
  toolResults: ToolResult[];
  /**
   * The subagent branch `messages` and `toolResults` belong to. Absent means the
   * main transcript.
   */
  agentId?: string;
  /** A subagent branch's lifecycle, moved by this frame. */
  branch?: BranchEvent;
  /** The tool that just went in flight on the main loop. */
  currentTool?: ToolGlance;
  /** Text to append to the instance's streaming buffer. */
  delta: string;
  /** The streaming buffer has been superseded by a final message. */
  clearsStream: boolean;
  /** The turn is over — the session is idle again. */
  endsTurn: boolean;
  /**
   * What the session says it is doing right now: `compacting` while it rewrites
   * its own context, `requesting` while it waits on the model, `null` when it
   * has stopped saying. The only live word on a compaction — `compact_boundary`
   * arrives once the work is already done.
   */
  status?: SDKStatus;
  /** How a compaction ended, on the `status` frame that closes it. */
  compaction?: { result: 'success' | 'failed'; error?: string };
  /**
   * The whole `/` menu again, pushed when what is on disk changed mid-session.
   * The SDK sends the full list, so it replaces the cache rather than adding to
   * it — a skill that was deleted has to leave the menu too.
   */
  commands?: SlashCommand[];
  /**
   * The turn the `result` frame closes answered with an error, whatever its
   * subtype claims. The SDK's own flag — not a reading of what was said.
   */
  failedTurn?: boolean;
}

/** `task_updated`'s wire statuses, in the vocabulary the branch card renders. */
const TASK_STATUS: Record<string, SubagentState['status']> = {
  pending: 'starting',
  running: 'running',
  paused: 'running',
  completed: 'complete',
  failed: 'error',
  killed: 'error',
};

/**
 * Message types (and `system` subtypes) with no transcript meaning. Rendering a
 * line for each one buries the conversation; everything outside this set still
 * degrades to a generic system line rather than disappearing silently.
 */
const QUIET = new Set([
  'tool_progress',
  'control_request_progress',
  'thinking_tokens',
  'session_state_changed',
  'background_tasks_changed',
  'files_persisted',
  'rate_limit_event',
]);

/**
 * `model_fallback`: Claude Code took a model id it could not honour — every id
 * is accepted, and only the turn that follows says so — and names the one that
 * answered instead. The SDK does not type this message, so it is recognised by
 * its shape rather than by narrowing a union it is not in.
 */
const modelFallback = (sdk: {
  subtype: string;
}): { content: string; model: string } | null => {
  const frame = sdk as { subtype: string; content?: unknown; fallback_model?: unknown };
  if (frame.subtype !== 'model_fallback') return null;
  if (typeof frame.content !== 'string' || typeof frame.fallback_model !== 'string') return null;
  return { content: frame.content, model: frame.fallback_model };
};


/** The fleet tools whose calls are shown as hand-offs rather than tool cards. */
const HANDOFF_TOOLS: Record<string, 'handoff' | 'start'> = {
  mcp__outpost__handoff: 'handoff',
  mcp__outpost__start_session: 'start',
};

const empty = (): FrameMapping => ({
  messages: [],
  toolResults: [],
  delta: '',
  clearsStream: false,
  endsTurn: false,
});

const uuidOf = (sdk: SDKMessage): string | undefined => ('uuid' in sdk ? sdk.uuid : undefined);

const parentOf = (sdk: SDKMessage): string | undefined =>
  'parent_tool_use_id' in sdk ? (sdk.parent_tool_use_id ?? undefined) : undefined;

/** Tool results arrive as text blocks far more often than as a plain string. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) =>
        typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function blockToMessage(
  block: AssistantBlock,
  base: Omit<Message, 'type' | 'content'>
): Message | null {
  switch (block.type) {
    case 'text':
      return { ...base, type: 'assistant', content: block.text };
    case 'thinking':
      // Signature-only blocks carry no reasoning to show.
      if (!block.thinking) return null;
      return {
        ...base,
        type: 'thinking',
        content: block.thinking,
        metadata: { thinking: block.thinking, thinkingSignature: block.signature },
      };
    case 'redacted_thinking':
      return {
        ...base,
        type: 'thinking',
        content: '',
        metadata: { isRedactedThinking: true },
      };
    case 'tool_use': {
      // A hand-off is not a tool call to read like the others: it is this
      // session addressing another one, and the sender needs to see that it
      // left. Recognised by the tool's name — structured, not by its text.
      const handoff = HANDOFF_TOOLS[block.name];
      if (handoff) {
        const input = (block.input ?? {}) as { target?: unknown; cwd?: unknown; prompt?: unknown };
        return {
          ...base,
          type: 'tool.handoff',
          content: String(input.target ?? input.cwd ?? ''),
          toolCallId: block.id,
          metadata: {
            toolId: block.id,
            toolName: block.name,
            toolInput: block.input as MessageMetadata['toolInput'],
            toolStatus: 'pending',
            handoffKind: handoff,
            handoffBrief: String(input.prompt ?? (block.input as { message?: unknown })?.message ?? ''),
          },
        };
      }
      const spawn = subagentSpawn(block.input);
      return {
        ...base,
        type: 'tool.use',
        content: block.name,
        toolCallId: block.id,
        metadata: {
          toolId: block.id,
          toolName: block.name,
          toolInput: block.input as MessageMetadata['toolInput'],
          toolStatus: 'pending',
          subagentType: spawn?.subagentType,
          subagentDescription: spawn?.description,
          subagentModel: spawn?.model,
        },
      };
    }
    default:
      return null;
  }
}

/**
 * A tool call that spawns a subagent, recognised by its input rather than by the
 * tool's name — the same call is the Task tool and the Agent tool depending on
 * the session's tool set.
 */
function subagentSpawn(
  input: unknown
): { subagentType: string; description?: string; model?: string } | null {
  if (typeof input !== 'object' || input === null) return null;
  const { subagent_type: type, description, model } = input as Record<string, unknown>;
  if (typeof type !== 'string') return null;
  return {
    subagentType: type,
    description: typeof description === 'string' ? description : undefined,
    model: typeof model === 'string' ? model : undefined,
  };
}

function systemLine(
  base: Omit<Message, 'type' | 'content'>,
  type: MessageType,
  content: string,
  metadata?: MessageMetadata
): Message {
  return { ...base, type, content, metadata };
}

/** What one SDK frame does to an instance's UI state. */
export function mapFrame(instanceId: string, sdk: SDKMessage): FrameMapping {
  const mapping = empty();
  const uuid = uuidOf(sdk);
  // `forwardSubagentText` forwards a subagent's own turns with their
  // `parent_tool_use_id` set to the Task call that spawned them, so this is the
  // attribution the tree is built from — not `parent_agent_id`, which only ever
  // names a *grandparent* and is always null at the SDK's depth cap of 1.
  const agentId = parentOf(sdk);
  const base: Omit<Message, 'type' | 'content'> = {
    id: uuid ?? newId(),
    instanceId,
    timestamp: new Date(),
    sdkUuid: uuid,
    parentToolUseId: agentId,
  };
  mapping.agentId = agentId;

  switch (sdk.type) {
    case 'assistant': {
      sdk.message.content.forEach((block, index) => {
        const message = blockToMessage(block, { ...base, id: `${base.id}:${index}` });
        if (message) mapping.messages.push(message);
        if (block.type !== 'tool_use' || agentId) return;
        mapping.currentTool = {
          toolId: block.id,
          name: block.name,
          glance: getToolGlance(block.input as Record<string, unknown>),
        };
        const spawn = subagentSpawn(block.input);
        if (spawn) {
          mapping.branch = { toolUseId: block.id, ...spawn, status: 'starting' };
        }
      });
      // The forwarded frame names the model that actually answered — ground truth
      // over whatever alias the spawn input asked for.
      if (agentId && typeof sdk.message.model === 'string') {
        mapping.branch = { toolUseId: agentId, model: sdk.message.model };
      }
      // The final message supersedes whatever the partials painted.
      mapping.clearsStream = true;
      break;
    }

    case 'user': {
      const content = sdk.message.content;
      // A subagent's opening prompt has no local copy to render from, and it is
      // the first thing its branch should say. The main loop's own text does
      // have one, added on send, so it is skipped — except when it isn't the
      // human's at all, which nothing echoes either.
      const text = transcriptUserText(sdk.message);
      // A message from another session is nobody's local echo, so nothing else
      // will render it — and it must not render as the reader's own words.
      const peer = 'origin' in sdk && sdk.origin?.kind === 'peer' ? sdk.origin : null;
      if (peer && text) {
        mapping.messages.push({
          ...base,
          type: 'user.peer',
          content: peer.body ?? text,
          metadata: {
            peerFrom: peer.from,
            peerName: peer.name,
            peerSession: peer.fromSession,
          },
        });
        break;
      }
      if (text && (agentId || systemNote(text))) {
        mapping.messages.push({ ...base, ...userBody(text, transcriptUserImages(sdk.message)) });
      }
      if (typeof content === 'string') break;
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        mapping.toolResults.push({
          toolId: block.tool_use_id,
          result: resultText(block.content),
          isError: block.is_error === true,
        });
      }
      break;
    }

    case 'stream_event': {
      const event = sdk.event;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        mapping.delta = event.delta.text;
      } else if (event.type === 'message_stop') {
        mapping.clearsStream = true;
      }
      break;
    }

    case 'result': {
      mapping.clearsStream = true;
      mapping.endsTurn = true;
      // `subtype` is how the *run* ended; `is_error` is whether the turn did.
      // They disagree: a machine with no credentials answers "Not logged in"
      // and closes with `subtype: 'success', is_error: true` — measured on a
      // real one. Reading only the subtype makes that a normal turn, which is
      // what left the failure to be recognised by its prose.
      mapping.failedTurn = sdk.is_error === true;
      if (sdk.subtype === 'success') break;
      mapping.messages.push(
        systemLine(base, 'result.error', sdk.subtype.replace(/_/g, ' '), {
          resultSubtype: sdk.subtype,
          resultErrors: 'errors' in sdk ? sdk.errors : undefined,
          totalCost: sdk.total_cost_usd,
          numTurns: sdk.num_turns,
        })
      );
      break;
    }

    case 'system': {
      const fallback = modelFallback(sdk);
      if (fallback) {
        mapping.messages.push(
          systemLine(base, 'system.model_fallback', fallback.content, {
            subtype: 'model_fallback',
            model: fallback.model,
          })
        );
        break;
      }
      switch (sdk.subtype) {
        case 'init':
          mapping.messages.push(
            systemLine(base, 'system.init', `Session started · ${sdk.model}`, {
              subtype: 'init',
              model: sdk.model,
              permissionMode: sdk.permissionMode,
              cwd: sdk.cwd,
              tools: sdk.tools,
              sessionId: sdk.session_id,
              mcpServers: sdk.mcp_servers,
              // Re-listed every turn, and the only source of which of them are
              // skills — `supportedCommands` describes the commands but does
              // not say where any of them came from.
              slashCommands: sdk.slash_commands,
              skills: sdk.skills,
            })
          );
          break;
        case 'commands_changed':
          mapping.commands = sdk.commands;
          break;
        case 'status':
          mapping.status = sdk.status;
          if (sdk.compact_result) {
            mapping.compaction = { result: sdk.compact_result, error: sdk.compact_error };
          }
          break;
        case 'task_started':
          mapping.branch = {
            toolUseId: sdk.tool_use_id,
            taskId: sdk.task_id,
            subagentType: sdk.subagent_type,
            description: sdk.description,
            status: 'running',
          };
          break;
        case 'task_progress':
          mapping.branch = {
            toolUseId: sdk.tool_use_id,
            taskId: sdk.task_id,
            subagentType: sdk.subagent_type,
            description: sdk.description,
            status: 'running',
            summary: sdk.summary,
            lastToolName: sdk.last_tool_name,
          };
          break;
        case 'task_notification':
          mapping.branch = {
            toolUseId: sdk.tool_use_id,
            taskId: sdk.task_id,
            status: sdk.status === 'completed' ? 'complete' : 'error',
            summary: sdk.summary,
            result: sdk.summary,
          };
          break;
        case 'task_updated':
          mapping.branch = {
            taskId: sdk.task_id,
            description: sdk.patch.description,
            status: sdk.patch.status ? TASK_STATUS[sdk.patch.status] : undefined,
            summary: sdk.patch.error,
          };
          break;
        case 'compact_boundary':
          mapping.messages.push(
            systemLine(base, 'system.compact_boundary', 'Context compacted', {
              subtype: 'compact_boundary',
              preTokens: sdk.compact_metadata.pre_tokens,
              trigger: sdk.compact_metadata.trigger,
            })
          );
          break;
        case 'hook_response':
          mapping.messages.push(
            systemLine(base, `system.hook_response`, sdk.subtype.replace(/_/g, ' '), {
              subtype: 'hook_response',
              hookName: sdk.hook_name,
              exitCode: sdk.exit_code,
              stdout: sdk.stdout,
              stderr: sdk.stderr,
            })
          );
          break;
        default:
          if (!QUIET.has(sdk.subtype)) {
            mapping.messages.push(
              systemLine(base, `system.${sdk.subtype}`, sdk.subtype.replace(/_/g, ' '), {
                subtype: sdk.subtype,
              })
            );
          }
      }
      break;
    }

    default:
      if (!QUIET.has(sdk.type)) {
        mapping.messages.push(systemLine(base, `system.${sdk.type}`, sdk.type.replace(/_/g, ' ')));
      }
  }

  // A subagent's own text streams under its branch; letting it through here
  // would repaint the main loop's buffer with a nested agent's sentences.
  if (agentId) {
    mapping.delta = '';
    mapping.clearsStream = false;
  }

  return mapping;
}

/**
 * The branch a subagent's messages belong to, created on first sight. Callers
 * must use the returned value rather than the literal: when `branches` is a
 * `$state` proxy, writes land on the proxy's signals and never on the object
 * that was assigned in.
 */
export function branchFor(
  branches: Record<string, SubagentState>,
  instanceId: string,
  toolUseId: string
): SubagentState {
  const existing = branches[toolUseId];
  if (existing) return existing;

  branches[toolUseId] = {
    toolUseId,
    instanceId,
    subagentType: 'subagent',
    status: 'starting',
    startedAt: new Date(),
    messages: [],
  };
  return branches[toolUseId];
}

/** Folds a frame's branch event into the session's subagent branches. */
export function applyBranchEvent(
  branches: Record<string, SubagentState>,
  instanceId: string,
  event: BranchEvent
): void {
  // `task_updated` names only the task, so an already-known branch answers for it.
  const key =
    event.toolUseId ??
    Object.values(branches).find((branch) => branch.taskId === event.taskId)?.toolUseId;
  if (!key) return;

  const branch = branchFor(branches, instanceId, key);
  if (event.taskId) branch.taskId = event.taskId;
  if (event.subagentType) branch.subagentType = event.subagentType;
  if (event.description) branch.description = event.description;
  if (event.summary) branch.summary = event.summary;
  if (event.lastToolName) branch.lastToolName = event.lastToolName;
  if (event.model) branch.model = event.model;
  if (event.result) branch.result = event.result;
  // Finished is final. A branch that has reported `complete` or `error` is done,
  // and the progress frames still in flight behind it would otherwise put it
  // back to `running` — leaving every subagent reading "working" forever, long
  // after it answered.
  const settled = branch.status === 'complete' || branch.status === 'error';
  // A late `starting` must not walk a running branch backwards.
  if (event.status && !settled && !(event.status === 'starting' && branch.status !== 'starting')) {
    branch.status = event.status;
    if (event.status === 'complete' || event.status === 'error') branch.completedAt = new Date();
  }
}

/** The one line a collapsed branch card shows for what its subagent is doing. */
export function branchActivity(branch: SubagentState): string {
  if (branch.summary) return branch.summary;
  if (branch.status === 'complete' && branch.result) return branch.result;
  const last = branch.messages[branch.messages.length - 1];
  if (last?.type === 'tool.use') return last.metadata?.toolName ?? 'working';
  if (last?.type === 'assistant') return last.content;
  return branch.lastToolName ?? branch.description ?? '';
}

/**
 * The user's own text, which live frames never echo (the local copy covers it)
 * but a stored transcript is the only source of.
 */
function transcriptUserText(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block: unknown) => (block as { type?: string })?.type === 'text')
    .map((block: unknown) => String((block as { text?: unknown }).text ?? ''))
    .join('\n');
  return text || null;
}

/**
 * The images a user turn carried. A stored transcript keeps them whole, base64
 * data and all, so the bubble can show what was actually sent; a block sourced
 * from a URL has nothing to inline and is left for the placeholder to name.
 */
function transcriptUserImages(message: unknown): MessageMetadata['images'] {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return undefined;
  const images = content
    .filter((block: unknown) => (block as { type?: string })?.type === 'image')
    .map((block: unknown) => {
      const source = (block as { source?: { media_type?: string; data?: string } }).source;
      const mediaType = source?.media_type ?? 'image/png';
      return {
        mediaType,
        dataUri: source?.data ? `data:${mediaType};base64,${source.data}` : undefined,
      };
    });
  return images.length ? images : undefined;
}

/**
 * What a user-role message renders as. Both the live and the stored path build
 * their user messages from this, so the harness's own voice is never mistaken
 * for the human's on one of them.
 */
function userBody(
  text: string,
  images?: MessageMetadata['images']
): Pick<Message, 'type' | 'content' | 'metadata'> {
  const note = systemNote(text);
  if (!note) return { type: 'user', content: text, metadata: images ? { images } : undefined };
  return {
    type: 'ui.system_note',
    content: text,
    metadata: { noteKind: note.kind, noteTitle: note.title },
  };
}

/** Harness-injected content arrives with role "user" but is not the human. */
function systemNote(text: string): { kind: string; title: string } | null {
  const head = text.trimStart().slice(0, 200);
  if (head.startsWith('[SYSTEM NOTIFICATION') || head.includes('<task-notification>')) {
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim();
    return { kind: 'Task notification', title: summary ?? firstPlainLine(text) };
  }
  if (head.startsWith('<system-reminder>')) {
    return { kind: 'System reminder', title: firstPlainLine(text) };
  }
  if (head.startsWith('This session is being continued from a previous conversation')) {
    return { kind: 'Session continued', title: 'Compacted conversation summary' };
  }
  return null;
}

/** A note's opening line, with the markup that wraps it taken back out. */
function firstPlainLine(text: string): string {
  const plain = text
    .replace(/<[^>]+>/g, '')
    .replace('[SYSTEM NOTIFICATION - NOT USER INPUT]', '');
  const line = plain
    .split('\n')
    .map((each) => each.trim())
    .find(Boolean);
  if (!line) return '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** A stored session, split the same way a live one is. */
export interface Transcript {
  messages: Message[];
  /** Subagent branches, keyed by the Task `tool_use_id` that spawned them. */
  subagents: Record<string, SubagentState>;
}

/**
 * What an entry that opens a main-loop turn said, and null for everything else —
 * including the user-role entries that carry nothing but a tool result. Only one
 * of these can begin a chunk: anywhere else a slice would open mid-turn, with
 * results arriving for a `tool.use` that is on the other side of the cut. A turn
 * that was nothing but an image still opened one.
 */
function turnStart(
  entry: SessionMessage
): { text: string; images?: MessageMetadata['images'] } | null {
  if (entry.type !== 'user' || entry.parent_tool_use_id) return null;
  const text = transcriptUserText(entry.message);
  const images = transcriptUserImages(entry.message);
  if (text === null && !images) return null;
  return { text: text ?? '', images };
}

/**
 * The entries between a tool call and the result answering it, marked so no
 * chunk boundary can land inside one. A turn start is nearly always outside them
 * already, but the harness writes its own user-role text mid-turn (a skill's
 * base directory, for one), and a Task call has its subagent's whole branch in
 * there. A call that was never answered spans nothing and blocks nothing.
 */
function spannedByToolCalls(transcript: SessionMessage[]): Int32Array {
  const depth = new Int32Array(transcript.length + 1);
  const open = new Map<string, number>();

  transcript.forEach((entry, index) => {
    const content = (entry.message as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) return;
    for (const block of content as { type?: string; id?: string; tool_use_id?: string }[]) {
      if (block.type === 'tool_use' && block.id) open.set(block.id, index);
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      const from = open.get(block.tool_use_id);
      if (from === undefined) continue;
      open.delete(block.tool_use_id);
      depth[from + 1]++;
      depth[index]--;
    }
  });

  for (let index = 1; index < depth.length; index++) depth[index] += depth[index - 1];
  return depth;
}

/**
 * Where a transcript can be split into chunks of roughly `size` entries,
 * ascending from 0. Each index is a multiple of `size` snapped back to the turn
 * it landed in, so mapping any `[boundary, next boundary)` slice on its own
 * gives what mapping the whole would have given for that stretch.
 */
export function turnBoundaries(transcript: SessionMessage[], size: number): number[] {
  if (transcript.length <= size) return [0];
  const spanned = spannedByToolCalls(transcript);
  const cuttable = (index: number) => !spanned[index] && turnStart(transcript[index]) !== null;

  const boundaries = [0];
  for (let cursor = size; cursor < transcript.length; cursor += size) {
    let index = cursor;
    while (index > 0 && !cuttable(index)) index--;
    // A turn longer than one chunk snaps onto the boundary already taken, and
    // stays one chunk rather than being cut where the pairs would not survive.
    if (index > boundaries[boundaries.length - 1]) boundaries.push(index);
  }
  return boundaries;
}

/**
 * A stored session (`getSessionMessages`) as a transcript. Each entry's `message`
 * is the raw SDK message, so the live mapping does the work — only user text,
 * which live sessions render from the local copy, is handled here.
 */
export function mapTranscript(instanceId: string, transcript: SessionMessage[]): Transcript {
  const messages: Message[] = [];
  const subagents: Record<string, SubagentState> = {};

  for (const entry of transcript) {
    if (entry.type === 'system') continue;

    // A hand-off is a user-role message and looks exactly like one the reader
    // typed — so this branch claimed it and rendered another agent's words as
    // the reader's own, which is the one thing the peer origin exists to stop.
    // `mapFrame` below knows the difference; let it have them.
    const fromPeer =
      'origin' in entry && (entry as { origin?: { kind?: string } }).origin?.kind === 'peer';
    const opening = fromPeer ? null : turnStart(entry);
    if (opening) {
      messages.push({
        id: entry.uuid,
        instanceId,
        ...userBody(opening.text, opening.images),
        timestamp: new Date(),
        sdkUuid: entry.uuid,
      });
      continue;
    }

    const mapping = mapFrame(instanceId, entry as unknown as SDKMessage);
    if (mapping.branch) applyBranchEvent(subagents, instanceId, mapping.branch);

    const sink = mapping.agentId
      ? branchFor(subagents, instanceId, mapping.agentId).messages
      : messages;
    sink.push(...mapping.messages);
    for (const result of mapping.toolResults) applyToolResult(sink, result);
  }

  // Nothing further will arrive for a stored session; anything still open ended
  // with the session rather than being live.
  for (const branch of Object.values(subagents)) {
    if (branch.status !== 'error') branch.status = 'complete';
  }

  return { messages, subagents };
}

/** The message optimistically shown for text the user just sent. */
export function localUserMessage(
  instanceId: string,
  text: string,
  { attachments, images }: Pick<SendPayload, 'attachments' | 'images'> = {}
): Message {
  const carried = Boolean(attachments?.length || images?.length);
  return {
    id: newId(),
    instanceId,
    type: 'user',
    content: text,
    timestamp: new Date(),
    // Thumbnails come from the same base64 that went out: nothing comes back to
    // build them from, since the live path never echoes the user's own turn.
    metadata: carried
      ? {
          attachments: attachments?.map(({ name, content }) => ({ name, chars: content.length })),
          images: images?.map(({ mediaType, data }) => ({
            mediaType,
            dataUri: `data:${mediaType};base64,${data}`,
          })),
        }
      : undefined,
  };
}

/** A client- or hub-side failure, rendered inline so it cannot be missed. */
export function errorMessage(instanceId: string, text: string): Message {
  return {
    id: newId(),
    instanceId,
    type: 'ui.error',
    content: text,
    timestamp: new Date(),
  };
}

/** A session that died before it said anything — the registry row is all there is. */
export function sessionFailedMessage(instanceId: string, reason: string): Message {
  return {
    id: `${instanceId}:failed`,
    instanceId,
    type: 'ui.session_error',
    content: reason,
    timestamp: new Date(),
    metadata: { errorTitle: 'Session failed to start' },
  };
}

/** Folds a tool result into the `tool.use` it answers. */
export function applyToolResult(messages: Message[], { toolId, result, isError }: ToolResult): void {
  // `tool.handoff` is a tool call too — it just renders as a receipt. Matching
  // only `tool.use` left it stuck on "sending…" with the answer never applied.
  const target = messages.find(
    (m) => (m.type === 'tool.use' || m.type === 'tool.handoff') && m.metadata?.toolId === toolId
  );
  if (!target) return;
  target.metadata = {
    ...target.metadata,
    toolResult: result,
    toolStatus: isError ? 'error' : 'success',
  };
}

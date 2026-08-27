/**
 * The transcript shape the ported renderers consume. It is a *view* type, not a
 * protocol type: frames arrive as SDK messages (`@cockpit/core`) and `frames.ts`
 * folds them into these. Anything that describes the wire belongs in the SDK.
 */
import type {
  AvailableCommand,
  SDKCompactBoundaryMessage,
  SDKHookResponseMessage,
  SDKResultMessage,
  SDKStatus,
  SDKSystemMessage,
  UserQuestionResult,
} from '@cockpit/core';
import type { SubagentState } from '$lib/utils/flow-types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type MessageType =
  | 'user'
  /** A message another session sent — reported speech, never the reader's own. */
  | 'user.peer'
  /** A delegate's routed permission ask — plumbing between sessions, folded into its delegate's card. */
  | 'user.delegate_ask'
  | 'assistant'
  | 'thinking'
  | 'tool.use'
  /** This session handing work to another one. */
  | 'tool.handoff'
  | 'tool.result'
  | 'tool.progress'
  | 'result.success'
  | 'result.error'
  | `system.${string}`
  | `ui.${string}`;

export interface Message {
  id?: string;
  instanceId: string;
  /** Links this message to the Task tool.use that spawned it (subagent output). */
  parentToolUseId?: string;
  type: MessageType;
  content: string;
  /**
   * When the turn happened, on the client's own clock — set only on the live
   * path, where that clock is the truth. A message folded out of a *stored*
   * transcript carries none: `SessionMessage` (packages/core `harness.ts`) has
   * no timestamp field, so the harness's real one never reaches this layer, and
   * stamping the parse time instead would render a time that never happened.
   * Absent beats invented; readers must handle it being unset.
   */
  timestamp?: Date;
  /** The SDK message's own uuid — the handle for rewind and fork. */
  sdkUuid?: string;
  toolCallId?: string | null;
  metadata?: MessageMetadata;
}

/** Everything a renderer may need beyond `content`, keyed by the type that uses it. */
export interface MessageMetadata {
  /**
   * How long the thinking block actually ran, measured by the client's own
   * clock between `content_block_start` and the settled message. Preferred
   * over transcript adjacency, which reads 0 when thinking and a tool call
   * land in one frame.
   */
  thinkingDurationMs?: number;
  /**
   * A local echo of a turn sent to a session that may have been busy — a guess,
   * drawn before any frame came back, and the flag is what makes it one the
   * store can take back. When the daemon announces the message as queued
   * (`message_queued`), this copy is retired and the queue's own row takes its
   * place; when no such frame ever arrives — an older daemon, or an idle
   * session that started the turn at once — the copy simply stays, which is
   * every dashboard's behaviour before the queue was observable.
   */
  queuedLocally?: boolean;
  // Tool messages
  toolId?: string;
  toolName?: string;
  toolInput?: JsonValue;
  toolResult?: JsonValue;
  toolStatus?: 'pending' | 'success' | 'error';
  /**
   * The reader's answers to an `AskUserQuestion` tool result, normalised by the
   * harness adapter (`UserQuestionResult`: questions + answers keyed by question
   * text, plus any freeform `response` and per-question `annotations`). Written
   * once, in `applyToolResult`, and read only by the question renderer.
   */
  toolUseResult?: UserQuestionResult;
  // System messages
  subtype?: string;
  command?: string;
  model?: SDKSystemMessage['model'];
  /** `init` only, and re-reported every turn: what the session answers tools with. */
  permissionMode?: SDKSystemMessage['permissionMode'];
  cwd?: string;
  tools?: SDKSystemMessage['tools'];
  sessionId?: string;
  status?: SDKStatus;
  mcpServers?: SDKSystemMessage['mcp_servers'];
  /** `init` only: what this session answers behind `/`, without the leading slash. */
  slashCommands?: SDKSystemMessage['slash_commands'];
  /** `init` only: which of those names are skills rather than commands. */
  skills?: SDKSystemMessage['skills'];
  // Compact boundary
  /** Who sent a {@link MessageType} of `user.peer`: the sending session's id. */
  handoffKind?: 'handoff' | 'start' | 'delegate';
  handoffBrief?: string;
  peerFrom?: string;
  /** Its display name, as the sender's host asserted it. */
  peerName?: string;
  /**
   * Set when the message is a rule firing rather than another session speaking.
   * It rides the `user.peer` type because that type already means "not the
   * reader's own words", which is the property that matters; this field is what
   * lets the bubble say so accurately.
   */
  ruleName?: string;
  /** The sender's host-openable session, so the card can link back to it. */
  peerSession?: string;
  /** Set when a `user.peer` is a delegate's auto-report rather than a hand-off. */
  reportKind?: 'report' | 'failed';
  /** A `user.delegate_ask`'s hub permission requestId — what it waits on to be answered. */
  askRequestId?: string;
  /** A `user.delegate_ask`'s display label, e.g. `cockpit#506dfafb`. */
  askLabel?: string;
  preTokens?: number;
  trigger?: 'manual' | 'auto';
  // Hook response
  hookName?: SDKHookResponseMessage['hook_name'];
  exitCode?: SDKHookResponseMessage['exit_code'];
  stdout?: SDKHookResponseMessage['stdout'];
  stderr?: SDKHookResponseMessage['stderr'];
  // Session error
  /** The `ui.session_error` card's heading; a missing session when unset. */
  errorTitle?: string;
  // Login prompt
  authUrl?: string;
  oauthState?: string;
  // Model picker
  loading?: boolean;
  error?: string;
  models?: Array<{ value: string; displayName: string; description: string }>;
  currentModel?: string;
  selectedModel?: string;
  // Memory picker
  memoryPhase?: 'selection' | 'editing';
  selectedMemoryType?: 'project' | 'user';
  memoryContent?: string;
  memoryPath?: string;
  // Ask question (AskUserQuestion tool / onUserDialog)
  questionRequestId?: string;
  questions?: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  questionAnswers?: Record<string, string>;
  // Help menu
  version?: string;
  commands?: AvailableCommand[];
  // Thinking blocks
  thinking?: string;
  thinkingSignature?: string;
  isRedactedThinking?: boolean;
  // Result errors
  resultSubtype?: string;
  resultErrors?: string[];
  totalCost?: number;
  numTurns?: number;
  result?: string;
  /** The task a `system.task` line reports — the dedupe key against the
   *  harness's own XML notification for the same completion. */
  taskId?: string;
  // Subagent spawning (Task tool)
  subagentType?: string;
  subagentDescription?: string;
  /** The `model` override the spawn input asked for, when present. */
  subagentModel?: string;
  /**
   * The delegate instance id, extracted from the tool result once at
   * {@link applyToolResult} time so DelegateBranch and suppression logic read a
   * field instead of parsing prose. Set on `tool.handoff` messages with
   * `handoffKind === 'delegate'` whose result has been applied.
   */
  delegateInstanceId?: string;
  /** The delegate's brief headline, carried beside {@link delegateInstanceId}. */
  delegateTitle?: string;
  // Harness-injected user-role content (task notifications, reminders, compaction)
  noteKind?: string;
  noteTitle?: string;
  /** A task notification's Task `tool_use_id` — folds the note into its branch. */
  noteTaskToolId?: string;
  // What a user turn carried besides its typed text
  /** Pastes the input turned into chips; the text itself went to the model, not here. */
  attachments?: Array<{ name: string; chars: number }>;
  /** A stored transcript can name an image it no longer carries, hence the optional uri. */
  images?: Array<{ mediaType: string; dataUri?: string }>;
}

/** An ask's life: parked on the parent, then allowed or refused by it. */
export type DelegateAskStatus = 'pending' | 'answered' | 'denied';

/** What every kind of {@link DelegateEvent} carries, whichever it is. */
interface DelegateEventBase {
  /** The hub's row id — what a fold deduplicates on and orders by. */
  id: number;
  /** The delegate the traffic is about, never the parent, on any of the kinds. */
  instanceId: string;
  parentInstanceId: string;
  /** The permission request an ask and its answer share; null on a report. */
  requestId: string | null;
  toolName: string | null;
  requestKind: 'question' | 'tool' | null;
  /** An ask's own state; null on an answer and a report, which settle nothing. */
  status: DelegateAskStatus | null;
  createdAt: string;
}

/**
 * One line of the hub's record of what a delegate and its parent said to each
 * other — `delegate_events` (packages/hub `db/schema.ts`), read over
 * `GET /api/delegate-events` and pushed as a `delegate_event` frame. The hub is
 * the system of record: the transcript markers say the same things, but only
 * for a reader who was watching, and only as text to be parsed back.
 */
export type DelegateEvent =
  | (DelegateEventBase & {
      kind: 'ask';
      /** The tool input as the harness asked it — `{filepath, diff}`, `{questions}`, … */
      payload: { input?: Record<string, JsonValue> };
    })
  | (DelegateEventBase & {
      kind: 'answer';
      payload: { behavior?: string; answers?: Record<string, JsonValue> };
    })
  | (DelegateEventBase & { kind: 'report'; payload: { body: string; failed: boolean } });

/** The two kinds a card renders directly; an answer only settles its ask. */
export type DelegateAskEvent = Extract<DelegateEvent, { kind: 'ask' }>;
export type DelegateReportEvent = Extract<DelegateEvent, { kind: 'report' }>;

/**
 * One row of the session view: consecutive tool calls collapse into a group, a
 * Task call becomes the branch it spawned, everything else stands alone. Shared
 * because the transcript renders these and the in-app search reads them.
 */
export type TranscriptGroup =
  | { kind: 'single'; message: Message; index: number }
  | { kind: 'tools'; messages: Message[]; index: number }
  | { kind: 'subagent'; branch: SubagentState; spawn: Message; index: number };

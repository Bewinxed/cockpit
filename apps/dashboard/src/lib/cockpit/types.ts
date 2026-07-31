/**
 * The transcript shape the ported renderers consume. It is a *view* type, not a
 * protocol type: frames arrive as SDK messages (`@cockpit/core`) and `frames.ts`
 * folds them into these. Anything that describes the wire belongs in the SDK.
 */
import type {
  SDKCompactBoundaryMessage,
  SDKHookResponseMessage,
  SDKResultMessage,
  SDKStatus,
  SDKSystemMessage,
} from '@cockpit/core';
import type { SubagentState } from '$lib/utils/flow-types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type MessageType =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool.use'
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
  timestamp: Date;
  /** The SDK message's own uuid — the handle for rewind and fork. */
  sdkUuid?: string;
  toolCallId?: string | null;
  metadata?: MessageMetadata;
}

/** Everything a renderer may need beyond `content`, keyed by the type that uses it. */
export interface MessageMetadata {
  // Tool messages
  toolId?: string;
  toolName?: string;
  toolInput?: JsonValue;
  toolResult?: JsonValue;
  toolStatus?: 'pending' | 'success' | 'error';
  toolUseResult?: JsonValue;
  // System messages
  subtype?: string;
  command?: string;
  model?: SDKSystemMessage['model'];
  cwd?: string;
  tools?: SDKSystemMessage['tools'];
  sessionId?: string;
  status?: SDKStatus;
  mcpServers?: SDKSystemMessage['mcp_servers'];
  // Compact boundary
  preTokens?: SDKCompactBoundaryMessage['compact_metadata']['pre_tokens'];
  trigger?: SDKCompactBoundaryMessage['compact_metadata']['trigger'];
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
  commands?: Array<{
    name: string;
    description?: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
  }>;
  // Thinking blocks
  thinking?: string;
  thinkingSignature?: string;
  isRedactedThinking?: boolean;
  // Result errors
  resultSubtype?: SDKResultMessage['subtype'];
  resultErrors?: Extract<SDKResultMessage, { errors: string[] }>['errors'];
  totalCost?: SDKResultMessage['total_cost_usd'];
  numTurns?: SDKResultMessage['num_turns'];
  result?: Extract<SDKResultMessage, { subtype: 'success' }>['result'];
  // Subagent spawning (Task tool)
  subagentType?: string;
  subagentDescription?: string;
  // Harness-injected user-role content (task notifications, reminders, compaction)
  noteKind?: string;
  noteTitle?: string;
  // What a user turn carried besides its typed text
  /** Pastes the input turned into chips; the text itself went to the model, not here. */
  attachments?: Array<{ name: string; chars: number }>;
  /** A stored transcript can name an image it no longer carries, hence the optional uri. */
  images?: Array<{ mediaType: string; dataUri?: string }>;
}

/**
 * One row of the session view: consecutive tool calls collapse into a group, a
 * Task call becomes the branch it spawned, everything else stands alone. Shared
 * because the transcript renders these and the in-app search reads them.
 */
export type TranscriptGroup =
  | { kind: 'single'; message: Message; index: number }
  | { kind: 'tools'; messages: Message[]; index: number }
  | { kind: 'subagent'; branch: SubagentState; spawn: Message; index: number };

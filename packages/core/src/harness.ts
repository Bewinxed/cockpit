/**
 * The harness-neutral spine (the 2026-08 rework).
 *
 * Cockpit once tunnelled Claude Agent SDK types verbatim — `@cockpit/core`
 * re-exported the SDK, the agent spawned `query()` and the dashboard folded SDK
 * messages into view state. Making the product harness-agnostic means the wire,
 * the hub and the dashboard all speak a vocabulary cockpit owns, and each
 * harness (claude, opencode, pi, …) is a daemon-side adapter that translates its
 * native events into it.
 *
 * Design rules for anything added here:
 * - This is the *only* wire contract. The dashboard folds these types, the hub
 *   peeks them, the agent adapters produce them.
 * - Field names deliberately mirror the Claude Agent SDK where a shape already
 *   exists there (it is the richest harness). That keeps the folding layer a
 *   type swap rather than a rewrite, and makes the claude adapter a re-tag.
 * - Every message carries `raw` — the harness's own event, verbatim — so a
 *   feature not yet modelled can still be reached without a protocol change.
 * - Nothing in this file imports a harness SDK. Those are agent-internal
 *   dependencies, never shared on the wire.
 */

/** The harnesses cockpit can spawn sessions on. Adding one is a new adapter. */
export type HarnessKind = 'claude' | 'opencode' | 'pi';

export const HARNESSES: readonly HarnessKind[] = ['claude', 'opencode', 'pi'];

/** How a session answers tool permissions. The union is Claude Code's; others map onto it. */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto';

/** A session's own word on what it is doing right now. */
export type NeutralStatus = 'compacting' | 'requesting' | null;

/* ------------------------------------------------------------------ MCP — */

/** MCP server config shapes, re-declared so `fleet.ts` stops importing the SDK. */
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  alwaysLoad?: boolean;
}

export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  alwaysLoad?: boolean;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  alwaysLoad?: boolean;
}

export interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | string;
  serverInfo?: { name: string; version?: string };
  error?: string;
  config?: Record<string, unknown>;
  scope?: string;
  tools?: { name: string; description?: string }[];
}

/* --------------------------------------------------------------- models — */

/** One model a session offers. `value` is the wire id; `resolvedModel` the alias. */
export interface ModelInfo {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
  supportsAutoMode?: boolean;
}

/* ------------------------------------------------------------- commands — */

/** What the composer's `/` menu renders. Replaces the SDK's `SlashCommand`. */
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
}

/* ----------------------------------------------------------- permissions — */

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg';

/** A permission the SDK suggests persisting, so "always allow" has something to write. */
export type PermissionUpdate =
  | {
      type: 'addRules' | 'replaceRules' | 'removeRules';
      rules: { toolName: string; ruleContent?: string }[];
      behavior: 'allow' | 'deny' | 'ask';
      destination: PermissionUpdateDestination;
    }
  | { type: 'setMode'; mode: PermissionMode; destination: PermissionUpdateDestination }
  | { type: 'addDirectories' | 'removeDirectories'; directories: string[]; destination: PermissionUpdateDestination };

/**
 * Whether a machine's daemon can actually start sessions for a harness.
 * `unreadable-credentials` is macOS's own failure: Claude Code keeps its
 * credentials in the login keychain, and a daemon outside the GUI session is
 * refused the secret (`errSecInteractionNotAllowed`). Generalized: every
 * harness reports its own auth word through the same three states.
 */
export type AuthState = 'authenticated' | 'unauthenticated' | 'unreadable-credentials';

/** A parked permission's answer. `remember` is opencode's "always". */
export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: unknown;
      updatedPermissions?: PermissionUpdate[];
      remember?: boolean;
      toolUseID?: string;
    }
  | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string };

/** One question of an `AskUserQuestion`-shaped prompt, as every harness can express. */
export interface UserQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

/** The reader's choices, back the way the tool reads them. */
export type UserAnswers = Record<string, string | string[]>;

/* ------------------------------------------------------------- sessions — */

/** A stored session as the catalog lists it. `harness` says who owns the id. */
export interface NeutralSessionInfo {
  sessionId: string;
  harness: HarnessKind;
  summary?: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
}

/** Kept name for one release: the dashboard imported this from the SDK re-export. */
export type SDKSessionInfo = NeutralSessionInfo;

/** A stored transcript entry. `message` is the {@link NeutralMessage} the turn wrote. */
export interface SessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
  parent_agent_id: string | null;
}

/**
 * One task of a session's plan, as every harness can express. Claude Code keeps
 * a ledger file per task; opencode has a native `todo` list; pi has neither.
 * The dashboard renders this one shape regardless of which answered.
 */
export interface NeutralTask {
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  blocks: string[];
  blockedBy: string[];
}

/* ------------------------------------------------------ neutral messages — */

export type NeutralContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking' }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean; structuredContent?: Record<string, unknown> }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export type NeutralAssistantBlock = Extract<
  NeutralContentBlock,
  { type: 'text' | 'thinking' | 'redacted_thinking' | 'tool_use' }
>;

export type NeutralOrigin =
  | { kind: 'human' }
  | { kind: 'peer'; from?: string; name?: string; fromSession?: string; body?: string };

export interface NeutralAssistantMessage {
  type: 'assistant';
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message: { model?: string; content: NeutralAssistantBlock[] };
  /** The harness's own event, verbatim, for renderers that need more than this. */
  raw?: unknown;
}

export interface NeutralUserMessage {
  type: 'user';
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message: { role: 'user'; content: string | NeutralContentBlock[] };
  origin?: NeutralOrigin;
  shouldQuery?: boolean;
  raw?: unknown;
}

export interface NeutralStreamMessage {
  type: 'stream_event';
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  event:
    | { type: 'content_block_start'; content_block: { type: 'thinking'; thinking: string } }
    | { type: 'content_block_delta'; delta: { type: 'text_delta'; text: string } }
    | { type: 'content_block_delta'; delta: { type: 'thinking_delta'; thinking: string } }
    | { type: 'content_block_stop' }
    | { type: 'message_stop' };
  raw?: unknown;
}

export interface NeutralResultMessage {
  type: 'result';
  uuid?: string;
  session_id?: string;
  subtype: string;
  is_error: boolean;
  errors?: string[];
  total_cost_usd?: number;
  num_turns?: number;
  result?: string;
  stop_reason?: string | null;
  raw?: unknown;
}

/**
 * A `system` frame. One loose interface rather than a subtype union: the folding
 * layer switches on `subtype` and reads the fields each subtype carries, and a
 * harness that emits a subtype nothing here names degrades to a generic line.
 */
export interface NeutralSystemMessage {
  type: 'system';
  uuid?: string;
  session_id?: string;
  subtype: string;
  // init
  model?: string;
  permissionMode?: PermissionMode;
  cwd?: string;
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
  slash_commands?: string[];
  skills?: string[];
  // status — the session's own word (`compacting`/`requesting`/null), and the
  // task-notification status (`completed`/`failed`/`stopped`), which the SDK
  // also names `status`. Kept as one loose field; the folder reads it per subtype.
  status?: NeutralStatus | string;
  compact_result?: 'success' | 'failed';
  compact_error?: string;
  // compact_boundary
  compact_metadata?: { trigger?: 'manual' | 'auto'; pre_tokens?: number };
  // hook_response
  hook_name?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  // task_started / task_progress / task_notification / task_updated
  tool_use_id?: string;
  task_id?: string;
  subagent_type?: string;
  description?: string;
  summary?: string;
  last_tool_name?: string;
  patch?: { description?: string; status?: string; error?: string };
  // commands_changed
  commands?: SlashCommand[];
  // model_fallback
  content?: string;
  fallback_model?: string;
  raw?: unknown;
}

/** A frame that has no neutral meaning yet, forwarded whole for a future renderer. */
export interface NeutralRawMessage {
  type: 'raw';
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  harness: HarnessKind;
  message: unknown;
}

export type NeutralMessage =
  | NeutralAssistantMessage
  | NeutralUserMessage
  | NeutralStreamMessage
  | NeutralResultMessage
  | NeutralSystemMessage
  | NeutralRawMessage;

/* -------------------------------------------------------------- aliases — */
/*
 * One-release aliases. The dashboard imported these names from the SDK's
 * re-export; they are now the neutral types above and mean the same shapes, so
 * the folding layer's imports did not all have to move at once. The `SDK`
 * prefix will go in the coordinated rename.
 */
export type SDKMessage = NeutralMessage;
export type SDKAssistantMessage = NeutralAssistantMessage;
export type SDKUserMessage = NeutralUserMessage;
export type SDKSystemMessage = NeutralSystemMessage;
export type SDKResultMessage = NeutralResultMessage;
export type SDKCompactBoundaryMessage = NeutralSystemMessage;
export type SDKHookResponseMessage = NeutralSystemMessage;
export type SDKStatus = NeutralStatus;

/* ---------------------------------------------------------- capabilities — */

/** What a harness can do, so the dashboard gates features instead of guessing. */
export interface HarnessCapabilities {
  interrupt: boolean;
  permissionModes: PermissionMode[];
  setModel: boolean;
  contextUsage: boolean;
  supportedModels: boolean;
  supportedCommands: boolean;
  mcpStatus: boolean;
  mcpControl: boolean;
  listSessions: boolean;
  getSessionMessages: boolean;
  renameSession: boolean;
  deleteSession: boolean;
  /** Fork a stored session into a new one. */
  fork: boolean;
  /** Rewind / resume-at-message. */
  rewind: boolean;
  /** The scratch-tag the catalog filter reads. */
  tagSession: boolean;
  skills: boolean;
  subagents: boolean;
  tasks: boolean;
  compaction: boolean;
  costUsd: boolean;
  thinking: boolean;
  images: boolean;
  /** Peer-to-peer hand-off tools (`mcp__outpost__*` for claude). */
  handoff: boolean;
  hooks: boolean;
  plugins: boolean;
  /** The harness applies the hub's fleet config (MCP/skills/memory/agents) to its own files. */
  fleet: boolean;
}

/** What a machine knows about one harness: is it installed, can it work, what can it do. */
export interface HarnessReport {
  harness: HarnessKind;
  installed: boolean;
  /** The CLI/SDK version, when it can be read. */
  version?: string;
  auth: AuthState;
  capabilities: HarnessCapabilities;
}

/** The default for a harness adapter that reports nothing; adapters override. */
export const CAPABILITIES_NONE: HarnessCapabilities = {
  interrupt: false,
  permissionModes: [],
  setModel: false,
  contextUsage: false,
  supportedModels: false,
  supportedCommands: false,
  mcpStatus: false,
  mcpControl: false,
  listSessions: false,
  getSessionMessages: false,
  renameSession: false,
  deleteSession: false,
  fork: false,
  rewind: false,
  tagSession: false,
  skills: false,
  subagents: false,
  tasks: false,
  compaction: false,
  costUsd: false,
  thinking: false,
  images: false,
  handoff: false,
  hooks: false,
  plugins: false,
  fleet: false,
};

/**
 * The neutral names the `control` verb understands for a *live session*.
 * Identical to Claude Code's `Query` methods, so the claude adapter passes them
 * through unchanged; the opencode and pi adapters map them onto their own
 * surfaces. The dashboard calls these by name, never the harness's own words.
 */
export const CONTROL_INTERRUPT = 'interrupt';
export const CONTROL_SET_PERMISSION_MODE = 'setPermissionMode';
export const CONTROL_SET_MODEL = 'setModel';
export const CONTROL_CONTEXT_USAGE = 'getContextUsage';
export const CONTROL_SUPPORTED_MODELS = 'supportedModels';
export const CONTROL_SUPPORTED_COMMANDS = 'supportedCommands';
export const CONTROL_MCP_STATUS = 'mcpServerStatus';
export const CONTROL_MCP_RECONNECT = 'reconnectMcpServer';
export const CONTROL_MCP_TOGGLE = 'toggleMcpServer';

/** Machine-scoped session-catalog controls, answered by whichever harness owns the id. */
export const CONTROL_LIST_SESSIONS = 'listSessions';
export const CONTROL_GET_SESSION_INFO = 'getSessionInfo';
export const CONTROL_GET_SESSION_MESSAGES = 'getSessionMessages';
export const CONTROL_RENAME_SESSION = 'renameSession';
export const CONTROL_TAG_SESSION = 'tagSession';
export const CONTROL_DELETE_SESSION = 'deleteSession';

/** A session's plan, answered by whichever harness owns it (`NeutralTask[]`). */
export const CONTROL_GET_TODOS = 'getTodos';

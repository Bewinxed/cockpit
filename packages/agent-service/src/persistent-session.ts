/**
 * PersistentSession - A V2-style session wrapper using V1 query() API with full options.
 *
 * The V2 API (unstable_v2_createSession) has hardcoded options in SDK 0.1.76.
 * This wrapper provides the same send/receive pattern but with full option support.
 */

import {
  query,
  type SDKUserMessage,
  type PermissionUpdate,
  type PermissionResult,
  type CanUseTool,
  type PermissionBehavior,
  type PermissionRuleValue,
  type RewindFilesResult,
} from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode } from '@agentdeck/core';

/** Message type from Claude Code SDK */
type SDKMessage = Awaited<ReturnType<typeof query>> extends AsyncIterable<infer T> ? T : never;

// Extract CanUseToolOptions from the CanUseTool callback's third parameter
export type CanUseToolOptions = Parameters<CanUseTool>[2];

// Re-export SDK types for consumers
export type { PermissionUpdate, PermissionResult, CanUseTool, PermissionBehavior, PermissionRuleValue, RewindFilesResult };

/**
 * Internal stream class that stays open until done() is called.
 * This mimics the SDK's internal Stream class.
 */
class InputStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private resolver: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private isDone = false;

  /**
   * Enqueue a message. If consumer is waiting, resolves immediately.
   */
  enqueue(msg: SDKUserMessage): void {
    console.log(`[InputStream] enqueue() called, isDone=${this.isDone}, hasResolver=${!!this.resolver}, queueLen=${this.queue.length}`);
    if (this.isDone) {
      throw new Error('Cannot enqueue to closed stream');
    }
    if (this.resolver) {
      console.log(`[InputStream] Resolving waiting consumer immediately`);
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ done: false, value: msg });
    } else {
      console.log(`[InputStream] No consumer waiting, queuing message`);
      this.queue.push(msg);
    }
  }

  /**
   * Signal the stream is done. Consumer will receive done=true.
   */
  done(): void {
    this.isDone = true;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return { done: false, value: this.queue.shift()! };
        }
        if (this.isDone) {
          return { done: true, value: undefined };
        }
        return new Promise((resolve) => {
          this.resolver = resolve;
        });
      },
    };
  }
}

/** Setting source for loading filesystem-based settings */
export type SettingSource = 'user' | 'project' | 'local';

export interface PersistentSessionOptions {
  /** Model to use */
  model?: string;
  /** Working directory */
  cwd: string;
  /** Permission mode */
  permissionMode?: PermissionMode;
  /**
   * Must be set to true when using permissionMode: 'bypassPermissions'.
   * This is a safety measure to ensure intentional bypassing of permissions.
   */
  allowDangerouslySkipPermissions?: boolean;
  /** Allowed tools */
  allowedTools?: string[];
  /** Disallowed tools */
  disallowedTools?: string[];
  /** MCP servers config */
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  /** Resume a previous session */
  resume?: string;
  /**
   * When resuming, only resume messages up to and including the message with this UUID.
   * Use with `resume`. This allows you to fork from a specific point in the conversation.
   * The message ID should be from SDKAssistantMessage.uuid.
   */
  resumeSessionAt?: string;
  /**
   * When resuming, fork to a new session ID rather than continuing the previous session.
   */
  forkSession?: boolean;
  /** Max thinking tokens */
  maxThinkingTokens?: number;
  /** Max turns */
  maxTurns?: number;
  /** Max budget in USD */
  maxBudgetUsd?: number;
  /** Abort controller */
  abortController?: AbortController;
  /** Environment variables */
  env?: Record<string, string>;
  /** System prompt */
  systemPrompt?: string;
  /** Include partial messages */
  includePartialMessages?: boolean;
  /**
   * Control which filesystem settings to load.
   * - 'user' - Global user settings (~/.claude/settings.json)
   * - 'project' - Project settings (.claude/settings.json)
   * - 'local' - Local settings (.claude/settings.local.json)
   *
   * When omitted or empty, no filesystem settings are loaded (SDK isolation mode).
   * Must include 'project' to load CLAUDE.md files.
   */
  settingSources?: SettingSource[];
  /**
   * Custom permission handler for controlling tool usage.
   * Called before each tool execution to determine if it should be allowed or denied.
   * If not provided and permissionMode is 'default', SDK will use its default behavior.
   */
  canUseTool?: CanUseTool;
  /**
   * Enable file checkpointing to track file changes during the session.
   * When enabled, files can be rewound to their state at any user message
   * using `rewindFiles()`.
   */
  enableFileCheckpointing?: boolean;
  /**
   * Callback for stderr output from the Claude Code child process.
   * Useful for debugging crashes and capturing error output.
   */
  stderr?: (data: string) => void;
}

/**
 * A persistent session that stays alive for multiple send/receive cycles.
 * Uses V1 query() API with AsyncIterable input for full option support.
 */
export class PersistentSession {
  private inputStream: InputStream;
  private queryInstance: ReturnType<typeof query>;
  private queryIterator: AsyncIterator<SDKMessage> | null = null;
  private _sessionId: string | null = null;
  private _closed = false;
  private abortController: AbortController;

  constructor(options: PersistentSessionOptions) {
    this.inputStream = new InputStream();
    this.abortController = options.abortController || new AbortController();

    // Create query with full options - this starts streamInput in background
    this.queryInstance = query({
      prompt: this.inputStream, // AsyncIterable keeps session alive!
      options: {
        cwd: options.cwd,
        model: options.model,
        permissionMode: options.permissionMode || 'default',
        allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
        canUseTool: options.canUseTool,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        mcpServers: options.mcpServers,
        resume: options.resume,
        resumeSessionAt: options.resumeSessionAt,
        forkSession: options.forkSession,
        maxThinkingTokens: options.maxThinkingTokens,
        maxTurns: options.maxTurns,
        maxBudgetUsd: options.maxBudgetUsd,
        abortController: this.abortController,
        env: options.env,
        systemPrompt: options.systemPrompt,
        includePartialMessages: options.includePartialMessages,
        // Enable loading of CLAUDE.md files from project and user settings
        settingSources: options.settingSources,
        // Enable file checkpointing for rewind functionality
        enableFileCheckpointing: options.enableFileCheckpointing,
        // Capture stderr from the Claude Code child process
        stderr: options.stderr,
      },
    });
  }

  /**
   * Session ID - available after receiving first message with init.
   */
  get sessionId(): string {
    if (!this._sessionId) {
      throw new Error('Session ID not available until after receiving messages');
    }
    return this._sessionId;
  }

  /**
   * Check if session ID is available
   */
  get hasSessionId(): boolean {
    return this._sessionId !== null;
  }

  /**
   * Check if session is closed
   */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Send a message to Claude.
   */
  async send(message: string | SDKUserMessage): Promise<void> {
    console.log(`[PersistentSession] send() called, closed=${this._closed}`);
    if (this._closed) {
      throw new Error('Cannot send to closed session');
    }

    const userMessage: SDKUserMessage =
      typeof message === 'string'
        ? {
            type: 'user',
            session_id: this._sessionId || '',
            message: {
              role: 'user',
              content: [{ type: 'text', text: message }],
            },
            parent_tool_use_id: null,
          }
        : message;

    this.inputStream.enqueue(userMessage);
  }

  /**
   * Receive messages from Claude until a result message.
   * Can be called multiple times after each send().
   */
  async *receive(): AsyncGenerator<SDKMessage, void> {
    console.log(`[PersistentSession] receive() called, closed=${this._closed}`);
    if (this._closed) {
      throw new Error('Cannot receive from closed session');
    }

    if (!this.queryIterator) {
      console.log(`[PersistentSession] Creating new query iterator`);
      this.queryIterator = this.queryInstance[Symbol.asyncIterator]();
    }

    while (true) {
      console.log(`[PersistentSession] Waiting for next message from iterator...`);
      const { value, done } = await this.queryIterator.next();
      console.log(`[PersistentSession] Got message: done=${done}, type=${value?.type}`);

      if (done) {
        return;
      }

      // Capture session ID from init message
      if (value.type === 'system' && value.subtype === 'init' && value.session_id) {
        this._sessionId = value.session_id;
      }

      yield value;

      // Return after result message (turn complete)
      if (value.type === 'result') {
        return;
      }
    }
  }

  /**
   * Close the session. Signals the input stream is done and aborts.
   */
  close(): void {
    console.log(`[PersistentSession] close() called, already closed=${this._closed}`);
    if (this._closed) {
      return;
    }
    this._closed = true;
    this.inputStream.done();
    this.abortController.abort();
  }

  /**
   * Get the list of available models from the SDK.
   */
  async supportedModels(): Promise<Array<{ value: string; displayName: string; description: string }>> {
    if (this._closed) {
      throw new Error('Cannot get models from closed session');
    }
    return this.queryInstance.supportedModels();
  }

  /**
   * Set the model for subsequent responses.
   */
  async setModel(model?: string): Promise<void> {
    if (this._closed) {
      throw new Error('Cannot set model on closed session');
    }
    return this.queryInstance.setModel(model);
  }

  /**
   * Rewind tracked files to their state at a specific user message.
   * Requires file checkpointing to be enabled via the `enableFileCheckpointing` option.
   *
   * @param userMessageId - UUID of the user message to rewind to
   */
  async rewindFiles(userMessageId: string): Promise<RewindFilesResult> {
    if (this._closed) {
      throw new Error('Cannot rewind on closed session');
    }
    return this.queryInstance.rewindFiles(userMessageId);
  }

  /**
   * Set the maximum thinking tokens for the session.
   * Use 0 to disable thinking, null to reset to default.
   */
  async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
    if (this._closed) {
      throw new Error('Cannot set thinking tokens on closed session');
    }
    return this.queryInstance.setMaxThinkingTokens(maxThinkingTokens);
  }

  /**
   * Interrupt the current query execution.
   */
  async interrupt(): Promise<void> {
    if (this._closed) {
      throw new Error('Cannot interrupt closed session');
    }
    return this.queryInstance.interrupt();
  }

  /**
   * Async disposal support
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }
}

/**
 * Create a new persistent session with full options support.
 */
export function createPersistentSession(options: PersistentSessionOptions): PersistentSession {
  return new PersistentSession(options);
}

/**
 * Resume a previous session.
 */
export function resumePersistentSession(
  sessionId: string,
  options: Omit<PersistentSessionOptions, 'resume'>
): PersistentSession {
  return new PersistentSession({
    ...options,
    resume: sessionId,
  });
}

export type { SDKMessage };

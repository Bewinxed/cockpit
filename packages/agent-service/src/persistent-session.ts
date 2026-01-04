/**
 * PersistentSession - A V2-style session wrapper using V1 query() API with full options.
 *
 * The V2 API (unstable_v2_createSession) has hardcoded options in SDK 0.1.76.
 * This wrapper provides the same send/receive pattern but with full option support.
 */

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode } from '@cockpit/core';

/** Message type from Claude Code SDK */
type SDKMessage = Awaited<ReturnType<typeof query>> extends AsyncIterable<infer T> ? T : never;

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

export interface PersistentSessionOptions {
  /** Model to use */
  model?: string;
  /** Working directory */
  cwd: string;
  /** Permission mode */
  permissionMode?: PermissionMode;
  /** Allowed tools */
  allowedTools?: string[];
  /** Disallowed tools */
  disallowedTools?: string[];
  /** MCP servers config */
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  /** Resume a previous session */
  resume?: string;
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
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        mcpServers: options.mcpServers,
        resume: options.resume,
        maxThinkingTokens: options.maxThinkingTokens,
        maxTurns: options.maxTurns,
        maxBudgetUsd: options.maxBudgetUsd,
        abortController: this.abortController,
        env: options.env,
        systemPrompt: options.systemPrompt,
        includePartialMessages: options.includePartialMessages,
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

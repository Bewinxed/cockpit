import { query } from '@anthropic-ai/claude-code';
import { EventEmitter } from 'events';
import { generateId } from '@cockpit/core';

/** Message type from Claude Code SDK */
type SDKMessage = Awaited<ReturnType<typeof query>> extends AsyncIterable<infer T> ? T : never;
import type {
  Instance,
  InstanceStatus,
  SpawnInstanceData,
  PermissionMode,
} from '@cockpit/core';

/**
 * Internal representation of a managed Claude Code instance
 */
interface ManagedInstance {
  instanceId: string;
  sessionId: string;
  projectPath: string;
  state: InstanceStatus;
  conversationHistory: ConversationMessage[];
  createdAt: Date;
  lastActivityAt: Date;
  abortController?: AbortController;
  error?: string;
  model?: string;
  permissionMode?: PermissionMode;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UserMessage {
  content: string;
  resolve: (value: void) => void;
  reject: (reason: unknown) => void;
}

export interface SpawnInstanceParams {
  projectPath: string;
  /** Instance ID from hub - use this if provided to keep hub and agent in sync */
  instanceId?: string;
  sessionId?: string;
  systemPrompt?: string;
  permissionMode?: PermissionMode;
  mcpServers?: McpServerConfig[];
  model?: string;
  maxTokens?: number;
  initialPrompt?: string;
  envVars?: Record<string, string>;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface InstanceManagerEvents {
  'instance.started': (instanceId: string, sessionId: string) => void;
  'instance.message': (instanceId: string, message: SDKMessage) => void;
  'instance.stopped': (instanceId: string) => void;
  'instance.error': (instanceId: string, error: Error) => void;
  'sdk.message': (instanceId: string, message: SDKMessage) => void;
}

/**
 * Manages Claude Code instances using the Claude Agent SDK
 */
export class InstanceManager extends EventEmitter {
  private instances: Map<string, ManagedInstance> = new Map();
  private inputQueues: Map<string, UserMessage[]> = new Map();
  private processing: Map<string, boolean> = new Map();

  constructor() {
    super();
  }

  /**
   * Spawn a new Claude Code instance
   */
  async spawn(params: SpawnInstanceParams): Promise<string> {
    // Use provided instanceId from hub, or generate a new one
    const instanceId = params.instanceId || generateId();
    const sessionId = params.sessionId || generateId();

    const instance: ManagedInstance = {
      instanceId,
      sessionId,
      projectPath: params.projectPath,
      state: 'starting',
      conversationHistory: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
      abortController: new AbortController(),
      model: params.model,
      permissionMode: params.permissionMode,
    };

    this.instances.set(instanceId, instance);
    this.inputQueues.set(instanceId, []);
    this.processing.set(instanceId, false);

    // Start processing loop
    this.startProcessingLoop(instanceId, params);

    // If there's an initial prompt, queue it
    if (params.initialPrompt) {
      await this.sendMessage(instanceId, params.initialPrompt);
    }

    return instanceId;
  }

  /**
   * Start the processing loop for an instance
   */
  private async startProcessingLoop(
    instanceId: string,
    params: SpawnInstanceParams
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    try {
      // Mark as running
      instance.state = 'running';
      this.emit('instance.started', instanceId, instance.sessionId);

      // Process messages in a loop
      while (instance.state === 'running' || instance.state === 'starting') {
        const queue = this.inputQueues.get(instanceId);
        if (!queue || queue.length === 0) {
          // No messages to process, wait a bit
          await this.sleep(100);
          continue;
        }

        // Get next message
        const userMessage = queue.shift()!;
        this.processing.set(instanceId, true);

        try {
          // Add to conversation history
          instance.conversationHistory.push({
            role: 'user',
            content: userMessage.content,
            timestamp: new Date(),
          });

          // Build conversation for SDK
          const conversation = instance.conversationHistory.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          }));

          // Prepare MCP servers config
          const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
          if (params.mcpServers) {
            for (const server of params.mcpServers) {
              mcpServers[server.name] = {
                command: server.command,
                args: server.args,
                env: server.env,
              };
            }
          }

          // Call the Claude Code SDK
          // Note: Cast options to allow systemPrompt which may not be in SDK types
          const result = query({
            prompt: userMessage.content,
            options: {
              cwd: params.projectPath,
              permissionMode: params.permissionMode || 'default',
              model: params.model,
              maxTokens: params.maxTokens,
              mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
              abortController: instance.abortController,
            } as Parameters<typeof query>[0]['options'],
          });

          // Stream messages
          let assistantContent = '';
          for await (const message of result) {
            instance.lastActivityAt = new Date();

            // Emit SDK message event for forwarding to hub
            this.emit('sdk.message', instanceId, message);
            this.emit('instance.message', instanceId, message);

            // Collect assistant text content
            if (message.type === 'assistant' && message.message?.content) {
              for (const block of message.message.content) {
                if (block.type === 'text') {
                  assistantContent += block.text;
                }
              }
            }
          }

          // Add assistant response to history
          if (assistantContent) {
            instance.conversationHistory.push({
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date(),
            });
          }

          userMessage.resolve();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          userMessage.reject(err);
          this.emit('instance.error', instanceId, err);
        } finally {
          this.processing.set(instanceId, false);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      instance.state = 'error';
      instance.error = err.message;
      this.emit('instance.error', instanceId, err);
    }
  }

  /**
   * Send a message to an instance
   */
  async sendMessage(instanceId: string, content: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    if (instance.state !== 'running' && instance.state !== 'starting') {
      throw new Error(`Instance ${instanceId} is not running (state: ${instance.state})`);
    }

    const queue = this.inputQueues.get(instanceId);
    if (!queue) {
      throw new Error(`No input queue for instance ${instanceId}`);
    }

    return new Promise((resolve, reject) => {
      queue.push({ content, resolve, reject });
    });
  }

  /**
   * Stop an instance
   */
  async stop(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    instance.state = 'stopping';

    // Abort any ongoing operations
    if (instance.abortController) {
      instance.abortController.abort();
    }

    // Reject any pending messages
    const queue = this.inputQueues.get(instanceId);
    if (queue) {
      for (const msg of queue) {
        msg.reject(new Error('Instance stopped'));
      }
      queue.length = 0;
    }

    instance.state = 'stopped';
    this.emit('instance.stopped', instanceId);
  }

  /**
   * Get status of an instance
   */
  getStatus(instanceId: string): InstanceStatusInfo | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;

    return {
      instanceId: instance.instanceId,
      sessionId: instance.sessionId,
      state: instance.state,
      projectPath: instance.projectPath,
      createdAt: instance.createdAt,
      lastActivityAt: instance.lastActivityAt,
      error: instance.error,
      messageCount: instance.conversationHistory.length,
      isProcessing: this.processing.get(instanceId) || false,
    };
  }

  /**
   * List all instances
   */
  listInstances(): InstanceStatusInfo[] {
    const statuses: InstanceStatusInfo[] = [];
    for (const instanceId of this.instances.keys()) {
      const status = this.getStatus(instanceId);
      if (status) {
        statuses.push(status);
      }
    }
    return statuses;
  }

  /**
   * Get conversation history for an instance
   */
  getConversationHistory(instanceId: string): ConversationMessage[] | undefined {
    const instance = this.instances.get(instanceId);
    return instance?.conversationHistory;
  }

  /**
   * Remove a stopped instance from memory
   */
  cleanup(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    if (instance.state !== 'stopped' && instance.state !== 'error') {
      return false;
    }

    this.instances.delete(instanceId);
    this.inputQueues.delete(instanceId);
    this.processing.delete(instanceId);
    return true;
  }

  /**
   * Stop all instances
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const instanceId of this.instances.keys()) {
      const instance = this.instances.get(instanceId);
      if (instance && instance.state !== 'stopped' && instance.state !== 'stopping') {
        stopPromises.push(this.stop(instanceId));
      }
    }
    await Promise.allSettled(stopPromises);
  }

  /**
   * Helper to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface InstanceStatusInfo {
  instanceId: string;
  sessionId: string;
  state: InstanceStatus;
  projectPath: string;
  createdAt: Date;
  lastActivityAt: Date;
  error?: string;
  messageCount: number;
  isProcessing: boolean;
}

export default InstanceManager;

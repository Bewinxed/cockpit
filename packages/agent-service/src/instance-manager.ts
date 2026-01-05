import { EventEmitter } from 'events';
import { generateId } from '@cockpit/core';
import {
  PersistentSession,
  createPersistentSession,
  resumePersistentSession,
  type SDKMessage,
} from './persistent-session';

import type { InstanceStatus, PermissionMode } from '@cockpit/core';

/**
 * Internal representation of a managed Claude Code instance
 */
interface ManagedInstance {
  instanceId: string;
  sessionId: string;
  /** SDK's session ID - captured from first message, used for resume */
  sdkSessionId?: string;
  projectPath: string;
  state: InstanceStatus;
  conversationHistory: ConversationMessage[];
  createdAt: Date;
  lastActivityAt: Date;
  /** The persistent session - stays alive for multi-turn */
  session?: PersistentSession;
  error?: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** Idle timeout timer */
  idleTimer?: ReturnType<typeof setTimeout>;
  /**
   * The last emitted session_id from a system init message.
   * Used to dedupe repeated init messages while allowing new ones on session change.
   */
  lastEmittedInitSessionId?: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface SpawnInstanceParams {
  projectPath: string;
  /** Instance ID from hub - use this if provided to keep hub and agent in sync */
  instanceId?: string;
  sessionId?: string;
  /** Claude SDK session ID to resume a previous conversation */
  resumeSessionId?: string;
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
  'instance.stopped': (instanceId: string) => void;
  'instance.sleeping': (instanceId: string, sdkSessionId?: string) => void;
  'instance.error': (instanceId: string, error: Error) => void;
  'sdk.message': (instanceId: string, message: SDKMessage) => void;
}

/** Idle timeout in milliseconds (60 minutes) */
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Manages Claude Code instances using persistent sessions.
 * Each instance stays alive for multiple send/receive cycles until stopped or idle timeout.
 */
export class InstanceManager extends EventEmitter {
  private instances: Map<string, ManagedInstance> = new Map();

  constructor() {
    super();
  }

  /**
   * Spawn a new Claude Code instance with a persistent session.
   * The instance stays alive until explicitly stopped or idle timeout.
   */
  async spawn(params: SpawnInstanceParams): Promise<string> {
    const instanceId = params.instanceId || generateId();
    const sessionId = params.sessionId || generateId();

    const instance: ManagedInstance = {
      instanceId,
      sessionId,
      sdkSessionId: params.resumeSessionId,
      projectPath: params.projectPath,
      state: 'starting',
      conversationHistory: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
      model: params.model,
      permissionMode: params.permissionMode,
    };

    this.instances.set(instanceId, instance);

    try {
      // Prepare MCP servers config
      const mcpServers: Record<
        string,
        { command: string; args?: string[]; env?: Record<string, string> }
      > = {};
      if (params.mcpServers) {
        for (const server of params.mcpServers) {
          mcpServers[server.name] = {
            command: server.command,
            args: server.args,
            env: server.env,
          };
        }
      }

      // Create the persistent session - uses V1 query() with full options
      const session = params.resumeSessionId
        ? resumePersistentSession(params.resumeSessionId, {
            cwd: params.projectPath,
            model: params.model,
            permissionMode: params.permissionMode || 'default',
            mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
            env: params.envVars,
            systemPrompt: params.systemPrompt,
          })
        : createPersistentSession({
            cwd: params.projectPath,
            model: params.model,
            permissionMode: params.permissionMode || 'default',
            mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
            env: params.envVars,
            systemPrompt: params.systemPrompt,
          });

      instance.session = session;
      instance.state = 'running';

      // Start idle timeout
      this.resetIdleTimer(instanceId);

      this.emit('instance.started', instanceId, instance.sessionId);

      // If there's an initial prompt, send it
      if (params.initialPrompt) {
        this.sendMessage(instanceId, params.initialPrompt).catch((err) => {
          console.error(`[InstanceManager] Initial prompt failed for ${instanceId}:`, err);
        });
      }

      return instanceId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      instance.state = 'error';
      instance.error = err.message;
      this.emit('instance.error', instanceId, err);
      throw err;
    }
  }

  /**
   * Send a message to an instance and stream responses.
   * This is the key method for multi-turn conversations.
   */
  async sendMessage(instanceId: string, content: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    if (!instance.session) {
      throw new Error(`Instance ${instanceId} has no session`);
    }

    // If sleeping, we need to wake it up (handled by hub calling spawn with resumeSessionId)
    if (instance.state === 'sleeping') {
      throw new Error(`Instance ${instanceId} is sleeping - call spawn with resumeSessionId to wake`);
    }

    if (instance.state !== 'running' && instance.state !== 'starting') {
      throw new Error(`Instance ${instanceId} is not running (state: ${instance.state})`);
    }

    // Add to conversation history
    instance.conversationHistory.push({
      role: 'user',
      content,
      timestamp: new Date(),
    });

    instance.lastActivityAt = new Date();
    this.resetIdleTimer(instanceId);

    try {
      // Send the message
      await instance.session.send(content);

      // Receive responses until result
      let assistantContent = '';

      for await (const message of instance.session.receive()) {
        instance.lastActivityAt = new Date();
        this.resetIdleTimer(instanceId);

        // Handle system init messages specially - dedupe repeated inits
        if (
          message.type === 'system' &&
          message.subtype === 'init' &&
          'session_id' in message &&
          message.session_id
        ) {
          const initSessionId = message.session_id as string;

          // Always capture the SDK session ID for resume functionality
          instance.sdkSessionId = initSessionId;

          // Only emit init if it's a new session (first time or session changed)
          if (instance.lastEmittedInitSessionId === initSessionId) {
            // Skip duplicate init - same session, already emitted
            continue;
          }

          // New session - emit and track
          instance.lastEmittedInitSessionId = initSessionId;
        }

        // Emit SDK message event for forwarding to hub
        this.emit('sdk.message', instanceId, message);

        // Collect assistant text content
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              assistantContent += block.text;
            }
          }
        }

        // On result message, save assistant response
        if (message.type === 'result') {
          if (assistantContent) {
            instance.conversationHistory.push({
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date(),
            });
          }
          // Result received - turn complete, but session still alive!
          break;
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name !== 'AbortError') {
        instance.state = 'error';
        instance.error = err.message;
        this.emit('instance.error', instanceId, err);
      }
      throw err;
    }
  }

  /**
   * Reset the idle timer. After IDLE_TIMEOUT_MS of inactivity, the instance goes to sleep.
   */
  private resetIdleTimer(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    // Clear existing timer
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
    }

    // Set new timer
    instance.idleTimer = setTimeout(() => {
      this.sleep(instanceId);
    }, IDLE_TIMEOUT_MS);
  }

  /**
   * Put an instance to sleep due to idle timeout.
   * The SDK session ID is preserved for later resume.
   */
  private async sleep(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.state !== 'running') return;

    console.log(`[InstanceManager] Instance ${instanceId} going to sleep due to idle timeout`);

    // Close the session - this ends the query
    instance.session?.close();

    // Update state
    instance.state = 'sleeping' as InstanceStatus;
    this.emit('instance.sleeping', instanceId, instance.sdkSessionId);
  }

  /**
   * Interrupt an instance's current operation.
   * Unlike stop(), interrupt keeps the instance resumable.
   * Returns the SDK session ID for potential resume.
   */
  async interrupt(instanceId: string): Promise<string | undefined> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    if (instance.state !== 'running' && instance.state !== 'starting') {
      throw new Error(`Instance ${instanceId} is not running (state: ${instance.state})`);
    }

    console.log(`[InstanceManager] Interrupting instance ${instanceId}`);

    // Clear idle timer
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
    }

    // Close the session - this aborts the current operation
    instance.session?.close();

    // Mark as sleeping so it can be resumed
    instance.state = 'sleeping' as InstanceStatus;

    // Emit sleeping event with SDK session ID for resume
    this.emit('instance.sleeping', instanceId, instance.sdkSessionId);

    return instance.sdkSessionId;
  }

  /**
   * Stop an instance explicitly.
   */
  async stop(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    // Clear idle timer
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
    }

    instance.state = 'stopping';

    // Close the session
    instance.session?.close();

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
      sdkSessionId: instance.sdkSessionId,
      state: instance.state,
      projectPath: instance.projectPath,
      createdAt: instance.createdAt,
      lastActivityAt: instance.lastActivityAt,
      error: instance.error,
      messageCount: instance.conversationHistory.length,
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
   * Get the persistent session for an instance (for model operations etc)
   */
  getSession(instanceId: string): PersistentSession | undefined {
    const instance = this.instances.get(instanceId);
    return instance?.session;
  }

  /**
   * Get the current model for an instance
   */
  getModel(instanceId: string): string | undefined {
    const instance = this.instances.get(instanceId);
    return instance?.model;
  }

  /**
   * Set the model for an instance (tracking only, actual change via session.setModel)
   */
  setModel(instanceId: string, model: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.model = model;
    }
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

    // Clear idle timer
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
    }

    this.instances.delete(instanceId);
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
}

export interface InstanceStatusInfo {
  instanceId: string;
  sessionId: string;
  sdkSessionId?: string;
  state: InstanceStatus;
  projectPath: string;
  createdAt: Date;
  lastActivityAt: Date;
  error?: string;
  messageCount: number;
}

export default InstanceManager;

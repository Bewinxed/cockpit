import { SvelteMap } from 'svelte/reactivity';
import { parseBackgroundAgentOutput, toolUsesToMessages } from '$lib/utils/background-agent-parser';
import { mapApiMessages } from '$lib/utils/message-mapper';
import type { CanonicalMessage } from '@agentdeck/core/dashboard';
import type { Instance, Message, MessageMetadata, StreamingState, StreamingMessage, SubagentState } from './types';
import type {
  InstanceCreatedEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceSleepingEvent,
  InstanceErrorEvent,
  InstanceResumedEvent,
  InstanceTokenUsageEvent,
  InstanceModelChangedEvent,
  InstanceViewModeChangedEvent,
  InstanceThinkingChangedEvent,
  InstanceTurnEvent,
  MessageCreatedEvent,
  MessageStreamEvent,
  SdkMessageEvent,
} from '@agentdeck/core/dashboard';
import type {
  SDKAuthStatusMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Instance store - manages instances, messages, streaming, and subagents.
 * Uses SvelteMap for reactive mutations without reassignment.
 */
class InstanceStore {
  // Core instance data
  #instances = $state(new SvelteMap<string, Instance>());

  // Messages per instance
  #messages = $state(new SvelteMap<string, Message[]>());

  // Streaming state per instance (tokens, cost, isStreaming)
  #streamingStates = $state(new SvelteMap<string, StreamingState>());

  // Streaming message content (partial text being received)
  #streamingMessages = $state(new SvelteMap<string, StreamingMessage>());

  // Transient instance status (compacting, etc.)
  #statuses = $state(new SvelteMap<string, string | null>());

  // Last activity event per instance (from websocket)
  #activityEvents = $state(new SvelteMap<string, MessageCreatedEvent | MessageStreamEvent | SdkMessageEvent | InstanceTurnEvent>());

  // Track instances that are resuming (waiting for instance:started WebSocket)
  #resumingInstances = $state(new Set<string>());

  // ========================================
  // Instance Getters
  // ========================================

  get all() {
    return this.#instances;
  }

  get size() {
    return this.#instances.size;
  }

  /** Derived: running instances */
  readonly running = $derived(
    Array.from(this.#instances.values()).filter(
      i => i.status === 'running' || i.status === 'starting'
    )
  );

  /** Derived: recent instances sorted by activity */
  readonly recent = $derived(
    Array.from(this.#instances.values())
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
      .slice(0, 5)
  );

  /** Derived: ad-hoc instances (no project) */
  readonly adhoc = $derived(
    Array.from(this.#instances.values())
      .filter(i => !i.projectId)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  /** Derived: project instances */
  readonly withProject = $derived(
    Array.from(this.#instances.values())
      .filter(i => i.projectId)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  /** Derived: total cost across all instances */
  readonly totalCost = $derived(
    Array.from(this.#instances.values()).reduce((sum, i) => sum + (i.totalCostUsd || 0), 0)
  );

  // ========================================
  // Instance Mutations
  // ========================================

  set(id: string, instance: Instance): void {
    this.#instances.set(id, instance);
  }

  get(id: string): Instance | undefined {
    return this.#instances.get(id);
  }

  has(id: string): boolean {
    return this.#instances.has(id);
  }

  updateStatus(id: string, status: Instance['status']): void {
    const instance = this.#instances.get(id);
    if (instance) {
      this.#instances.set(id, { ...instance, status });
    }
  }

  update(id: string, updates: Partial<Instance>): void {
    const instance = this.#instances.get(id);
    if (instance) {
      this.#instances.set(id, { ...instance, ...updates });
    }
  }

  delete(id: string): boolean {
    // Clean up related data
    this.#messages.delete(id);
    this.#streamingStates.delete(id);
    this.#streamingMessages.delete(id);
    this.#statuses.delete(id);
    this.#resumingInstances.delete(id);
    return this.#instances.delete(id);
  }

  // ========================================
  // Resuming State (waiting for instance:started)
  // ========================================

  /**
   * Mark an instance as resuming (waiting for instance:started WebSocket event)
   */
  setResuming(id: string, isResuming: boolean): void {
    if (isResuming) {
      this.#resumingInstances.add(id);
    } else {
      this.#resumingInstances.delete(id);
    }
  }

  /**
   * Check if an instance is currently resuming
   */
  isResuming(id: string): boolean {
    return this.#resumingInstances.has(id);
  }

  clear(): void {
    this.#instances.clear();
    this.#messages.clear();
    this.#streamingStates.clear();
    this.#streamingMessages.clear();
    this.#statuses.clear();
    this.#resumingInstances.clear();
  }

  /** Initialize from SSR data */
  initializeFromSSR(instancesData: Array<{
    id: string;
    lastPrompt?: string;
    status: string;
    machineId: string;
    projectId?: string;
    createdAt?: string;
    cwd: string;
    model?: string;
    totalCostUsd?: number;
    viewMode?: 'flow' | 'chat';
  }>): void {
    this.#instances.clear();
    for (const i of instancesData) {
      this.#instances.set(i.id, {
        id: i.id,
        name: i.lastPrompt?.slice(0, 50) || 'Instance',
        status: i.status as Instance['status'],
        agent: '',
        machineId: i.machineId,
        project: null,
        projectId: i.projectId || null,
        lastActivity: i.createdAt ? new Date(i.createdAt).toISOString() : new Date().toISOString(),
        cwd: i.cwd,
        model: i.model,
        totalCostUsd: i.totalCostUsd,
        viewMode: i.viewMode ?? 'chat',
      });
    }
  }

  /** Initialize messages from SSR-preloaded data */
  initializeMessagesFromSSR(instanceId: string, messages: CanonicalMessage[]): void {
    // Skip if we already have messages for this instance
    if (this.#messages.has(instanceId) && this.#messages.get(instanceId)!.length > 0) {
      return;
    }

    if (!messages || messages.length === 0) {
      return;
    }

    const { parsed, toolResults } = mapApiMessages(instanceId, messages);

    // Set messages directly
    this.#messages.set(instanceId, parsed);

    // Apply any tool results that arrived before their tool.use message
    for (const [toolId, result] of toolResults) {
      this.updateToolResult(instanceId, toolId, result.result, result.status === 'error');
    }
  }

  // ========================================
  // Message Methods
  // ========================================

  /** Get messages for an instance */
  getMessages(instanceId: string): Message[] {
    // Access map size first to ensure reactive tracking on mutations
    void this.#messages.size;
    return this.#messages.get(instanceId) || [];
  }

  /** Get all messages (flattened, sorted by timestamp) */
  getAllMessages(): Message[] {
    return Array.from(this.#messages.values())
      .flat()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /** Add a message to an instance */
  addMessage(instanceId: string, message: Omit<Message, 'instanceId'>): void {
    const msgs = this.#messages.get(instanceId) || [];
    const msgWithId: Message = {
      ...message,
      instanceId,
      id: message.id || crypto.randomUUID(),
    };
    // Keep last 500 messages per instance
    const newMsgs = [...msgs, msgWithId].slice(-500);
    this.#messages.set(instanceId, newMsgs);
  }

  /** Remove a message by index */
  removeMessage(instanceId: string, index: number): void {
    const msgs = this.#messages.get(instanceId) || [];
    if (index >= 0 && index < msgs.length) {
      const newMsgs = [...msgs.slice(0, index), ...msgs.slice(index + 1)];
      this.#messages.set(instanceId, newMsgs);
    }
  }

  /** Update tool result by toolId */
  updateToolResult(instanceId: string, toolId: string, result: unknown, isError = false): void {
    const msgs = this.#messages.get(instanceId) || [];
    const updated = msgs.map(msg => {
      if (msg.type === 'tool.use' && msg.metadata?.toolId === toolId) {
        return {
          ...msg,
          metadata: {
            ...msg.metadata,
            toolResult: result,
            toolStatus: isError ? 'error' as const : 'success' as const,
          },
        };
      }
      return msg;
    });
    this.#messages.set(instanceId, updated);
  }

  /** Clear messages for an instance */
  clearMessages(instanceId: string): void {
    this.#messages.delete(instanceId);
  }

  /** Update question answers by requestId */
  updateQuestionAnswers(instanceId: string, requestId: string, answers: Record<string, string>): void {
    const msgs = this.#messages.get(instanceId) || [];
    const updated = msgs.map(msg => {
      if (msg.type === 'system.ask_question' && msg.metadata?.questionRequestId === requestId) {
        return {
          ...msg,
          metadata: {
            ...msg.metadata,
            questionAnswers: answers,
          },
        };
      }
      return msg;
    });
    this.#messages.set(instanceId, updated);
  }

  /** Update metadata on a message by index */
  updateMessageMetadata(instanceId: string, index: number, metadata: Record<string, unknown>): void {
    const messages = this.#messages.get(instanceId);
    if (messages && messages[index]) {
      const updatedMessages = [...messages];
      updatedMessages[index] = {
        ...messages[index],
        metadata: { ...messages[index].metadata, ...metadata },
      };
      this.#messages.set(instanceId, updatedMessages);
    }
  }

  /** Update metadata on a message by ID */
  updateMessageMetadataById(instanceId: string, messageId: string, metadata: Record<string, unknown>): void {
    const messages = this.#messages.get(instanceId);
    if (messages) {
      const index = messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        const updatedMessages = [...messages];
        updatedMessages[index] = {
          ...messages[index],
          metadata: { ...messages[index].metadata, ...metadata },
        };
        this.#messages.set(instanceId, updatedMessages);
      }
    }
  }

  /** Get a message by ID */
  getMessageById(instanceId: string, messageId: string): Message | undefined {
    return this.#messages.get(instanceId)?.find(m => m.id === messageId);
  }

  /** Update sdkUuid on a user message by matching content */
  updateUserMessageUuid(instanceId: string, content: string, sdkUuid: string): boolean {
    const messages = this.#messages.get(instanceId);
    if (!messages) return false;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'user' && msg.content === content && !msg.sdkUuid) {
        const updatedMessages = [...messages];
        updatedMessages[i] = { ...msg, sdkUuid };
        this.#messages.set(instanceId, updatedMessages);
        return true;
      }
    }
    return false;
  }

  // ========================================
  // Streaming State Methods
  // ========================================

  /** Get streaming state for an instance */
  getStreamingState(instanceId: string): StreamingState | null {
    // Access the map size first to ensure reactive tracking on mutations
    void this.#streamingStates.size;
    return this.#streamingStates.get(instanceId) || null;
  }

  /** Update streaming state */
  updateStreamingState(instanceId: string, update: Partial<StreamingState>): void {
    const existing = this.#streamingStates.get(instanceId) || {
      instanceId,
      isStreaming: false,
      isInitializing: false,
      lastChunkAt: undefined,
      inputTokens: 0,
      outputTokens: 0,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      costUsd: 0,
      lastUpdate: new Date(),
    };
    // When streaming starts, clear initializing state
    const newState = { ...existing, ...update, lastUpdate: new Date() };
    if (update.isStreaming) {
      newState.isInitializing = false;
    }
    console.log('[StreamingState]', instanceId.slice(0, 8), update, '→', { isStreaming: newState.isStreaming, isInitializing: newState.isInitializing });
    this.#streamingStates.set(instanceId, newState);
  }

  /** Clear streaming state */
  clearStreamingState(instanceId: string): void {
    this.#streamingStates.delete(instanceId);
  }

  // ========================================
  // Streaming Message Methods (progressive text)
  // ========================================

  /** Get streaming message for an instance */
  getStreamingMessage(instanceId: string): StreamingMessage | null {
    return this.#streamingMessages.get(instanceId) || null;
  }

  /** Get accumulated streaming text */
  getStreamingText(instanceId: string): string {
    const msg = this.#streamingMessages.get(instanceId);
    if (!msg) return '';
    const texts: string[] = [];
    const sortedIndices = Array.from(msg.contentBlocks.keys()).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      texts.push(msg.contentBlocks.get(idx) || '');
    }
    return texts.join('');
  }

  /** Initialize streaming message on content_block_start */
  initStreamingMessage(instanceId: string, sdkUuid?: string): void {
    if (!this.#streamingMessages.has(instanceId)) {
      this.#streamingMessages.set(instanceId, {
        instanceId,
        contentBlocks: new Map(),
        isComplete: false,
        sdkUuid,
        startedAt: new Date(),
      });
    } else if (sdkUuid) {
      const existing = this.#streamingMessages.get(instanceId)!;
      this.#streamingMessages.set(instanceId, { ...existing, sdkUuid });
    }
  }

  /** Initialize a content block */
  initStreamingBlock(instanceId: string, index: number, contentBlock: { type: string }): void {
    const msg = this.#streamingMessages.get(instanceId);
    if (msg && contentBlock.type === 'text') {
      msg.contentBlocks.set(index, '');
    }
  }

  /** Append text to a streaming content block */
  appendStreamingText(instanceId: string, index: number, text: string): void {
    const msg = this.#streamingMessages.get(instanceId);
    if (msg) {
      const existing = msg.contentBlocks.get(index) || '';
      msg.contentBlocks.set(index, existing + text);
      this.updateStreamingState(instanceId, { isStreaming: true, lastChunkAt: new Date() });
    }
  }

  /** Finalize a content block (content_block_stop) */
  finalizeStreamingBlock(_instanceId: string, _index: number): void {
    // Currently a no-op
  }

  /** Finalize streaming message (message_stop) - converts to final message */
  finalizeStreamingMessage(instanceId: string): void {
    const msg = this.#streamingMessages.get(instanceId);
    if (msg && msg.contentBlocks.size > 0) {
      const text = this.getStreamingText(instanceId);
      if (text.trim()) {
        this.addMessage(instanceId, {
          type: 'assistant',
          content: text,
          timestamp: msg.startedAt,
          sdkUuid: msg.sdkUuid,
        });
      }
    }
    this.clearStreamingMessage(instanceId);
  }

  /** Clear streaming message */
  clearStreamingMessage(instanceId: string): void {
    this.#streamingMessages.delete(instanceId);
  }

  // ========================================
  // Transient Status Methods
  // ========================================

  /** Set transient status (compacting, etc.) */
  setStatus(instanceId: string, status: string | null): void {
    if (status) {
      this.#statuses.set(instanceId, status);
    } else {
      this.#statuses.delete(instanceId);
    }
  }

  /** Get transient status */
  getStatus(instanceId: string): string | null {
    return this.#statuses.get(instanceId) || null;
  }

  /** Record last activity event */
  recordActivityEvent(
    event: MessageCreatedEvent | MessageStreamEvent | SdkMessageEvent | InstanceTurnEvent
  ): void {
    this.#activityEvents.set(event.instanceId, event);
  }

  /** Get last activity event */
  getActivityEvent(
    instanceId: string
  ): MessageCreatedEvent | MessageStreamEvent | SdkMessageEvent | InstanceTurnEvent | null {
    void this.#activityEvents.size;
    return this.#activityEvents.get(instanceId) || null;
  }

  // ========================================
  // Subagent Methods (Derived from Messages)
  // ========================================

  /**
   * Derive subagents from messages - single source of truth.
   * Subagents are Task tool.use messages. Status derived from toolStatus.
   * Messages with parentToolUseId are collected under their parent subagent.
   */
  getSubagentsForInstance(instanceId: string): SubagentState[] {
    const messages = this.getMessages(instanceId);
    return this.#deriveSubagentsFromMessages(instanceId, messages);
  }

  /** Get subagent by toolUseId (derived from messages) */
  getSubagent(toolUseId: string): SubagentState | null {
    // Find the message store to determine instanceId
    for (const [instanceId, msgs] of this.#messages) {
      const msg = msgs.find(
        m => m.type === 'tool.use' && m.metadata?.toolId === toolUseId && m.metadata?.toolName === 'Task'
      );
      if (msg) {
        const subagents = this.#deriveSubagentsFromMessages(instanceId, msgs);
        return subagents.find(s => s.toolUseId === toolUseId) || null;
      }
    }
    return null;
  }

  /** Get active (non-complete) subagents for an instance */
  getActiveSubagentsForInstance(instanceId: string): SubagentState[] {
    return this.getSubagentsForInstance(instanceId).filter(
      s => s.status === 'starting' || s.status === 'running'
    );
  }

  /** Get child subagents (nested) */
  getChildSubagents(parentToolUseId: string): SubagentState[] {
    // Need to find which instance this belongs to
    for (const [instanceId] of this.#messages) {
      const subagents = this.getSubagentsForInstance(instanceId);
      const children = subagents.filter(s => s.parentSubagentId === parentToolUseId);
      if (children.length > 0) return children;
    }
    return [];
  }

  #deriveSubagentsFromMessages(instanceId: string, messages: Message[]): SubagentState[] {
    const subagentMap = new Map<string, SubagentState>();

    for (const msg of messages) {
      // Find Task tool.use messages (subagent spawns)
      if (msg.type === 'tool.use' && msg.metadata?.toolName === 'Task') {
        const toolId = msg.metadata.toolId as string;
        if (!toolId) continue;

        const toolInput = msg.metadata.toolInput as Record<string, unknown> | undefined;
        const toolStatus = msg.metadata.toolStatus as string | undefined;
        const toolResult = msg.metadata.toolResult;

        const status = this.#deriveSubagentStatus(toolStatus);
        const isError = toolStatus === 'error';
        const isBackground = toolInput?.run_in_background === true;

        // For background agents, parse the result to extract tool uses
        let derivedMessages: Message[] = [];
        let resultText: string | undefined;

        if (isBackground && toolResult && !isError) {
          const rawResult = this.#extractResultText(toolResult);
          const parsed = parseBackgroundAgentOutput(rawResult);
          resultText = parsed.resultText;

          const toolMessages = toolUsesToMessages(parsed.toolUses, parsed.resultText);
          derivedMessages = toolMessages.map((m): Message => ({
            instanceId,
            type: m.type as Message['type'],
            content: m.content,
            timestamp: m.timestamp,
            parentToolUseId: toolId,
            metadata: m.type === 'tool.use' ? {
              toolName: m.toolName,
              toolInput: m.toolInput as MessageMetadata['toolInput'],
              toolStatus: 'success' as const,
            } : undefined,
          }));
        } else if (!isError && toolResult) {
          resultText = this.#extractResultText(toolResult);
        }

        subagentMap.set(toolId, {
          toolUseId: toolId,
          instanceId,
          subagentType: (msg.metadata.subagentType as string) || (toolInput?.subagent_type as string) || 'unknown',
          description: (msg.metadata.subagentDescription as string) || (toolInput?.description as string),
          status,
          startedAt: msg.timestamp,
          completedAt: status === 'complete' || status === 'error' ? msg.timestamp : undefined,
          parentSubagentId: msg.parentToolUseId || undefined,
          messages: derivedMessages,
          result: !isError ? resultText : undefined,
          error: isError ? this.#extractResultText(toolResult) : undefined,
          isBackground,
        });
      }

      // Collect messages belonging to subagents (non-background only)
      if (msg.parentToolUseId && subagentMap.has(msg.parentToolUseId)) {
        const subagent = subagentMap.get(msg.parentToolUseId)!;
        // Only add streamed messages for non-background agents
        if (!subagent.isBackground) {
          subagent.messages = [...subagent.messages, msg];
        }
      }
    }

    return Array.from(subagentMap.values());
  }

  #deriveSubagentStatus(toolStatus: string | undefined): SubagentState['status'] {
    if (!toolStatus || toolStatus === 'pending') return 'running';
    if (toolStatus === 'success') return 'complete';
    if (toolStatus === 'error') return 'error';
    return 'running';
  }

  #extractResultText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block: unknown) => {
          if (typeof block === 'string') return block;
          if (block && typeof block === 'object' && 'type' in block) {
            const b = block as { type: string; text?: string };
            if (b.type === 'text' && b.text) return b.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return JSON.stringify(content);
  }

  // ========================================
  // WebSocket Event Handlers
  // ========================================

  /** Handle instance:created WebSocket event */
  handleCreated(event: InstanceCreatedEvent): void {
    const createdAt = typeof event.createdAt === 'string' ? event.createdAt : event.createdAt.toISOString();
    this.#instances.set(event.id, {
      id: event.id,
      name: event.lastPrompt?.slice(0, 50) || 'Instance',
      status: event.status,
      agent: '',
      machineId: event.machineId,
      project: null,
      projectId: event.projectId || null,
      conversationId: event.conversationId ?? null,
      activeThreadId: event.activeThreadId ?? null,
      activeSpanId: event.activeSpanId ?? null,
      lastActivity: createdAt,
      cwd: event.cwd,
      model: event.model || undefined,
      totalCostUsd: 0,
      viewMode: event.viewMode || 'flow',
    });
  }

  /** Handle instance:started WebSocket event */
  handleStarted(event: InstanceStartedEvent): void {
    // Clear resuming state - instance is now running
    this.#resumingInstances.delete(event.id);

    const instance = this.#instances.get(event.id);
    if (instance) {
      this.#instances.set(event.id, {
        ...instance,
        status: 'running',
        model: event.model || instance.model,
        conversationId: event.conversationId ?? instance.conversationId,
        activeThreadId: event.activeThreadId ?? instance.activeThreadId,
        activeSpanId: event.activeSpanId ?? instance.activeSpanId,
      });
    } else {
      // Create if not exists
      const createdAt = typeof event.createdAt === 'string' ? event.createdAt : event.createdAt.toISOString();
      this.#instances.set(event.id, {
        id: event.id,
        name: event.lastPrompt?.slice(0, 50) || 'Instance',
        status: 'running',
        agent: '',
        machineId: event.machineId,
        project: null,
        projectId: event.projectId || null,
        conversationId: event.conversationId ?? null,
        activeThreadId: event.activeThreadId ?? null,
        activeSpanId: event.activeSpanId ?? null,
        lastActivity: createdAt,
        cwd: event.cwd,
        model: event.model || undefined,
        totalCostUsd: event.totalCostUsd || 0,
      });
    }

    // Note: We don't add a separate "Session resumed" message here.
    // The SDK init message ("Session started with {model}") provides sufficient feedback.
    // This avoids the UX gap between two separate system messages.
  }

  /** Handle instance:stopped WebSocket event */
  handleStopped(event: InstanceStoppedEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        status: 'stopped',
        totalCostUsd: event.instance?.totalCostUsd ?? instance.totalCostUsd,
      });
    }
    // Clear streaming state
    this.#streamingStates.delete(event.instanceId);
    this.#streamingMessages.delete(event.instanceId);
  }

  /** Handle instance:sleeping WebSocket event */
  handleSleeping(event: InstanceSleepingEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        status: 'sleeping',
      });
    }
    // Clear streaming state
    this.#streamingStates.delete(event.instanceId);
    this.#streamingMessages.delete(event.instanceId);
  }

  /** Handle instance:error WebSocket event */
  handleError(event: InstanceErrorEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        status: 'error',
      });
    }
    // Clear streaming state
    this.#streamingStates.delete(event.instanceId);
    this.#streamingMessages.delete(event.instanceId);
  }

  /** Handle instance:resumed WebSocket event */
  handleResumed(event: InstanceResumedEvent): void {
    const instance = this.#instances.get(event.id);
    if (instance) {
      this.#instances.set(event.id, {
        ...instance,
        status: event.status,
        model: event.model || instance.model,
        conversationId: event.conversationId ?? instance.conversationId,
        activeThreadId: event.activeThreadId ?? instance.activeThreadId,
        activeSpanId: event.activeSpanId ?? instance.activeSpanId,
      });
    } else {
      // Create if not exists
      const createdAt = typeof event.createdAt === 'string' ? event.createdAt : event.createdAt.toISOString();
      this.#instances.set(event.id, {
        id: event.id,
        name: event.lastPrompt?.slice(0, 50) || 'Instance',
        status: event.status,
        agent: '',
        machineId: event.machineId,
        project: null,
        projectId: event.projectId || null,
        conversationId: event.conversationId ?? null,
        activeThreadId: event.activeThreadId ?? null,
        activeSpanId: event.activeSpanId ?? null,
        lastActivity: createdAt,
        cwd: event.cwd,
        model: event.model || undefined,
        totalCostUsd: event.totalCostUsd || 0,
      });
    }
  }

  /** Handle instance:token_usage WebSocket event */
  handleTokenUsage(event: InstanceTokenUsageEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance && event.costDelta) {
      this.#instances.set(event.instanceId, {
        ...instance,
        totalCostUsd: (instance.totalCostUsd || 0) + event.costDelta,
      });
    }

    // Update streaming state
    const existing = this.#streamingStates.get(event.instanceId);
    this.#streamingStates.set(event.instanceId, {
      instanceId: event.instanceId,
      isStreaming: existing?.isStreaming ?? false,
      isInitializing: existing?.isInitializing ?? false,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      sessionInputTokens: (existing?.sessionInputTokens || 0) + event.inputTokens,
      sessionOutputTokens: (existing?.sessionOutputTokens || 0) + event.outputTokens,
      costUsd: (existing?.costUsd || 0) + (event.costDelta || 0),
      lastUpdate: new Date(),
    });
  }

  /** Handle instance:turn WebSocket event */
  handleTurnEvent(event: InstanceTurnEvent): void {
    this.recordActivityEvent(event);
    if (event.phase === 'started') {
      this.updateStreamingState(event.instanceId, { isInitializing: true });
      return;
    }
    this.updateStreamingState(event.instanceId, { isStreaming: false, isInitializing: false });
    this.clearStreamingMessage(event.instanceId);
  }

  /** Handle live SDK messages forwarded directly from agent */
  handleSdkMessage(event: SdkMessageEvent): void {
    const { instanceId, message } = event;
    this.recordActivityEvent(event);

    if (message.type === 'system') {
      const sys = message as SDKSystemMessage;
      if (sys.subtype === 'status') {
        this.setStatus(instanceId, sys.status ?? null);
      } else if (sys.subtype === 'init') {
        if (sys.model) {
          this.updateModel(instanceId, sys.model);
        }
      } else if (sys.subtype === 'compact_boundary') {
        this.setStatus(instanceId, 'compacting');
      }
      return;
    }

    if (message.type === 'tool_progress') {
      const progress = message as SDKToolProgressMessage;
      this.setStatus(instanceId, progress.tool_name ? `running ${progress.tool_name}` : 'running tool');
      return;
    }

    if (message.type === 'auth_status') {
      const auth = message as SDKAuthStatusMessage;
      if (auth.isAuthenticating) {
        this.setStatus(instanceId, 'authenticating');
      } else {
        this.setStatus(instanceId, auth.error ? 'auth error' : null);
      }
      return;
    }

    if (message.type === 'result') {
      const result = message as SDKResultMessage;
      this.updateStreamingState(instanceId, { isStreaming: false, isInitializing: false });
      if (result.subtype === 'success') {
        this.setStatus(instanceId, null);
      }
      return;
    }
  }

  /** Handle instance:model-changed WebSocket event */
  handleModelChanged(event: InstanceModelChangedEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        model: event.model,
      });
    }
  }

  /** Handle instance:viewMode-changed WebSocket event */
  handleViewModeChanged(event: InstanceViewModeChangedEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        viewMode: event.viewMode,
      });
    }
  }

  /** Handle instance:thinking-changed WebSocket event */
  handleThinkingChanged(event: InstanceThinkingChangedEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        thinkingMode: event.mode,
      });
    }
  }

  /** Set thinking mode optimistically (called before RPC for fast UI) */
  setThinkingMode(instanceId: string, mode: 'off' | 'think' | 'ultrathink'): void {
    const instance = this.#instances.get(instanceId);
    if (instance) {
      this.#instances.set(instanceId, {
        ...instance,
        thinkingMode: mode,
      });
    }
  }

  /** Update instance model directly (used by SDK init message) */
  updateModel(instanceId: string, model: string): void {
    const instance = this.#instances.get(instanceId);
    if (instance) {
      this.#instances.set(instanceId, {
        ...instance,
        model,
      });
    }
  }
}

// Singleton with HMR persistence
function createInstanceStore(): InstanceStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__agentdeckInstanceStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__agentdeckInstanceStore;
  }
  const store = new InstanceStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__agentdeckInstanceStore = store;
  return store;
}

export const instances = createInstanceStore();

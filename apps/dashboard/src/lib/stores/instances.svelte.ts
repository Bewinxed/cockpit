import { SvelteMap } from 'svelte/reactivity';
import { parseBackgroundAgentOutput, toolUsesToMessages } from '$lib/utils/background-agent-parser';
import type { Instance, Message, StreamingState, StreamingMessage, SubagentState } from './types';
import type {
  InstanceCreatedEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceSleepingEvent,
  InstanceErrorEvent,
  InstanceResumedEvent,
  InstanceTokenUsageEvent,
  InstanceModelChangedEvent,
} from './sse-events';

/** Tool invocation data from the API */
export interface ToolInvocationData {
  id: string;
  toolName: string;
  toolInput: unknown;
  toolResult: unknown;
  toolResultContent: string | null;
  status: string;
  isError: boolean;
  subagentType: string | null;
  subagentDescription: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

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

  // Active subagents keyed by toolUseId
  #subagents = $state(new SvelteMap<string, SubagentState>());

  // Transient instance status (compacting, etc.)
  #statuses = $state(new SvelteMap<string, string | null>());

  // Background agent ID mapping - maps SDK internal agentId to toolUseId
  #backgroundAgentIdMap = new Map<string, string>();

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
    this.clearSubagentsForInstance(id);
    return this.#instances.delete(id);
  }

  clear(): void {
    this.#instances.clear();
    this.#messages.clear();
    this.#streamingStates.clear();
    this.#streamingMessages.clear();
    this.#subagents.clear();
    this.#statuses.clear();
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
      });
    }
  }

  // ========================================
  // Message Methods
  // ========================================

  /** Get messages for an instance */
  getMessages(instanceId: string): Message[] {
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
      if (msg.type === 'tool_use' && msg.metadata?.toolId === toolId) {
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
    return this.#streamingStates.get(instanceId) || null;
  }

  /** Update streaming state */
  updateStreamingState(instanceId: string, update: Partial<StreamingState>): void {
    const existing = this.#streamingStates.get(instanceId) || {
      instanceId,
      isStreaming: false,
      inputTokens: 0,
      outputTokens: 0,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      costUsd: 0,
      lastUpdate: new Date(),
    };
    this.#streamingStates.set(instanceId, { ...existing, ...update, lastUpdate: new Date() });
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

  // ========================================
  // Subagent Methods (Mission Control)
  // ========================================

  /** Get subagents map */
  get subagents() {
    return this.#subagents;
  }

  /** Start tracking a new subagent */
  startSubagent(
    toolUseId: string,
    instanceId: string,
    subagentType: string,
    description?: string,
    parentSubagentId?: string
  ): void {
    this.#subagents.set(toolUseId, {
      toolUseId,
      instanceId,
      subagentType,
      description,
      status: 'starting',
      startedAt: new Date(),
      parentSubagentId,
      messages: [],
    });
  }

  /** Update subagent status to running */
  setSubagentRunning(toolUseId: string): void {
    const subagent = this.#subagents.get(toolUseId);
    if (subagent) {
      this.#subagents.set(toolUseId, { ...subagent, status: 'running' });
    }
  }

  /** Mark subagent as background agent */
  markSubagentBackground(toolUseId: string): void {
    const subagent = this.#subagents.get(toolUseId);
    if (subagent) {
      this.#subagents.set(toolUseId, { ...subagent, isBackground: true });
    }
  }

  /** Complete a subagent with result */
  completeSubagent(toolUseId: string, result?: string): void {
    const subagent = this.#subagents.get(toolUseId);
    if (!subagent) return;

    let parsedMessages: Message[] = [];
    let finalResult = result;

    // For background agents, parse the result to extract tool uses
    if (subagent.isBackground && result) {
      const parsed = parseBackgroundAgentOutput(result);
      finalResult = parsed.resultText;

      const toolMessages = toolUsesToMessages(parsed.toolUses, parsed.resultText);
      parsedMessages = toolMessages.map(msg => ({
        instanceId: subagent.instanceId,
        type: msg.type,
        content: msg.content,
        timestamp: msg.timestamp,
        parentToolUseId: toolUseId,
        metadata: msg.type === 'tool_use' ? {
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          toolStatus: 'success' as const,
        } : undefined,
      }));
    }

    this.#subagents.set(toolUseId, {
      ...subagent,
      status: 'complete',
      completedAt: new Date(),
      result: finalResult,
      messages: subagent.isBackground
        ? [...subagent.messages, ...parsedMessages]
        : subagent.messages,
    });
  }

  /** Mark subagent as errored */
  errorSubagent(toolUseId: string, error: string): void {
    const subagent = this.#subagents.get(toolUseId);
    if (subagent) {
      this.#subagents.set(toolUseId, {
        ...subagent,
        status: 'error',
        completedAt: new Date(),
        error,
      });
    }
  }

  /** Add a message to a subagent */
  addSubagentMessage(toolUseId: string, message: Message): void {
    const subagent = this.#subagents.get(toolUseId);
    if (subagent) {
      this.#subagents.set(toolUseId, {
        ...subagent,
        messages: [...subagent.messages, message],
      });
    }
  }

  /** Get subagent by toolUseId */
  getSubagent(toolUseId: string): SubagentState | null {
    return this.#subagents.get(toolUseId) || null;
  }

  /** Get all subagents for an instance */
  getSubagentsForInstance(instanceId: string): SubagentState[] {
    return Array.from(this.#subagents.values()).filter(s => s.instanceId === instanceId);
  }

  /** Get active (non-complete) subagents for an instance */
  getActiveSubagentsForInstance(instanceId: string): SubagentState[] {
    return Array.from(this.#subagents.values()).filter(
      s => s.instanceId === instanceId && (s.status === 'starting' || s.status === 'running')
    );
  }

  /** Get child subagents (nested) */
  getChildSubagents(parentToolUseId: string): SubagentState[] {
    return Array.from(this.#subagents.values()).filter(s => s.parentSubagentId === parentToolUseId);
  }

  /** Clear subagents for an instance */
  clearSubagentsForInstance(instanceId: string): void {
    for (const [toolUseId, subagent] of this.#subagents) {
      if (subagent.instanceId === instanceId) {
        this.#subagents.delete(toolUseId);
      }
    }
  }

  /** Update subagent tool result */
  updateSubagentToolResult(parentToolUseId: string, toolId: string, result: unknown, isError: boolean): void {
    const subagent = this.#subagents.get(parentToolUseId);
    if (!subagent) return;

    const updatedMessages = subagent.messages.map(m => {
      if (m.type === 'tool_use' && m.metadata?.toolId === toolId) {
        return {
          ...m,
          metadata: {
            ...m.metadata,
            toolResult: result,
            toolStatus: isError ? 'error' as const : 'success' as const,
          },
        };
      }
      return m;
    });
    this.#subagents.set(parentToolUseId, { ...subagent, messages: updatedMessages });
  }

  /** Register background agent ID mapping */
  registerBackgroundAgent(agentId: string, toolUseId: string): void {
    this.#backgroundAgentIdMap.set(agentId, toolUseId);
  }

  /** Get toolUseId from background agent ID */
  getToolUseIdFromAgentId(agentId: string): string | undefined {
    return this.#backgroundAgentIdMap.get(agentId);
  }

  /** Reconstruct subagents from history (for page reload) */
  reconstructSubagentsFromHistory(
    instanceId: string,
    messages: Message[],
    toolInvocations?: ToolInvocationData[]
  ): void {
    this.clearSubagentsForInstance(instanceId);

    if (toolInvocations && toolInvocations.length > 0) {
      this.#reconstructFromToolInvocations(instanceId, messages, toolInvocations);
    } else {
      this.#reconstructFromMessages(instanceId, messages);
    }
  }

  #reconstructFromToolInvocations(
    instanceId: string,
    messages: Message[],
    toolInvocations: ToolInvocationData[]
  ): void {
    // Build TaskOutput results map
    const taskOutputResults = new Map<string, string>();
    for (const tool of toolInvocations) {
      if (tool.toolName === 'TaskOutput' && tool.toolResultContent) {
        const taskIdMatch = tool.toolResultContent.match(/<task_id>([a-f0-9]+)<\/task_id>/i);
        if (taskIdMatch) {
          const outputMatch = tool.toolResultContent.match(/<output>([\s\S]*?)<\/output>/i);
          if (outputMatch) {
            taskOutputResults.set(taskIdMatch[1], outputMatch[1].trim());
          }
        }
      }
    }

    // Process Task tools
    for (const tool of toolInvocations) {
      if (tool.toolName !== 'Task') continue;

      const toolInput = tool.toolInput as Record<string, unknown> | undefined;
      const toolResult = tool.toolResult as Record<string, unknown> | undefined;

      const subagentType = tool.subagentType || (toolInput?.subagent_type as string) || 'unknown';
      const description = tool.subagentDescription || (toolInput?.description as string);
      const isBackground = toolResult?.isAsync === true || toolInput?.run_in_background === true;
      const agentId = toolResult?.agentId as string | undefined;

      let resultText: string | undefined;
      let parsedMessages: Message[] = [];

      if (isBackground && agentId) {
        const taskOutputContent = taskOutputResults.get(agentId);
        if (taskOutputContent) {
          const parsed = parseBackgroundAgentOutput(taskOutputContent);
          resultText = parsed.resultText;

          const toolMessages = toolUsesToMessages(parsed.toolUses, parsed.resultText);
          parsedMessages = toolMessages.map(m => ({
            instanceId,
            type: m.type,
            content: m.content,
            timestamp: m.timestamp,
            parentToolUseId: tool.id,
            metadata: m.type === 'tool_use' ? {
              toolName: m.toolName,
              toolInput: m.toolInput,
              toolStatus: 'success' as const,
            } : undefined,
          }));
        }
      } else if (!isBackground) {
        resultText = tool.toolResultContent || undefined;
      }

      const hasResult = tool.status === 'success' || tool.status === 'error';

      this.#subagents.set(tool.id, {
        toolUseId: tool.id,
        instanceId,
        subagentType,
        description,
        status: hasResult ? (tool.isError ? 'error' : 'complete') : 'running',
        startedAt: new Date(tool.createdAt),
        completedAt: tool.completedAt ? new Date(tool.completedAt) : undefined,
        messages: parsedMessages,
        result: !tool.isError ? resultText : undefined,
        error: tool.isError ? resultText : undefined,
        isBackground,
      });
    }

    // Add streaming messages from blocking agents
    for (const msg of messages) {
      if (msg.parentToolUseId && this.#subagents.has(msg.parentToolUseId)) {
        const subagent = this.#subagents.get(msg.parentToolUseId)!;
        if (!subagent.isBackground) {
          this.#subagents.set(msg.parentToolUseId, {
            ...subagent,
            messages: [...subagent.messages, msg],
          });
        }
      }
    }
  }

  #reconstructFromMessages(instanceId: string, messages: Message[]): void {
    for (const msg of messages) {
      if (msg.type === 'tool_use' && msg.metadata?.toolName === 'Task') {
        const toolId = msg.metadata.toolId as string;
        if (!toolId) continue;

        const toolInput = msg.metadata.toolInput as Record<string, unknown> | undefined;
        const subagentType = (toolInput?.subagent_type as string) || 'unknown';
        const description = toolInput?.description as string | undefined;
        const isBackground = toolInput?.run_in_background === true;

        const toolStatus = msg.metadata?.toolStatus as string | undefined;
        const hasResult = toolStatus !== 'pending' && toolStatus !== undefined;
        const isError = toolStatus === 'error';
        const resultContent = msg.metadata?.toolResult;
        const rawResultText = hasResult && !isError ? this.#extractResultText(resultContent) : undefined;

        let parsedMessages: Message[] = [];
        let finalResult = rawResultText;

        if (isBackground && rawResultText) {
          const parsed = parseBackgroundAgentOutput(rawResultText);
          finalResult = parsed.resultText;

          const toolMessages = toolUsesToMessages(parsed.toolUses, parsed.resultText);
          parsedMessages = toolMessages.map(m => ({
            instanceId,
            type: m.type,
            content: m.content,
            timestamp: m.timestamp,
            parentToolUseId: toolId,
            metadata: m.type === 'tool_use' ? {
              toolName: m.toolName,
              toolInput: m.toolInput,
              toolStatus: 'success' as const,
            } : undefined,
          }));
        }

        this.#subagents.set(toolId, {
          toolUseId: toolId,
          instanceId,
          subagentType,
          description,
          status: hasResult ? (isError ? 'error' : 'complete') : 'running',
          startedAt: msg.timestamp,
          completedAt: hasResult ? msg.timestamp : undefined,
          messages: parsedMessages,
          result: finalResult,
          error: isError ? this.#extractResultText(resultContent) : undefined,
          isBackground,
        });
      }
    }

    // Add messages with parentToolUseId
    for (const msg of messages) {
      if (msg.parentToolUseId && this.#subagents.has(msg.parentToolUseId)) {
        const subagent = this.#subagents.get(msg.parentToolUseId)!;
        this.#subagents.set(msg.parentToolUseId, {
          ...subagent,
          messages: [...subagent.messages, msg],
        });
      }
    }
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
  // SSE Event Handlers
  // ========================================

  /** Handle instance:created SSE event */
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
      lastActivity: createdAt,
      cwd: event.cwd,
      model: event.model || undefined,
      totalCostUsd: 0,
    });
  }

  /** Handle instance:started SSE event */
  handleStarted(event: InstanceStartedEvent): void {
    const instance = this.#instances.get(event.id);
    if (instance) {
      this.#instances.set(event.id, {
        ...instance,
        status: 'running',
        model: event.model || instance.model,
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
        lastActivity: createdAt,
        cwd: event.cwd,
        model: event.model || undefined,
        totalCostUsd: event.totalCostUsd || 0,
      });
    }
  }

  /** Handle instance:stopped SSE event */
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

  /** Handle instance:sleeping SSE event */
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

  /** Handle instance:error SSE event */
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

  /** Handle instance:resumed SSE event */
  handleResumed(event: InstanceResumedEvent): void {
    const instance = this.#instances.get(event.id);
    if (instance) {
      this.#instances.set(event.id, {
        ...instance,
        status: event.status,
        model: event.model || instance.model,
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
        lastActivity: createdAt,
        cwd: event.cwd,
        model: event.model || undefined,
        totalCostUsd: event.totalCostUsd || 0,
      });
    }
  }

  /** Handle instance:token_usage SSE event */
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
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      sessionInputTokens: (existing?.sessionInputTokens || 0) + event.inputTokens,
      sessionOutputTokens: (existing?.sessionOutputTokens || 0) + event.outputTokens,
      costUsd: (existing?.costUsd || 0) + (event.costDelta || 0),
      lastUpdate: new Date(),
    });
  }

  /** Handle instance:model-changed SSE event */
  handleModelChanged(event: InstanceModelChangedEvent): void {
    const instance = this.#instances.get(event.instanceId);
    if (instance) {
      this.#instances.set(event.instanceId, {
        ...instance,
        model: event.model,
      });
    }
  }
}

// Singleton with HMR persistence
function createInstanceStore(): InstanceStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitInstanceStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitInstanceStore;
  }
  const store = new InstanceStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitInstanceStore = store;
  return store;
}

export const instances = createInstanceStore();

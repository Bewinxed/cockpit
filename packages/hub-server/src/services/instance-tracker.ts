import type { Db } from '@agentdeck/db';
import type { Instance, InstanceStatus, SpawnInstanceData, UpdateInstanceData, ViewMode } from '@agentdeck/core';
import type { MessageMetadata } from '@agentdeck/db';
import {
  instances,
  conversations,
  threads,
  spans,
  messages,
  messageBlocks,
  toolInvocations,
  eq,
  and,
  or,
  asc,
  desc,
  sql,
  inArray,
  gte,
  lte,
} from '@agentdeck/db';
import { generateId } from '@agentdeck/core/utils';

/**
 * Data for saving a message
 */
export interface SaveMessageData {
  /** Full SDK message object */
  content: unknown;
  timestamp?: Date;
  /** SDK's message UUID - required for resumeSessionAt */
  sdkUuid?: string;
}

/**
 * Message from database (relational model)
 */
export interface StoredMessage {
  id: string;
  threadId: string;
  spanId: string;
  parentMessageId?: string | null;
  parentToolUseId?: string | null;
  type: string;
  contentText?: string | null;
  contentJson?: unknown | null;
  metadata?: MessageMetadata | null;
  sdkUuid?: string | null;
  toolCallId?: string | null;
  status?: string | null;
  seq: number;
  createdAt: Date;
}

/**
 * Filters for querying instances
 */
export interface InstanceFilters {
  machineId?: string;
  projectId?: string;
  status?: InstanceStatus | InstanceStatus[];
  sessionId?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'stoppedAt';
  orderDir?: 'asc' | 'desc';
}

/**
 * Service for tracking Claude Code instances.
 * Instances are keyed by instanceId and routed by machineId.
 */
export class InstanceTracker {
  constructor(private db: Db) {}

  /**
   * Create a new instance
   */
  async create(data: SpawnInstanceData): Promise<Instance> {
    const id = generateId();
    const now = new Date();
    const conversationId = generateId();
    const threadId = generateId();
    const spanId = generateId();

    const newInstance = {
      id,
      sessionId: null,
      sdkSessionId: null,
      conversationId,
      activeThreadId: threadId,
      activeSpanId: spanId,
      projectId: data.projectId ?? null,
      machineId: data.machineId, // Required - instances must be tied to a machine
      cwd: data.cwd,
      status: 'starting' as InstanceStatus,
      model: data.model ?? null,
      permissionMode: data.permissionMode ?? null,
      lastPrompt: data.initialPrompt ?? null,
      totalCostUsd: 0,
      createdAt: now,
      stoppedAt: null,
      viewMode: 'chat', // Default to chat view
    };

    await this.db.insert(instances).values(newInstance);
    await this.db.insert(conversations).values({
      id: conversationId,
      instanceId: id,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.db.insert(threads).values({
      id: threadId,
      conversationId,
      parentThreadId: null,
      forkedFromMessageId: null,
      headMessageId: null,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.db.insert(spans).values({
      id: spanId,
      threadId,
      parentSpanId: null,
      toolCallId: null,
      agentType: null,
      agentDescription: null,
      model: data.model ?? null,
      status: 'starting',
      metadata: null,
      startedAt: now,
      endedAt: null,
    });

    return this.dbRowToInstance(newInstance);
  }

  /**
   * Get an instance by ID
   */
  async get(id: string): Promise<Instance | null> {
    const result = await this.db
      .select()
      .from(instances)
      .where(eq(instances.id, id))
      .limit(1);

    if (result.length === 0) return null;
    return this.dbRowToInstance(result[0]);
  }

  /**
   * Get an instance by session ID
   */
  async getBySessionId(sessionId: string): Promise<Instance | null> {
    const result = await this.db
      .select()
      .from(instances)
      .where(eq(instances.sessionId, sessionId))
      .limit(1);

    if (result.length === 0) return null;
    return this.dbRowToInstance(result[0]);
  }

  /**
   * Ensure conversation/thread/span IDs exist for an instance.
   * Creates a default graph if missing.
   */
  private async ensureConversationGraph(instanceId: string): Promise<{
    instanceRow: typeof instances.$inferSelect;
    conversationId: string;
    threadId: string;
    spanId: string;
  }> {
    const rows = await this.db
      .select()
      .from(instances)
      .where(eq(instances.id, instanceId))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const instanceRow = rows[0];
    if (instanceRow.conversationId && instanceRow.activeThreadId && instanceRow.activeSpanId) {
      return {
        instanceRow,
        conversationId: instanceRow.conversationId,
        threadId: instanceRow.activeThreadId,
        spanId: instanceRow.activeSpanId,
      };
    }

    const now = new Date();
    const conversationId = instanceRow.conversationId ?? generateId();
    const threadId = instanceRow.activeThreadId ?? generateId();
    const spanId = instanceRow.activeSpanId ?? generateId();

    if (!instanceRow.conversationId) {
      await this.db.insert(conversations).values({
        id: conversationId,
        instanceId,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!instanceRow.activeThreadId) {
      await this.db.insert(threads).values({
        id: threadId,
        conversationId,
        parentThreadId: null,
        forkedFromMessageId: null,
        headMessageId: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!instanceRow.activeSpanId) {
      await this.db.insert(spans).values({
        id: spanId,
        threadId,
        parentSpanId: null,
        toolCallId: null,
        agentType: null,
        agentDescription: null,
        model: instanceRow.model ?? null,
        status: instanceRow.status ?? 'running',
        metadata: null,
        startedAt: now,
        endedAt: null,
      });
    }

    await this.db
      .update(instances)
      .set({
        conversationId,
        activeThreadId: threadId,
        activeSpanId: spanId,
      })
      .where(eq(instances.id, instanceId));

    return {
      instanceRow: {
        ...instanceRow,
        conversationId,
        activeThreadId: threadId,
        activeSpanId: spanId,
      },
      conversationId,
      threadId,
      spanId,
    };
  }

  async forkThread(
    instanceId: string,
    forkedFromMessageId?: string | null
  ): Promise<{ conversationId: string; threadId: string; spanId: string }> {
    const graph = await this.ensureConversationGraph(instanceId);
    const now = new Date();
    const threadId = generateId();
    const spanId = generateId();

    await this.db.insert(threads).values({
      id: threadId,
      conversationId: graph.conversationId,
      parentThreadId: graph.threadId,
      forkedFromMessageId: forkedFromMessageId ?? null,
      headMessageId: null,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.db.insert(spans).values({
      id: spanId,
      threadId,
      parentSpanId: null,
      toolCallId: null,
      agentType: null,
      agentDescription: null,
      model: graph.instanceRow.model ?? null,
      status: 'starting',
      metadata: null,
      startedAt: now,
      endedAt: null,
    });

    await this.db
      .update(instances)
      .set({ activeThreadId: threadId, activeSpanId: spanId })
      .where(eq(instances.id, instanceId));

    return { conversationId: graph.conversationId, threadId, spanId };
  }

  /**
   * Fork the active thread and clone its message history into the new thread.
   * If forkedFromMessageId is provided, only clone up to that message (inclusive).
   */
  async forkThreadWithHistory(
    instanceId: string,
    forkedFromMessageId?: string | null
  ): Promise<{ conversationId: string; threadId: string; spanId: string }> {
    const graph = await this.ensureConversationGraph(instanceId);
    const fork = await this.forkThread(instanceId, forkedFromMessageId);
    await this.cloneThreadMessages(graph.threadId, fork.threadId, fork.spanId, forkedFromMessageId);
    return fork;
  }

  private async cloneThreadMessages(
    sourceThreadId: string,
    targetThreadId: string,
    targetSpanId: string,
    upToMessageId?: string | null
  ): Promise<void> {
    let cutoffSeq: number | null = null;

    if (upToMessageId) {
      const target = await this.db
        .select({ seq: messages.seq })
        .from(messages)
        .where(and(
          eq(messages.threadId, sourceThreadId),
          or(eq(messages.id, upToMessageId), eq(messages.sdkUuid, upToMessageId))
        ))
        .limit(1);
      if (target.length > 0) {
        cutoffSeq = target[0].seq;
      }
    }

    const sourceRows = await this.db
      .select()
      .from(messages)
      .where(
        cutoffSeq === null
          ? eq(messages.threadId, sourceThreadId)
          : and(eq(messages.threadId, sourceThreadId), lte(messages.seq, cutoffSeq))
      )
      .orderBy(asc(messages.seq));

    if (sourceRows.length === 0) return;

    const idMap = new Map<string, string>();
    for (const row of sourceRows) {
      idMap.set(row.id, generateId());
    }

    const now = new Date();
    const clonedRows = sourceRows.map((row) => {
      const newId = idMap.get(row.id) as string;
      const parentMessageId = row.parentMessageId ? (idMap.get(row.parentMessageId) ?? null) : null;
      return {
        ...row,
        id: newId,
        threadId: targetThreadId,
        spanId: targetSpanId,
        parentMessageId,
      };
    });

    await this.db.insert(messages).values(clonedRows);
    await this.db
      .update(threads)
      .set({ headMessageId: clonedRows[clonedRows.length - 1]?.id ?? null, updatedAt: now })
      .where(eq(threads.id, targetThreadId));
  }

  /**
   * Update an instance
   */
  async update(id: string, data: UpdateInstanceData): Promise<Instance | null> {
    const updateData: Record<string, unknown> = {};

    if (data.sessionId !== undefined) updateData.sessionId = data.sessionId;
    if (data.sdkSessionId !== undefined) updateData.sdkSessionId = data.sdkSessionId;
    if ((data as { conversationId?: string | null }).conversationId !== undefined) {
      updateData.conversationId = (data as { conversationId?: string | null }).conversationId;
    }
    if ((data as { activeThreadId?: string | null }).activeThreadId !== undefined) {
      updateData.activeThreadId = (data as { activeThreadId?: string | null }).activeThreadId;
    }
    if ((data as { activeSpanId?: string | null }).activeSpanId !== undefined) {
      updateData.activeSpanId = (data as { activeSpanId?: string | null }).activeSpanId;
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.lastPrompt !== undefined) updateData.lastPrompt = data.lastPrompt;
    if (data.totalCostUsd !== undefined) updateData.totalCostUsd = data.totalCostUsd;
    if (data.stoppedAt !== undefined) updateData.stoppedAt = data.stoppedAt;
    if (data.viewMode !== undefined) updateData.viewMode = data.viewMode;

    if (Object.keys(updateData).length === 0) {
      return this.get(id);
    }

    await this.db
      .update(instances)
      .set(updateData)
      .where(eq(instances.id, id));

    return this.get(id);
  }

  /**
   * Mark an instance as started
   */
  async markStarted(id: string, sessionId?: string): Promise<Instance | null> {
    return this.update(id, {
      status: 'running',
      sessionId,
    });
  }

  /**
   * Mark an instance as stopped
   */
  async markStopped(id: string): Promise<Instance | null> {
    return this.update(id, {
      status: 'stopped',
      stoppedAt: new Date(),
    });
  }

  /**
   * Mark an instance as sleeping (idle timeout)
   */
  async markSleeping(id: string): Promise<Instance | null> {
    return this.update(id, {
      status: 'sleeping',
    });
  }

  /**
   * Mark an instance as errored
   */
  async markError(id: string): Promise<Instance | null> {
    return this.update(id, {
      status: 'error',
      stoppedAt: new Date(),
    });
  }

  /**
   * List instances with optional filters
   */
  async list(filters?: InstanceFilters): Promise<Instance[]> {
    let query = this.db.select().from(instances).$dynamic();

    const conditions: ReturnType<typeof eq>[] = [];

    if (filters?.machineId) {
      conditions.push(eq(instances.machineId, filters.machineId));
    }

    if (filters?.projectId) {
      conditions.push(eq(instances.projectId, filters.projectId));
    }

    if (filters?.sessionId) {
      conditions.push(eq(instances.sessionId, filters.sessionId));
    }

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(inArray(instances.status, filters.status));
      } else {
        conditions.push(eq(instances.status, filters.status));
      }
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Default ordering
    query = query.orderBy(desc(instances.createdAt));

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    if (filters?.offset) {
      query = query.offset(filters.offset);
    }

    const results = await query;
    return results.map((row) => this.dbRowToInstance(row));
  }

  /**
   * Get active instances (starting or running)
   */
  async getActive(): Promise<Instance[]> {
    return this.list({
      status: ['starting', 'running'],
    });
  }

  /**
   * Get instances for a specific machine
   */
  async getByMachineId(machineId: string): Promise<Instance[]> {
    return this.list({ machineId });
  }

  /**
   * Get active instances for a specific machine
   * Used for reconciliation when machine reconnects
   */
  async getActiveByMachineId(machineId: string): Promise<Instance[]> {
    const results = await this.db
      .select()
      .from(instances)
      .where(and(
        eq(instances.machineId, machineId),
        inArray(instances.status, ['starting', 'running'])
      ));

    return results.map((row) => this.dbRowToInstance(row));
  }

  /**
   * Delete an instance
   */
  async delete(id: string): Promise<boolean> {
    // First check if it exists
    const existing = await this.get(id);
    if (!existing) return false;

    await this.db
      .delete(instances)
      .where(eq(instances.id, id));

    return true;
  }

  /**
   * Count instances with optional filters
   */
  async count(filters?: Pick<InstanceFilters, 'machineId' | 'projectId' | 'status'>): Promise<number> {
    let query = this.db
      .select({ count: sql<number>`count(*)` })
      .from(instances)
      .$dynamic();

    const conditions: ReturnType<typeof eq>[] = [];

    if (filters?.machineId) {
      conditions.push(eq(instances.machineId, filters.machineId));
    }

    if (filters?.projectId) {
      conditions.push(eq(instances.projectId, filters.projectId));
    }

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(inArray(instances.status, filters.status));
      } else {
        conditions.push(eq(instances.status, filters.status));
      }
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const result = await query;
    return result[0]?.count ?? 0;
  }

  /**
   * Get total cost for a machine
   */
  async getTotalCostByMachineId(machineId: string): Promise<number> {
    const result = await this.db
      .select({ total: sql<number>`COALESCE(SUM(total_cost_usd), 0)` })
      .from(instances)
      .where(eq(instances.machineId, machineId));

    return result[0]?.total ?? 0;
  }

  /**
   * Increment the cost for an instance
   */
  async incrementCost(id: string, costDelta: number): Promise<Instance | null> {
    await this.db
      .update(instances)
      .set({ totalCostUsd: sql`COALESCE(total_cost_usd, 0) + ${costDelta}` })
      .where(eq(instances.id, id));

    return this.get(id);
  }

  // ============================================
  // Message Persistence Methods
  // ============================================

  /**
   * Save a raw SDK message for an instance and emit canonical messages.
   */
  async saveMessage(
    instanceId: string,
    data: SaveMessageData
  ): Promise<{ created: StoredMessage[]; updated: StoredMessage[] }> {
    const timestamp = data.timestamp ?? new Date();
    const { threadId, spanId } = await this.ensureConversationGraph(instanceId);

    const msg = data.content as {
      type?: string;
      subtype?: string;
      uuid?: string;
      parent_tool_use_id?: string | null;
      message?: { role?: string; content?: unknown[] | string };
      event?: { type?: string; index?: number; content_block?: unknown; delta?: unknown };
      tool_use_id?: string;
      tool_name?: string;
      tool_use_result?: unknown;
      output?: string[];
      result?: string;
      is_error?: boolean;
    };

    const parentToolUseId = msg.parent_tool_use_id ?? null;
    const effectiveSpanId = parentToolUseId
      ? await this.ensureSpanForToolUse(threadId, spanId, parentToolUseId)
      : spanId;

    const created: StoredMessage[] = [];
    const updated: StoredMessage[] = [];

    if (msg.type === 'stream_event' && msg.event) {
      return { created, updated };
    }

    const contentBlocks = Array.isArray(msg.message?.content)
      ? msg.message?.content ?? []
      : typeof msg.message?.content === 'string'
        ? [{ type: 'text', text: msg.message.content }]
        : [];

    const writeMessage = async (
      payload: Omit<StoredMessage, 'id' | 'seq' | 'createdAt' | 'threadId' | 'spanId'>
    ) => {
      const id = generateId();
      const seq = await this.getNextSeq(threadId);
      const row = {
        id,
        threadId,
        spanId: effectiveSpanId,
        parentMessageId: payload.parentMessageId ?? null,
        parentToolUseId: payload.parentToolUseId ?? null,
        type: payload.type,
        contentText: payload.contentText ?? null,
        contentJson: payload.contentJson ?? null,
        metadata: payload.metadata ?? null,
        sdkUuid: payload.sdkUuid ?? null,
        toolCallId: payload.toolCallId ?? null,
        status: payload.status ?? null,
        seq,
        createdAt: timestamp,
      };
      await this.db.insert(messages).values(row);
      created.push(row);
      await this.db
        .update(threads)
        .set({ headMessageId: row.id, updatedAt: timestamp })
        .where(eq(threads.id, threadId));
      return row;
    };

    if (msg.type === 'user') {
      const text = this.extractText(contentBlocks);
      if (text?.trim()) {
        await writeMessage({
          type: 'user',
          contentText: text.trim(),
          metadata: msg.tool_use_result ? { toolUseResult: msg.tool_use_result } : null,
          sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
          parentToolUseId,
        });
      }

      for (const block of contentBlocks) {
        if (!block || typeof block !== 'object' || !('type' in block)) continue;
        const typed = block as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (typed.type !== 'tool_result') continue;
        const toolUseId = typed.tool_use_id;
        await writeMessage({
          type: 'tool.result',
          contentText: toolUseId ?? 'Tool result',
          metadata: {
            toolId: toolUseId,
            toolResult: typed.content,
            toolStatus: typed.is_error ? 'error' : 'success',
          },
          sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
          parentToolUseId,
          toolCallId: toolUseId ?? null,
        });

        if (toolUseId) {
          await this.db
            .update(toolInvocations)
            .set({
              toolResult: typed.content ?? null,
              toolResultContent: typeof typed.content === 'string' ? typed.content : null,
              status: typed.is_error ? 'error' : 'success',
              isError: typed.is_error ?? false,
              completedAt: timestamp,
            })
            .where(eq(toolInvocations.id, toolUseId));
        }
      }

      return { created, updated };
    }

    if (msg.type === 'assistant') {
      for (const block of contentBlocks) {
        if (!block || typeof block !== 'object' || !('type' in block)) continue;
        const typed = block as {
          type: string;
          text?: string;
          thinking?: string;
          signature?: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };

        if (typed.type === 'text' && typed.text) {
          await writeMessage({
            type: 'assistant',
            contentText: typed.text,
            sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
            parentToolUseId,
          });
        } else if (typed.type === 'thinking') {
          await writeMessage({
            type: 'thinking',
            contentText: typed.thinking ?? '',
            metadata: {
              thinking: typed.thinking ?? '',
              thinkingSignature: typed.signature,
              isRedactedThinking: false,
            },
            sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
            parentToolUseId,
          });
        } else if (typed.type === 'redacted_thinking') {
          await writeMessage({
            type: 'thinking',
            contentText: 'Reasoning redacted',
            metadata: { isRedactedThinking: true },
            sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
            parentToolUseId,
          });
        } else if (typed.type === 'tool_use') {
          const toolUseId = typed.id ?? generateId();
          const toolName = typed.name ?? 'Tool';
          const toolInput = typed.input ?? null;
          const subagentType = toolName === 'Task'
            ? (toolInput as Record<string, unknown> | null)?.subagent_type as string | undefined
            : undefined;
          const subagentDescription = toolName === 'Task'
            ? (toolInput as Record<string, unknown> | null)?.description as string | undefined
            : undefined;

          const toolMessage = await writeMessage({
            type: 'tool.use',
            contentText: toolName,
            metadata: {
              toolId: toolUseId,
              toolName,
              toolInput,
              ...(subagentType ? { subagentType } : {}),
              ...(subagentDescription ? { subagentDescription } : {}),
            },
            sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
            parentToolUseId,
            toolCallId: toolUseId,
          });

          await this.db.insert(toolInvocations).values({
            id: toolUseId,
            spanId: effectiveSpanId,
            messageId: toolMessage.id,
            toolName,
            toolInput,
            toolResult: null,
            toolResultContent: null,
            status: 'pending',
            isError: false,
            durationMs: null,
            backgroundAgentId: null,
            createdAt: timestamp,
            completedAt: null,
          });

          if (toolName === 'Task') {
            await this.ensureSubagentSpan(threadId, effectiveSpanId, toolUseId, subagentType, subagentDescription);
          }
        } else if (typed.type === 'tool_result') {
          const toolUseId = typed.tool_use_id;
          await writeMessage({
            type: 'tool.result',
            contentText: toolUseId ?? 'Tool result',
            metadata: {
              toolId: toolUseId,
              toolResult: typed.content,
              toolStatus: typed.is_error ? 'error' : 'success',
            },
            sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
            parentToolUseId,
            toolCallId: toolUseId ?? null,
          });

          if (toolUseId) {
            await this.db
              .update(toolInvocations)
              .set({
                toolResult: typed.content ?? null,
                toolResultContent: typeof typed.content === 'string' ? typed.content : null,
                status: typed.is_error ? 'error' : 'success',
                isError: typed.is_error ?? false,
                completedAt: timestamp,
              })
              .where(eq(toolInvocations.id, toolUseId));
          }
        }
      }
      return { created, updated };
    }

    if (msg.type === 'system') {
      const subtype = msg.subtype ?? 'unknown';
      await writeMessage({
        type: `system.${subtype}`,
        contentText: subtype,
        metadata: msg as Record<string, unknown>,
        sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
        parentToolUseId,
      });
      return { created, updated };
    }

    if (msg.type === 'result') {
      const subtype = msg.subtype ?? 'success';
      await writeMessage({
        type: subtype === 'success' ? 'result.success' : 'result.error',
        contentText: msg.result ?? subtype,
        metadata: msg as Record<string, unknown>,
        sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
        parentToolUseId,
      });
      return { created, updated };
    }

    if (msg.type === 'tool_progress') {
      await writeMessage({
        type: 'tool.progress',
        contentText: msg.tool_name ?? 'Tool progress',
        metadata: msg as Record<string, unknown>,
        sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
        parentToolUseId,
        toolCallId: msg.tool_use_id ?? null,
      });
      return { created, updated };
    }

    if (msg.type === 'auth_status') {
      await writeMessage({
        type: 'system.auth_status',
        contentText: msg.output?.join('\n') ?? '',
        metadata: msg as Record<string, unknown>,
        sdkUuid: msg.uuid ?? data.sdkUuid ?? null,
        parentToolUseId,
      });
      return { created, updated };
    }

    return { created, updated };
  }

  /**
   * Append a UI-only message (login/model/memory/help/etc).
   */
  async appendUiMessage(
    instanceId: string,
    payload: {
      type: string;
      contentText?: string | null;
      contentJson?: unknown | null;
      metadata?: MessageMetadata | null;
      parentMessageId?: string | null;
      parentToolUseId?: string | null;
      toolCallId?: string | null;
    }
  ): Promise<StoredMessage> {
    const timestamp = new Date();
    const { threadId, spanId } = await this.ensureConversationGraph(instanceId);
    const id = generateId();
    const seq = await this.getNextSeq(threadId);
    const row = {
      id,
      threadId,
      spanId,
      parentMessageId: payload.parentMessageId ?? null,
      parentToolUseId: payload.parentToolUseId ?? null,
      type: payload.type,
      contentText: payload.contentText ?? null,
      contentJson: payload.contentJson ?? null,
      metadata: payload.metadata ?? null,
      sdkUuid: null,
      toolCallId: payload.toolCallId ?? null,
      status: null,
      seq,
      createdAt: timestamp,
    };
    await this.db.insert(messages).values(row);
    await this.db
      .update(threads)
      .set({ headMessageId: row.id, updatedAt: timestamp })
      .where(eq(threads.id, threadId));
    return row;
  }

  /**
   * Get messages for the active thread of an instance.
   */
  async getMessages(instanceId: string, limit = 200, offset = 0): Promise<StoredMessage[]> {
    const { threadId } = await this.ensureConversationGraph(instanceId);
    const results = await this.db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.seq))
      .limit(limit)
      .offset(offset);

    return results.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      spanId: row.spanId,
      parentMessageId: row.parentMessageId,
      parentToolUseId: row.parentToolUseId,
      type: row.type,
      contentText: row.contentText,
      contentJson: row.contentJson,
      metadata: row.metadata as MessageMetadata | null,
      sdkUuid: row.sdkUuid,
      toolCallId: row.toolCallId,
      status: row.status,
      seq: row.seq,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Get messages since a specific sequence number.
   */
  async getMessagesSince(instanceId: string, sinceSeq: number): Promise<StoredMessage[]> {
    const { threadId } = await this.ensureConversationGraph(instanceId);
    const results = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, threadId), sql`${messages.seq} > ${sinceSeq}`))
      .orderBy(asc(messages.seq));

    return results.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      spanId: row.spanId,
      parentMessageId: row.parentMessageId,
      parentToolUseId: row.parentToolUseId,
      type: row.type,
      contentText: row.contentText,
      contentJson: row.contentJson,
      metadata: row.metadata as MessageMetadata | null,
      sdkUuid: row.sdkUuid,
      toolCallId: row.toolCallId,
      status: row.status,
      seq: row.seq,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Delete all messages for an instance (all threads in its conversation).
   */
  async deleteMessages(instanceId: string): Promise<number> {
    const graph = await this.ensureConversationGraph(instanceId);
    const threadRows = await this.db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.conversationId, graph.conversationId));
    const threadIds = threadRows.map((row) => row.id);
    if (threadIds.length === 0) return 0;

    const msgRows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(inArray(messages.threadId, threadIds));
    const messageIds = msgRows.map((row) => row.id);

    if (messageIds.length > 0) {
      await this.db.delete(messageBlocks).where(inArray(messageBlocks.messageId, messageIds));
      await this.db.delete(toolInvocations).where(inArray(toolInvocations.messageId, messageIds));
      await this.db.delete(messages).where(inArray(messages.id, messageIds));
      return messageIds.length;
    }

    return 0;
  }

  /**
   * Delete messages after a specific message ID or SDK UUID (active thread only).
   */
  async deleteMessagesAfter(instanceId: string, messageIdOrUuid: string): Promise<number> {
    const { threadId } = await this.ensureConversationGraph(instanceId);
    const target = await this.db
      .select({ id: messages.id, seq: messages.seq })
      .from(messages)
      .where(and(eq(messages.threadId, threadId), or(eq(messages.id, messageIdOrUuid), eq(messages.sdkUuid, messageIdOrUuid))))
      .limit(1);

    if (target.length === 0) return 0;

    const targetSeq = target[0].seq;
    const msgRows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.threadId, threadId), gte(messages.seq, targetSeq)));
    const messageIds = msgRows.map((row) => row.id);

    if (messageIds.length > 0) {
      await this.db.delete(messageBlocks).where(inArray(messageBlocks.messageId, messageIds));
      await this.db.delete(toolInvocations).where(inArray(toolInvocations.messageId, messageIds));
      await this.db.delete(messages).where(inArray(messages.id, messageIds));
      const latest = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.threadId, threadId))
        .orderBy(desc(messages.seq))
        .limit(1);
      await this.db
        .update(threads)
        .set({ headMessageId: latest[0]?.id ?? null, updatedAt: new Date() })
        .where(eq(threads.id, threadId));
      return messageIds.length;
    }

    return 0;
  }

  /**
   * Get tool invocations for an instance
   */
  async getToolInvocations(instanceId: string): Promise<Array<{
    id: string;
    toolName: string;
    toolInput: unknown;
    toolResult: unknown;
    toolResultContent: string | null;
    status: string;
    isError: boolean;
    createdAt: Date;
    completedAt: Date | null;
  }>> {
    const { threadId } = await this.ensureConversationGraph(instanceId);
    const spanRows = await this.db
      .select({ id: spans.id })
      .from(spans)
      .where(eq(spans.threadId, threadId));
    const spanIds = spanRows.map((row) => row.id);
    if (spanIds.length === 0) return [];

    const results = await this.db
      .select()
      .from(toolInvocations)
      .where(inArray(toolInvocations.spanId, spanIds))
      .orderBy(asc(toolInvocations.createdAt));

    return results.map((row) => ({
      id: row.id,
      toolName: row.toolName,
      toolInput: row.toolInput,
      toolResult: row.toolResult,
      toolResultContent: row.toolResultContent,
      status: row.status,
      isError: row.isError ?? false,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  }

  /**
   * Count messages for an instance
   */
  async countMessages(instanceId: string): Promise<number> {
    const { threadId } = await this.ensureConversationGraph(instanceId);
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.threadId, threadId));

    return result[0]?.count ?? 0;
  }

  /**
   * Update tool invocation with question answers (for AskUserQuestion persistence)
   * Merges answers into toolInput so they're available after page refresh
   */
  async updateToolInvocationAnswers(toolUseId: string, answers: Record<string, string>): Promise<void> {
    try {
      // Get current tool invocation
      const result = await this.db
        .select({ toolInput: toolInvocations.toolInput })
        .from(toolInvocations)
        .where(eq(toolInvocations.id, toolUseId))
        .limit(1);

      if (result.length === 0) {
        console.warn(`[InstanceTracker] Tool invocation ${toolUseId} not found for answer update`);
        return;
      }

      // Merge answers into existing toolInput
      const existingInput = (result[0].toolInput as Record<string, unknown>) || {};
      const updatedInput = { ...existingInput, answers };

      await this.db
        .update(toolInvocations)
        .set({ toolInput: updatedInput })
        .where(eq(toolInvocations.id, toolUseId));

      console.log(`[InstanceTracker] Updated tool invocation ${toolUseId} with question answers`);
    } catch (err) {
      console.error(`[InstanceTracker] Failed to update tool invocation ${toolUseId} with answers:`, err);
    }
  }

  private async getNextSeq(threadId: string): Promise<number> {
    const result = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(seq), 0)` })
      .from(messages)
      .where(eq(messages.threadId, threadId));
    return (result[0]?.maxSeq ?? 0) + 1;
  }

  private extractText(blocks: unknown[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
      if (typeof block === 'string') {
        parts.push(block);
        continue;
      }
      if (block && typeof block === 'object' && 'type' in block) {
        const typed = block as { type: string; text?: string };
        if (typed.type === 'text' && typed.text) {
          parts.push(typed.text);
        }
      }
    }
    return parts.join('');
  }

  private async ensureSpanForToolUse(
    threadId: string,
    parentSpanId: string,
    toolUseId: string
  ): Promise<string> {
    const existing = await this.db
      .select({ id: spans.id })
      .from(spans)
      .where(and(eq(spans.threadId, threadId), eq(spans.toolCallId, toolUseId)))
      .limit(1);
    if (existing.length > 0) return existing[0].id;

    const id = generateId();
    const now = new Date();
    await this.db.insert(spans).values({
      id,
      threadId,
      parentSpanId,
      toolCallId: toolUseId,
      agentType: null,
      agentDescription: null,
      model: null,
      status: 'running',
      metadata: null,
      startedAt: now,
      endedAt: null,
    });
    return id;
  }

  private async ensureSubagentSpan(
    threadId: string,
    parentSpanId: string,
    toolUseId: string,
    subagentType?: string,
    subagentDescription?: string
  ): Promise<string> {
    const existing = await this.db
      .select({ id: spans.id })
      .from(spans)
      .where(and(eq(spans.threadId, threadId), eq(spans.toolCallId, toolUseId)))
      .limit(1);
    if (existing.length > 0) {
      if (subagentType || subagentDescription) {
        await this.db
          .update(spans)
          .set({
            agentType: subagentType ?? null,
            agentDescription: subagentDescription ?? null,
          })
          .where(eq(spans.id, existing[0].id));
      }
      return existing[0].id;
    }

    const id = generateId();
    const now = new Date();
    await this.db.insert(spans).values({
      id,
      threadId,
      parentSpanId,
      toolCallId: toolUseId,
      agentType: subagentType ?? null,
      agentDescription: subagentDescription ?? null,
      model: null,
      status: 'running',
      metadata: null,
      startedAt: now,
      endedAt: null,
    });
    return id;
  }

  /**
   * Convert database row to Instance type
   */
  private dbRowToInstance(row: typeof instances.$inferSelect): Instance {
    return {
      id: row.id,
      sessionId: row.sessionId ?? undefined,
      sdkSessionId: row.sdkSessionId ?? undefined,
      conversationId: row.conversationId ?? undefined,
      activeThreadId: row.activeThreadId ?? undefined,
      activeSpanId: row.activeSpanId ?? undefined,
      projectId: row.projectId ?? undefined,
      machineId: row.machineId,
      cwd: row.cwd,
      status: row.status as InstanceStatus,
      model: row.model ?? undefined,
      permissionMode: row.permissionMode as Instance['permissionMode'],
      lastPrompt: row.lastPrompt ?? undefined,
      totalCostUsd: row.totalCostUsd ?? 0,
      createdAt: row.createdAt,
      stoppedAt: row.stoppedAt ?? undefined,
      viewMode: (row.viewMode as ViewMode) ?? 'chat',
    };
  }

}

// Factory function for creating tracker instances
export function createInstanceTracker(db: Db): InstanceTracker {
  return new InstanceTracker(db);
}

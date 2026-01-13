import type { Db } from '@cockpit/db';
import type { Instance, InstanceStatus, SpawnInstanceData, UpdateInstanceData } from '@cockpit/core';
import { instances, messages, toolInvocations, eq, and, asc, desc, sql, inArray } from '@cockpit/db';
import { generateId } from '@cockpit/core/utils';
import {
  extractMessageFields,
  extractToolInvocations,
  extractToolResults,
  type ExtractedMessageFields,
} from './message-extractor';

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
  instanceId: string;
  timestamp: Date;
  /** SDK's message UUID - required for resumeSessionAt */
  sdkUuid?: string;
  // Normalized fields
  sdkType: string;
  sdkSubtype?: string | null;
  parentToolUseId?: string | null;
  role?: 'user' | 'assistant' | null;
  textContent?: string | null;
  rawContent: unknown;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
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

    const newInstance = {
      id,
      sessionId: null,
      sdkSessionId: null,
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
    };

    await this.db.insert(instances).values(newInstance);

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
   * Update an instance
   */
  async update(id: string, data: UpdateInstanceData): Promise<Instance | null> {
    const updateData: Record<string, unknown> = {};

    if (data.sessionId !== undefined) updateData.sessionId = data.sessionId;
    if (data.sdkSessionId !== undefined) updateData.sdkSessionId = data.sdkSessionId;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.lastPrompt !== undefined) updateData.lastPrompt = data.lastPrompt;
    if (data.totalCostUsd !== undefined) updateData.totalCostUsd = data.totalCostUsd;
    if (data.stoppedAt !== undefined) updateData.stoppedAt = data.stoppedAt;

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
   * Save a message for an instance with normalized field extraction.
   * Also extracts tool_use blocks into tool_invocations table and
   * updates tool_invocations when tool_result blocks are received.
   */
  async saveMessage(instanceId: string, data: SaveMessageData): Promise<StoredMessage> {
    const id = generateId();
    const timestamp = data.timestamp ?? new Date();

    // Extract normalized fields from SDK message
    const extracted = extractMessageFields(data.content);

    // Build message record with normalized fields
    const newMessage = {
      id,
      instanceId,
      sdkUuid: extracted.sdkUuid ?? data.sdkUuid ?? null,
      sdkType: extracted.sdkType,
      sdkSubtype: extracted.sdkSubtype,
      parentToolUseId: extracted.parentToolUseId,
      role: extracted.role,
      textContent: extracted.textContent,
      rawContent: extracted.rawContent,
      model: extracted.model,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      costUsd: extracted.costUsd,
      timestamp,
      createdAt: timestamp,
    };

    await this.db.insert(messages).values(newMessage);

    // Extract and insert tool_use blocks from assistant messages
    const toolInvocationsToInsert = extractToolInvocations(data.content);
    if (toolInvocationsToInsert.length > 0) {
      const toolRecords = toolInvocationsToInsert.map((tool) => ({
        id: tool.id,
        messageId: id,
        instanceId,
        toolName: tool.toolName,
        toolInput: tool.toolInput,
        status: 'pending' as const,
        subagentType: tool.subagentType,
        subagentDescription: tool.subagentDescription,
        createdAt: timestamp,
      }));

      try {
        await this.db.insert(toolInvocations).values(toolRecords);
      } catch (err) {
        // Tool invocation might already exist (duplicate message)
        console.warn('[InstanceTracker] Failed to insert tool invocations:', err);
      }
    }

    // Extract and update tool_result blocks (update existing tool_invocations)
    const toolResultUpdates = extractToolResults(data.content);
    for (const update of toolResultUpdates) {
      try {
        await this.db
          .update(toolInvocations)
          .set({
            toolResult: update.toolResult,
            toolResultContent: update.toolResultContent,
            status: update.status,
            isError: update.isError,
            durationMs: update.durationMs,
            completedAt: timestamp,
          })
          .where(eq(toolInvocations.id, update.toolUseId));
      } catch (err) {
        // Tool invocation might not exist yet (result before use, or from subagent)
        console.warn(`[InstanceTracker] Failed to update tool invocation ${update.toolUseId}:`, err);
      }
    }

    return {
      id,
      instanceId,
      timestamp,
      sdkUuid: extracted.sdkUuid ?? data.sdkUuid,
      sdkType: extracted.sdkType,
      sdkSubtype: extracted.sdkSubtype,
      parentToolUseId: extracted.parentToolUseId,
      role: extracted.role,
      textContent: extracted.textContent,
      rawContent: extracted.rawContent,
      model: extracted.model,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      costUsd: extracted.costUsd,
    };
  }

  /**
   * Get messages for an instance
   */
  async getMessages(instanceId: string, limit = 100, offset = 0): Promise<StoredMessage[]> {
    const results = await this.db
      .select()
      .from(messages)
      .where(eq(messages.instanceId, instanceId))
      .orderBy(asc(messages.timestamp))
      .limit(limit)
      .offset(offset);

    return results.map((row) => ({
      id: row.id,
      instanceId: row.instanceId,
      timestamp: row.timestamp,
      sdkUuid: row.sdkUuid ?? undefined,
      sdkType: row.sdkType,
      sdkSubtype: row.sdkSubtype,
      parentToolUseId: row.parentToolUseId,
      role: row.role as 'user' | 'assistant' | null,
      textContent: row.textContent,
      rawContent: row.rawContent,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd,
    }));
  }

  /**
   * Get messages since a specific timestamp
   */
  async getMessagesSince(instanceId: string, since: Date): Promise<StoredMessage[]> {
    const results = await this.db
      .select()
      .from(messages)
      .where(and(
        eq(messages.instanceId, instanceId),
        sql`${messages.timestamp} > ${since.getTime()}`
      ))
      .orderBy(asc(messages.timestamp));

    return results.map((row) => ({
      id: row.id,
      instanceId: row.instanceId,
      timestamp: row.timestamp,
      sdkUuid: row.sdkUuid ?? undefined,
      sdkType: row.sdkType,
      sdkSubtype: row.sdkSubtype,
      parentToolUseId: row.parentToolUseId,
      role: row.role as 'user' | 'assistant' | null,
      textContent: row.textContent,
      rawContent: row.rawContent,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd,
    }));
  }

  /**
   * Delete all messages for an instance
   */
  async deleteMessages(instanceId: string): Promise<number> {
    // Count messages before deleting to return count
    const count = await this.countMessages(instanceId);
    await this.db
      .delete(messages)
      .where(eq(messages.instanceId, instanceId));

    return count;
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
    subagentType: string | null;
    subagentDescription: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }>> {
    const results = await this.db
      .select()
      .from(toolInvocations)
      .where(eq(toolInvocations.instanceId, instanceId))
      .orderBy(asc(toolInvocations.createdAt));

    return results.map((row) => ({
      id: row.id,
      toolName: row.toolName,
      toolInput: row.toolInput,
      toolResult: row.toolResult,
      toolResultContent: row.toolResultContent,
      status: row.status,
      isError: row.isError ?? false,
      subagentType: row.subagentType,
      subagentDescription: row.subagentDescription,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  }

  /**
   * Count messages for an instance
   */
  async countMessages(instanceId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.instanceId, instanceId));

    return result[0]?.count ?? 0;
  }

  /**
   * Convert database row to Instance type
   */
  private dbRowToInstance(row: typeof instances.$inferSelect): Instance {
    return {
      id: row.id,
      sessionId: row.sessionId ?? undefined,
      sdkSessionId: row.sdkSessionId ?? undefined,
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
    };
  }

}

// Factory function for creating tracker instances
export function createInstanceTracker(db: Db): InstanceTracker {
  return new InstanceTracker(db);
}

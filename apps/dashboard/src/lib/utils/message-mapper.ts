import type { CanonicalMessage } from '@agentdeck/core/dashboard';
import type { Message, MessageMetadata, MessageType } from '$lib/stores/types';

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeMetadata(message: CanonicalMessage): MessageMetadata | undefined {
  const raw = message.metadata && typeof message.metadata === 'object'
    ? (message.metadata as MessageMetadata)
    : undefined;
  let metadata = raw ? { ...raw } : undefined;

  if (message.type.startsWith('system.')) {
    const subtype = message.type.slice('system.'.length);
    if (metadata) {
      if (!metadata.subtype) metadata.subtype = subtype;
    } else {
      metadata = { subtype } as MessageMetadata;
    }
  }

  if (message.type === 'tool.use') {
    if (metadata) {
      if (!metadata.toolStatus) metadata.toolStatus = 'pending';
    }
  }

  if (message.type === 'tool.result') {
    if (metadata) {
      const status = (metadata.toolStatus || message.status) as 'pending' | 'success' | 'error' | undefined;
      if (status) metadata.toolStatus = status;
    }
  }

  if (message.type === 'result.error') {
    if (metadata) {
      if (!metadata.resultSubtype && metadata.subtype) {
        metadata.resultSubtype = metadata.subtype as MessageMetadata['resultSubtype'];
      }
      if (!metadata.resultErrors && (metadata as { errors?: string[] }).errors) {
        metadata.resultErrors = (metadata as { errors?: string[] }).errors;
      }
      if (!metadata.totalCost && (metadata as { total_cost_usd?: number }).total_cost_usd !== undefined) {
        metadata.totalCost = (metadata as { total_cost_usd?: number }).total_cost_usd;
      }
      if (!metadata.numTurns && (metadata as { num_turns?: number }).num_turns !== undefined) {
        metadata.numTurns = (metadata as { num_turns?: number }).num_turns;
      }
    }
  }

  return metadata;
}

export function toUiMessage(instanceId: string, message: CanonicalMessage): Message {
  const contentText = typeof message.contentText === 'string' ? message.contentText : '';
  let content = contentText;
  if (!content && message.contentJson !== undefined && message.contentJson !== null) {
    content = typeof message.contentJson === 'string'
      ? message.contentJson
      : JSON.stringify(message.contentJson);
  }

  return {
    id: message.id,
    instanceId,
    threadId: message.threadId,
    spanId: message.spanId,
    parentMessageId: message.parentMessageId ?? undefined,
    parentToolUseId: message.parentToolUseId ?? undefined,
    type: message.type as MessageType,
    content,
    contentJson: message.contentJson ?? undefined,
    timestamp: toDate(message.createdAt),
    sdkUuid: message.sdkUuid ?? undefined,
    toolCallId: message.toolCallId ?? undefined,
    status: message.status ?? undefined,
    seq: message.seq,
    metadata: normalizeMetadata(message),
  };
}

/**
 * Map API messages to UI messages, handling tool results properly.
 * This is used both for SSR preloading and client-side loading.
 */
export function mapApiMessages(
  instanceId: string,
  messages: CanonicalMessage[]
): { parsed: Message[]; toolResults: Map<string, { result: unknown; status: 'success' | 'error' }> } {
  const parsed: Message[] = [];
  const toolResults = new Map<string, { result: unknown; status: 'success' | 'error' }>();

  const sorted = [...messages].sort((a, b) => a.seq - b.seq);

  for (const raw of sorted) {
    if (raw.type === 'system.init' || raw.type === 'system.status' || raw.type === 'result.success' || raw.type === 'tool.progress') {
      continue;
    }

    const uiMessage = toUiMessage(instanceId, raw);

    if (uiMessage.type === 'tool.result') {
      const toolId = uiMessage.metadata?.toolId as string | undefined;
      const status = uiMessage.metadata?.toolStatus === 'error' ? 'error' : 'success';
      if (toolId) {
        const target = parsed.find(
          (m) => m.type === 'tool.use' && m.metadata?.toolId === toolId
        );
        if (target) {
          target.metadata = {
            ...target.metadata,
            toolResult: uiMessage.metadata?.toolResult,
            toolStatus: status,
          };
        } else {
          toolResults.set(toolId, { result: uiMessage.metadata?.toolResult, status });
        }
      }
      continue;
    }

    if (uiMessage.type === 'tool.use') {
      const toolId = uiMessage.metadata?.toolId as string | undefined;
      if (toolId && toolResults.has(toolId)) {
        const cached = toolResults.get(toolId)!;
        uiMessage.metadata = {
          ...uiMessage.metadata,
          toolResult: cached.result,
          toolStatus: cached.status,
        };
        toolResults.delete(toolId);
      }
    }

    parsed.push(uiMessage);
  }

  return { parsed, toolResults };
}

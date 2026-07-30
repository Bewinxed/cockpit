/**
 * Raw `SDKMessage` → the `Message` shape the ported renderers already consume.
 *
 * Pure by design: it returns what a frame means and the client store applies it.
 * The SDK's own types are the input contract (tunnelled through `@cockpit/core`),
 * so nothing here re-models them.
 */
import type { SDKAssistantMessage, SDKMessage } from '@cockpit/core';
import type { Message, MessageMetadata, MessageType } from '$lib/stores/types';

type AssistantBlock = SDKAssistantMessage['message']['content'][number];

/** A tool result to fold into the `tool.use` message that opened it. */
export interface ToolResult {
  toolId: string;
  result: string;
  isError: boolean;
}

export interface FrameMapping {
  /** Appended to the transcript, in order. */
  messages: Message[];
  toolResults: ToolResult[];
  /** Text to append to the instance's streaming buffer. */
  delta: string;
  /** The streaming buffer has been superseded by a final message. */
  clearsStream: boolean;
  /** The turn is over — the session is idle again. */
  endsTurn: boolean;
}

/**
 * Message types (and `system` subtypes) with no transcript meaning. Rendering a
 * line for each one buries the conversation; everything outside this set still
 * degrades to a generic system line rather than disappearing silently.
 */
const QUIET = new Set([
  'tool_progress',
  'control_request_progress',
  'thinking_tokens',
  'session_state_changed',
  'commands_changed',
  'background_tasks_changed',
  'files_persisted',
  'rate_limit_event',
]);

const empty = (): FrameMapping => ({
  messages: [],
  toolResults: [],
  delta: '',
  clearsStream: false,
  endsTurn: false,
});

const uuidOf = (sdk: SDKMessage): string | undefined => ('uuid' in sdk ? sdk.uuid : undefined);

const parentOf = (sdk: SDKMessage): string | undefined =>
  'parent_tool_use_id' in sdk ? (sdk.parent_tool_use_id ?? undefined) : undefined;

/** Tool results arrive as text blocks far more often than as a plain string. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) =>
        typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function blockToMessage(
  block: AssistantBlock,
  base: Omit<Message, 'type' | 'content'>
): Message | null {
  switch (block.type) {
    case 'text':
      return { ...base, type: 'assistant', content: block.text };
    case 'thinking':
      // Signature-only blocks carry no reasoning to show.
      if (!block.thinking) return null;
      return {
        ...base,
        type: 'thinking',
        content: block.thinking,
        metadata: { thinking: block.thinking, thinkingSignature: block.signature },
      };
    case 'redacted_thinking':
      return {
        ...base,
        type: 'thinking',
        content: '',
        metadata: { isRedactedThinking: true },
      };
    case 'tool_use':
      return {
        ...base,
        type: 'tool.use',
        content: block.name,
        toolCallId: block.id,
        metadata: {
          toolId: block.id,
          toolName: block.name,
          toolInput: block.input as MessageMetadata['toolInput'],
          toolStatus: 'pending',
        },
      };
    default:
      return null;
  }
}

function systemLine(
  base: Omit<Message, 'type' | 'content'>,
  type: MessageType,
  content: string,
  metadata?: MessageMetadata
): Message {
  return { ...base, type, content, metadata };
}

/** What one SDK frame does to an instance's UI state. */
export function mapFrame(instanceId: string, sdk: SDKMessage): FrameMapping {
  const mapping = empty();
  const uuid = uuidOf(sdk);
  const base: Omit<Message, 'type' | 'content'> = {
    id: uuid ?? crypto.randomUUID(),
    instanceId,
    timestamp: new Date(),
    sdkUuid: uuid,
    parentToolUseId: parentOf(sdk),
  };

  switch (sdk.type) {
    case 'assistant': {
      sdk.message.content.forEach((block, index) => {
        const message = blockToMessage(block, { ...base, id: `${base.id}:${index}` });
        if (message) mapping.messages.push(message);
      });
      // The final message supersedes whatever the partials painted.
      mapping.clearsStream = true;
      break;
    }

    case 'user': {
      // Only tool results: the user's own text is rendered from the local copy
      // added on send — the SDK does not echo it back.
      const content = sdk.message.content;
      if (typeof content === 'string') break;
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        mapping.toolResults.push({
          toolId: block.tool_use_id,
          result: resultText(block.content),
          isError: block.is_error === true,
        });
      }
      break;
    }

    case 'stream_event': {
      const event = sdk.event;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        mapping.delta = event.delta.text;
      } else if (event.type === 'message_stop') {
        mapping.clearsStream = true;
      }
      break;
    }

    case 'result': {
      mapping.clearsStream = true;
      mapping.endsTurn = true;
      if (sdk.subtype === 'success') break;
      mapping.messages.push(
        systemLine(base, 'result.error', sdk.subtype.replace(/_/g, ' '), {
          resultSubtype: sdk.subtype,
          resultErrors: 'errors' in sdk ? sdk.errors : undefined,
          totalCost: sdk.total_cost_usd,
          numTurns: sdk.num_turns,
        })
      );
      break;
    }

    case 'system': {
      switch (sdk.subtype) {
        case 'init':
          mapping.messages.push(
            systemLine(base, 'system.init', `Session started · ${sdk.model}`, {
              subtype: 'init',
              model: sdk.model,
              cwd: sdk.cwd,
              tools: sdk.tools,
              sessionId: sdk.session_id,
              mcpServers: sdk.mcp_servers,
            })
          );
          break;
        case 'status':
          break;
        case 'compact_boundary':
          mapping.messages.push(
            systemLine(base, 'system.compact_boundary', 'Context compacted', {
              subtype: 'compact_boundary',
              preTokens: sdk.compact_metadata.pre_tokens,
              trigger: sdk.compact_metadata.trigger,
            })
          );
          break;
        default:
          if (!QUIET.has(sdk.subtype)) {
            mapping.messages.push(
              systemLine(base, `system.${sdk.subtype}`, sdk.subtype.replace(/_/g, ' '), {
                subtype: sdk.subtype,
              })
            );
          }
      }
      break;
    }

    default:
      if (!QUIET.has(sdk.type)) {
        mapping.messages.push(systemLine(base, `system.${sdk.type}`, sdk.type.replace(/_/g, ' ')));
      }
  }

  return mapping;
}

/** The message optimistically shown for text the user just sent. */
export function localUserMessage(instanceId: string, text: string): Message {
  return {
    id: crypto.randomUUID(),
    instanceId,
    type: 'user',
    content: text,
    timestamp: new Date(),
  };
}

/** A client- or hub-side failure, rendered inline so it cannot be missed. */
export function errorMessage(instanceId: string, text: string): Message {
  return {
    id: crypto.randomUUID(),
    instanceId,
    type: 'ui.error',
    content: text,
    timestamp: new Date(),
  };
}

/** Folds a tool result into the `tool.use` it answers. */
export function applyToolResult(messages: Message[], { toolId, result, isError }: ToolResult): void {
  const target = messages.find((m) => m.type === 'tool.use' && m.metadata?.toolId === toolId);
  if (!target) return;
  target.metadata = {
    ...target.metadata,
    toolResult: result,
    toolStatus: isError ? 'error' : 'success',
  };
}

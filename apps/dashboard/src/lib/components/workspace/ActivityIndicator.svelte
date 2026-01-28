<script lang="ts" module>
  /**
   * Activity state types and logic — shared between ActivityIndicator and parent components.
   */
  import type { MessageCreatedEvent, MessageStreamEvent, InstanceTurnEvent, SdkMessageEvent } from '@agentdeck/core/dashboard';
  import type { Message } from '$lib/stores';

  export type ActivityKey =
    | 'idle'
    | 'starting'
    | 'resuming'
    | 'thinking'
    | 'streaming'
    | 'tool_use'
    | 'permission'
    | 'subagent'
    | 'error'
    | 'success';

  export interface ActivityState {
    key: ActivityKey;
    label: string;
    priority: number;
    subtext?: string;
  }

  export const ACTIVITY_PRIORITY: Record<ActivityKey, number> = {
    error: 100,
    permission: 90,
    tool_use: 80,
    streaming: 70,
    thinking: 60,
    resuming: 50,
    starting: 40,
    subagent: 30,
    success: 10,
    idle: 0,
  };

  const MIN_ACTIVITY_VISIBLE_MS = 600;

  function withEllipsis(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return '';
    if (trimmed.endsWith('...')) return trimmed;
    return `${trimmed.replace(/[.]+$/, '')}...`;
  }

  function formatStatusLabel(status: string): string {
    const trimmed = status.trim();
    if (!trimmed) return '';
    const normalized = trimmed[0].toUpperCase() + trimmed.slice(1);
    return withEllipsis(normalized);
  }

  export type ActivityEvent = MessageCreatedEvent | MessageStreamEvent | InstanceTurnEvent | SdkMessageEvent | null;

  function isInstanceTurnEvent(event: ActivityEvent): event is InstanceTurnEvent {
    return !!event && 'phase' in event;
  }

  function isMessageStreamEvent(event: ActivityEvent): event is MessageStreamEvent {
    return !!event && 'event' in event;
  }

  function isMessageCreatedEvent(event: ActivityEvent): event is MessageCreatedEvent {
    return !!event && 'message' in event && 'createdAt' in event.message;
  }

  function isSdkMessageEvent(event: ActivityEvent): event is SdkMessageEvent {
    return !!event && 'message' in event && !('createdAt' in event.message);
  }

  function activityFromEvent(event: ActivityEvent, fallbackStatus: string | null): ActivityState | null {
    if (!event) return null;

    if (isInstanceTurnEvent(event)) {
      if (event.phase === 'started') {
        return { key: 'thinking', label: 'Thinking...', priority: ACTIVITY_PRIORITY.thinking };
      }
      if (event.isError) {
        return { key: 'error', label: 'Error', priority: ACTIVITY_PRIORITY.error };
      }
      return null;
    }

    if (isMessageStreamEvent(event)) {
      switch (event.event.type) {
        case 'message_start':
        case 'content_block_start':
        case 'content_block_delta':
          return { key: 'streaming', label: 'Streaming response...', priority: ACTIVITY_PRIORITY.streaming };
        case 'message_stop':
          return { key: 'success', label: 'Done', priority: ACTIVITY_PRIORITY.success };
        default:
          return null;
      }
    }

    if (isMessageCreatedEvent(event)) {
      const message = event.message;
      switch (message.type) {
        case 'system.init':
          return { key: 'thinking', label: 'Thinking...', priority: ACTIVITY_PRIORITY.thinking };
        case 'system.status': {
          const meta = message.metadata as { status?: string | null } | null;
          const status = meta?.status ?? fallbackStatus;
          if (!status) return null;
          const lowered = status.toLowerCase();
          if (lowered.includes('auth')) return { key: 'permission', label: formatStatusLabel(status), priority: ACTIVITY_PRIORITY.permission };
          if (lowered.includes('compact')) return { key: 'thinking', label: 'Compacting...', priority: ACTIVITY_PRIORITY.thinking };
          return { key: 'tool_use', label: formatStatusLabel(status), priority: ACTIVITY_PRIORITY.tool_use };
        }
        case 'tool.progress': {
          const meta = message.metadata as { toolName?: string | null; tool_name?: string | null } | null;
          const toolName = meta?.toolName || meta?.tool_name;
          return { key: 'tool_use', label: toolName ? `Running ${toolName}...` : 'Running tool...', priority: ACTIVITY_PRIORITY.tool_use };
        }
        case 'tool.use': {
          const meta = message.metadata as { toolName?: string | null } | null;
          const toolName = meta?.toolName;
          return { key: 'tool_use', label: toolName ? `Running ${toolName}...` : 'Running tool...', priority: ACTIVITY_PRIORITY.tool_use };
        }
        case 'result.success':
          return { key: 'success', label: 'Done', priority: ACTIVITY_PRIORITY.success };
        case 'result.error':
          return { key: 'error', label: 'Error', priority: ACTIVITY_PRIORITY.error };
        default:
          return null;
      }
    }

    if (isSdkMessageEvent(event)) {
      const message = event.message as { type?: string; subtype?: string; tool_name?: string | null; isAuthenticating?: boolean; error?: string | null };
      switch (message.type) {
        case 'system': {
          if (message.subtype === 'compact_boundary') return { key: 'thinking', label: 'Compacting...', priority: ACTIVITY_PRIORITY.thinking };
          if (message.subtype === 'status') {
            const status = fallbackStatus;
            if (status) {
              const lowered = status.toLowerCase();
              if (lowered.includes('auth')) return { key: 'permission', label: formatStatusLabel(status), priority: ACTIVITY_PRIORITY.permission };
              if (lowered.includes('compact')) return { key: 'thinking', label: 'Compacting...', priority: ACTIVITY_PRIORITY.thinking };
              return { key: 'tool_use', label: formatStatusLabel(status), priority: ACTIVITY_PRIORITY.tool_use };
            }
          }
          if (message.subtype === 'init') return { key: 'thinking', label: 'Thinking...', priority: ACTIVITY_PRIORITY.thinking };
          return null;
        }
        case 'tool_progress': {
          const toolName = message.tool_name;
          return { key: 'tool_use', label: toolName ? `Running ${toolName}...` : 'Running tool...', priority: ACTIVITY_PRIORITY.tool_use };
        }
        case 'auth_status': {
          if (message.error) return { key: 'error', label: formatStatusLabel(message.error), priority: ACTIVITY_PRIORITY.error };
          if (message.isAuthenticating) return { key: 'permission', label: 'Authenticating...', priority: ACTIVITY_PRIORITY.permission };
          return null;
        }
        case 'result': {
          if (message.subtype === 'error') return { key: 'error', label: 'Error', priority: ACTIVITY_PRIORITY.error };
          return { key: 'success', label: 'Done', priority: ACTIVITY_PRIORITY.success };
        }
        default:
          return null;
      }
    }

    return null;
  }

  export function deriveActivityState(params: {
    instanceStatus: string | null;
    transientStatus: string | null;
    activityEvent: ActivityEvent;
    isStreaming: boolean;
    isInitializing: boolean;
    isSending: boolean;
    isResuming: boolean;
    activeSubagentCount: number;
    hasPermissionRequests: boolean;
    lastMessage: Message | null;
    error: string | null;
  }): ActivityState {
    const {
      instanceStatus, transientStatus, activityEvent, isStreaming, isInitializing,
      isSending, isResuming, activeSubagentCount, hasPermissionRequests, lastMessage, error,
    } = params;

    if (instanceStatus === 'error' || error) {
      return { key: 'error', label: error ? withEllipsis(`Error: ${error}`) : 'Error', priority: ACTIVITY_PRIORITY.error };
    }
    if (hasPermissionRequests) {
      return { key: 'permission', label: 'Waiting for permission...', priority: ACTIVITY_PRIORITY.permission };
    }

    const eventActivity = activityFromEvent(activityEvent, transientStatus);
    if (eventActivity) return eventActivity;

    if (isStreaming) {
      return { key: 'streaming', label: 'Streaming response...', priority: ACTIVITY_PRIORITY.streaming };
    }
    if (isInitializing) {
      return { key: 'thinking', label: 'Thinking...', priority: ACTIVITY_PRIORITY.thinking };
    }
    if (lastMessage?.type === 'tool.use' && lastMessage?.metadata?.toolStatus === 'pending') {
      const toolName = lastMessage.metadata?.toolName || 'tool';
      return { key: 'tool_use', label: `Running ${toolName}...`, priority: ACTIVITY_PRIORITY.tool_use };
    }
    if (isSending) {
      return { key: 'thinking', label: 'Sending...', priority: ACTIVITY_PRIORITY.thinking };
    }
    if (isResuming) {
      return { key: 'resuming', label: 'Resuming session...', priority: ACTIVITY_PRIORITY.resuming };
    }
    if (instanceStatus === 'starting') {
      return { key: 'starting', label: 'Starting session...', priority: ACTIVITY_PRIORITY.starting };
    }
    if (activeSubagentCount > 0) {
      return { key: 'subagent', label: `Running ${activeSubagentCount} subagent${activeSubagentCount > 1 ? 's' : ''}...`, priority: ACTIVITY_PRIORITY.subagent };
    }

    return { key: 'idle', label: '', priority: ACTIVITY_PRIORITY.idle };
  }
</script>

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { Bot } from 'lucide-svelte';
  import { ActivityGrid } from '$lib/components/ui/activity-grid';

  interface Props {
    activityRaw: ActivityState;
    streamingText: string;
    chunkPulse: boolean;
  }

  let { activityRaw, streamingText, chunkPulse }: Props = $props();

  // Debounced activity display with minimum visible time
  // svelte-ignore state_referenced_locally
  let activityDisplay = $state<ActivityState>(activityRaw);
  let activityHoldUntil = $state(0);
  let activityTick = $state(0);
  let activityTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    void activityTick;
    const next = activityRaw;
    const now = Date.now();

    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }

    const holdActive = activityDisplay.key !== 'idle' && now < activityHoldUntil;
    const isSame =
      next.key === activityDisplay.key &&
      next.label === activityDisplay.label &&
      next.priority === activityDisplay.priority &&
      next.subtext === activityDisplay.subtext;

    if (!isSame) {
      if (next.priority >= activityDisplay.priority || !holdActive) {
        activityDisplay = next;
        activityHoldUntil = next.key === 'idle' ? 0 : now + MIN_ACTIVITY_VISIBLE_MS;
      } else {
        const remaining = activityHoldUntil - now;
        if (remaining > 0) {
          activityTimer = setTimeout(() => { activityTick = Date.now(); }, remaining);
        }
      }
    } else if (next.key === 'idle' && holdActive) {
      const remaining = activityHoldUntil - now;
      if (remaining > 0) {
        activityTimer = setTimeout(() => { activityTick = Date.now(); }, remaining);
      }
    }

    return () => {
      if (activityTimer) {
        clearTimeout(activityTimer);
        activityTimer = null;
      }
    };
  });

  const showIndicator = $derived(activityDisplay.key !== 'idle' || !!streamingText);
</script>

<div
  class="activity-slot {showIndicator ? 'is-visible' : ''}"
  aria-hidden={!showIndicator}
>
  <div class="activity-inner">
    <div class="flex items-start gap-3">
      <!-- Bot Avatar -->
      <div class="shrink-0 w-9 h-9 rounded-xl bg-secondary border border-border flex items-center justify-center mt-0.5">
        <Bot class="w-4.5 h-4.5 text-muted-foreground" />
      </div>
      <!-- Streaming content or activity indicator -->
      {#if streamingText}
        <div class="flex-1 max-w-[85%]">
          <div class="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
            <div class="text-sm text-foreground whitespace-pre-wrap break-words">
              {streamingText}<span class="inline-block w-0.5 h-4 bg-foreground/70 ml-0.5 animate-pulse"></span>
            </div>
          </div>
        </div>
      {:else}
        <div class="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-3">
          <ActivityGrid activity={activityDisplay.key} {chunkPulse} size="sm" />
          {#key activityDisplay.key}
          <span class="text-sm text-muted-foreground" transition:fade={{ duration: 120 }}>
              {activityDisplay.label}
            </span>
          {/key}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .activity-slot {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transform: translateY(6px);
    transition: grid-template-rows 120ms ease, opacity 120ms ease, transform 120ms ease;
  }

  .activity-slot.is-visible {
    grid-template-rows: 1fr;
    opacity: 1;
    transform: translateY(0);
  }

  .activity-slot:not(.is-visible) {
    pointer-events: none;
  }

  .activity-inner {
    overflow: hidden;
  }

  :global(.space-y-4) > .activity-slot {
    margin-top: 0 !important;
  }

  :global(.space-y-4) > .activity-slot.is-visible {
    margin-top: 1rem !important;
  }
</style>

<script lang="ts">
  import { User, Bot, Wrench, FileText, AlertCircle, ChevronDown, ChevronRight, Copy, Check, Loader2, CheckCircle2, XCircle, Settings } from 'lucide-svelte';
  import { formatTimestamp } from '$lib/utils/time';
  import type { Message } from '$lib/stores/realtime';

  interface Props {
    message: Message;
    showTimestamp?: boolean;
  }

  let { message, showTimestamp = false }: Props = $props();

  let isExpanded = $state(false);
  let copied = $state(false);

  // Get tool info from metadata or parse from content (backwards compatibility)
  const toolInfo = $derived(() => {
    if (message.type !== 'tool_use' && message.type !== 'tool_result') return null;

    // Use metadata if available (new format)
    if (message.metadata?.toolName) {
      return {
        name: message.metadata.toolName,
        id: message.metadata.toolId,
        input: message.metadata.toolInput,
        result: message.metadata.toolResult,
        status: message.metadata.toolStatus || 'pending',
      };
    }

    // Fallback: parse from content (old format)
    try {
      const parsed = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
      return {
        name: parsed?.name || 'Tool',
        id: parsed?.id,
        input: parsed?.input || parsed,
        result: null,
        status: 'success' as const,
      };
    } catch {
      return { name: 'Tool', input: message.content, result: null, status: 'success' as const };
    }
  });

  async function copyContent() {
    await navigator.clipboard.writeText(message.content);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  const messageConfig = {
    user: {
      align: 'justify-end',
      bubble: 'chat-bubble chat-bubble-user',
      icon: User,
      iconBg: 'bg-primary',
    },
    assistant: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-assistant',
      icon: Bot,
      iconBg: 'bg-secondary',
    },
    tool_use: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-tool',
      icon: Wrench,
      iconBg: 'bg-warning-light',
    },
    tool_result: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-tool',
      icon: FileText,
      iconBg: 'bg-success-light',
    },
    error: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-error',
      icon: AlertCircle,
      iconBg: 'bg-error-light',
    },
    system: {
      align: 'justify-center',
      bubble: 'text-xs text-text-muted py-2 px-4 bg-surface-hover/50 rounded-full inline-flex items-center gap-2',
      icon: Settings,
      iconBg: 'bg-surface-hover',
    },
  };

  const config = $derived(messageConfig[message.type] || messageConfig.assistant);
</script>

<div class="flex {config.align} gap-3 group animate-fade-in-up">
  {#if message.type !== 'user' && message.type !== 'system'}
    <!-- Avatar -->
    <div class="flex-shrink-0 w-8 h-8 rounded-lg {config.iconBg} flex items-center justify-center">
      <config.icon class="w-4 h-4 {message.type === 'error' ? 'text-error' : 'text-text-secondary'}" />
    </div>
  {/if}

  <!-- Message Content -->
  <div class="flex flex-col gap-1 {message.type === 'user' ? 'items-end' : 'items-start'} max-w-[85%]">
    {#if message.type === 'tool_use' || message.type === 'tool_result'}
      <!-- Tool message - collapsible -->
      <button
        class="{config.bubble} w-full text-left cursor-pointer hover:bg-surface-active transition-colors"
        onclick={() => isExpanded = !isExpanded}
      >
        <div class="flex items-center gap-2">
          {#if isExpanded}
            <ChevronDown class="w-4 h-4 text-text-muted flex-shrink-0" />
          {:else}
            <ChevronRight class="w-4 h-4 text-text-muted flex-shrink-0" />
          {/if}
          <span class="font-medium text-text">
            {toolInfo()?.name || 'Tool'}
          </span>
          <!-- Status indicator -->
          {#if toolInfo()?.status === 'pending'}
            <Loader2 class="w-4 h-4 text-warning animate-spin" />
          {:else if toolInfo()?.status === 'error'}
            <XCircle class="w-4 h-4 text-error" />
          {:else}
            <CheckCircle2 class="w-4 h-4 text-success" />
          {/if}
        </div>
      </button>

      {#if isExpanded}
        {@const tool = toolInfo()}
        <div class="w-full space-y-2 mt-1">
          <!-- Input -->
          <div class="bg-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto border border-border">
            <div class="text-text-muted text-[10px] uppercase tracking-wide mb-1">Input</div>
            <pre class="whitespace-pre-wrap break-all text-text-secondary">{JSON.stringify(tool?.input, null, 2)}</pre>
          </div>

          <!-- Result (if available) -->
          {#if tool?.result !== undefined && tool?.result !== null}
            <div class="bg-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto border border-border {tool?.status === 'error' ? 'border-error/30 bg-error/5' : 'border-success/30 bg-success/5'}">
              <div class="text-text-muted text-[10px] uppercase tracking-wide mb-1">
                {tool?.status === 'error' ? 'Error' : 'Result'}
              </div>
              <pre class="whitespace-pre-wrap break-all text-text-secondary">{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
            </div>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'system'}
      <!-- System message - subtle banner -->
      <div class="{config.bubble}">
        <Settings class="w-3 h-3" />
        <span>{message.content}</span>
      </div>
    {:else}
      <!-- Regular message -->
      <div class="{config.bubble} relative">
        <div class="prose prose-sm max-w-none {message.type === 'user' ? 'prose-invert' : ''}">
          {message.content}
        </div>

        <!-- Copy button -->
        <button
          class="absolute -right-2 -top-2 p-1.5 rounded-md bg-surface border border-border shadow-sm
                 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-hover"
          onclick={copyContent}
          title="Copy message"
        >
          {#if copied}
            <Check class="w-3.5 h-3.5 text-success" />
          {:else}
            <Copy class="w-3.5 h-3.5 text-text-muted" />
          {/if}
        </button>
      </div>
    {/if}

    <!-- Timestamp -->
    {#if showTimestamp && message.timestamp}
      <span class="text-[10px] text-text-muted mt-0.5">
        {formatTimestamp(new Date(message.timestamp))}
      </span>
    {/if}
  </div>

  {#if message.type === 'user'}
    <!-- User Avatar -->
    <div class="flex-shrink-0 w-8 h-8 rounded-lg {config.iconBg} flex items-center justify-center">
      <config.icon class="w-4 h-4 text-white" />
    </div>
  {/if}
</div>

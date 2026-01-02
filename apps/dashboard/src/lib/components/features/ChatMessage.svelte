<script lang="ts">
  import { User, Bot, Wrench, FileText, AlertCircle, ChevronDown, ChevronRight, Copy, Check } from 'lucide-svelte';
  import { formatTimestamp } from '$lib/utils/time';
  import type { Message } from '$lib/stores/realtime';

  interface Props {
    message: Message;
    showTimestamp?: boolean;
  }

  let { message, showTimestamp = false }: Props = $props();

  let isExpanded = $state(false);
  let copied = $state(false);

  // Parse tool content if it's JSON
  const toolContent = $derived(() => {
    if (message.type !== 'tool_use' && message.type !== 'tool_result') return null;
    try {
      return typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
    } catch {
      return { raw: message.content };
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
      bubble: 'text-xs text-text-muted py-2',
      icon: Bot,
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
            {message.type === 'tool_use' ? 'Tool Call' : 'Tool Result'}
          </span>
          {#if toolContent()?.name}
            <span class="text-text-secondary">: {toolContent().name}</span>
          {/if}
        </div>
      </button>

      {#if isExpanded}
        <div class="w-full bg-bg-subtle rounded-lg p-3 mt-1 font-mono text-xs overflow-x-auto border border-border">
          <pre class="whitespace-pre-wrap break-all text-text-secondary">{JSON.stringify(toolContent(), null, 2)}</pre>
        </div>
      {/if}
    {:else if message.type === 'system'}
      <!-- System message -->
      <div class="{config.bubble}">
        {message.content}
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

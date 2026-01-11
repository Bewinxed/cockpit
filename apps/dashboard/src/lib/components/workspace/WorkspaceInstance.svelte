<script lang="ts">
  import { ArrowDown } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import InstanceHeader from './InstanceHeader.svelte';
  import ChatMessage from '../features/ChatMessage.svelte';
  import ChatInput from '../features/ChatInput.svelte';
  import PermissionRequest from '../features/PermissionRequest.svelte';
  import { UseAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
  import {
    instances,
    getInstanceMessages,
    getInstancePermissions,
    getStreamingState,
    addMessage,
    updateStreamingState
  } from '$lib/stores/realtime.svelte';
  import { api } from '$lib/api';

  interface Props {
    instanceId: string;
  }

  let { instanceId }: Props = $props();

  // Reactive stores for this instance - note: these need to be recreated when instanceId changes
  const instance = $derived($instances.get(instanceId));

  // Create stores that react to instanceId changes
  let messagesStore = $derived.by(() => getInstanceMessages(instanceId));
  let permissionsStore = $derived.by(() => getInstancePermissions(instanceId));
  let streamingStateStore = $derived.by(() => getStreamingState(instanceId));

  // Auto-scroll hook
  const autoScroll = new UseAutoScroll();
  let shouldAutoScroll = $state(true);
  let messagesContainer: HTMLDivElement | null = $state(null);

  // Bind the ref when container mounts
  $effect(() => {
    if (messagesContainer) {
      autoScroll.ref = messagesContainer;
    }
  });

  // Update shouldAutoScroll based on the hook's state
  $effect(() => {
    shouldAutoScroll = autoScroll.isAtBottom;
  });

  // Default commands available for the chat input
  const defaultCommands = [
    { name: 'help', type: 'builtin' as const, description: 'Show available commands' },
    { name: 'model', type: 'builtin' as const, description: 'Change the model' },
    { name: 'memory', type: 'builtin' as const, description: 'Edit project/user memory' },
    { name: 'clear', type: 'builtin' as const, description: 'Clear conversation' },
    { name: 'compact', type: 'builtin' as const, description: 'Compact context' },
  ];

  // Send message handler
  async function handleSend(content: string) {
    if (!instance) return;

    // Add message optimistically
    addMessage(instanceId, {
      type: 'user',
      content,
      timestamp: new Date(),
    });

    // Set streaming state immediately
    updateStreamingState(instanceId, { isStreaming: true });

    try {
      // Check if instance needs to be resumed
      if (instance.status === 'sleeping' || instance.status === 'stopped') {
        await api.api.instances({ id: instanceId }).resume.post({
          prompt: content,
        });
      } else {
        await api.api.instances({ id: instanceId }).send.post({
          message: content,
        });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Reset streaming state on error since SSE won't arrive
      updateStreamingState(instanceId, { isStreaming: false });

      addMessage(instanceId, {
        type: 'error',
        content: error instanceof Error ? error.message : 'Failed to send message',
        timestamp: new Date(),
      });
    }
  }

  // Interrupt handler
  async function handleInterrupt() {
    if (!instance) return;

    try {
      await api.api.instances({ id: instanceId }).interrupt.post();
    } catch (error) {
      console.error('Failed to interrupt:', error);
    }
  }

  function scrollToBottom() {
    autoScroll.scrollToBottom(false);
  }
</script>

<div class="flex-1 flex flex-col overflow-hidden relative">
  <!-- Instance Header -->
  {#if instance}
    <InstanceHeader {instance} />
  {/if}

  <!-- Messages Area -->
  <div
    class="flex-1 overflow-y-auto"
    bind:this={messagesContainer}
  >
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {#each $messagesStore as message (message.id || message.timestamp)}
        <ChatMessage {message} />
      {/each}

      <!-- Streaming Indicator -->
      {#if $streamingStateStore?.isStreaming}
        <div class="flex items-center gap-2 text-muted-foreground py-2">
          <div class="flex gap-1">
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" style="animation-delay: 0ms"></div>
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" style="animation-delay: 150ms"></div>
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" style="animation-delay: 300ms"></div>
          </div>
          <span class="text-sm">Claude is thinking...</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Permission Requests (above input) -->
  {#if $permissionsStore.length > 0}
    <div class="border-t border-border bg-warning/5 px-4 py-3">
      {#each $permissionsStore as permission (permission.requestId)}
        <PermissionRequest request={permission} />
      {/each}
    </div>
  {/if}

  <!-- Jump to Present Button -->
  {#if !shouldAutoScroll}
    <Button
      variant="default"
      size="sm"
      class="absolute bottom-20 right-8 rounded-full shadow-lg z-10 gap-1.5"
      onclick={scrollToBottom}
    >
      <ArrowDown class="size-4" />
      Jump to present
    </Button>
  {/if}

  <!-- Chat Input -->
  <div class="border-t border-border bg-card p-4">
    <div class="max-w-3xl mx-auto">
      <ChatInput
        disabled={!instance || instance.status === 'error'}
        loading={instance?.status === 'starting'}
        streaming={$streamingStateStore?.isStreaming ?? false}
        commands={defaultCommands}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        placeholder={
          instance?.status === 'sleeping'
            ? 'Send a message to resume...'
            : instance?.status === 'stopped'
            ? 'Send a message to restart...'
            : 'Type a message...'
        }
      />
    </div>
  </div>
</div>

<script lang="ts">
  /**
   * WorkspaceInstance — thin orchestrator for a single instance tab.
   *
   * Delegates to:
   *  - MessageList.svelte — message rendering & grouping
   *  - ActivityIndicator.svelte — activity state machine + visual
   *  - client-commands.ts — /help, /login, /model, /memory, /clear, /vim, /terminal-setup
   *  - instance-actions.ts — send, interrupt, edit, question handlers
   */
  import { fade } from 'svelte/transition';
  import { ArrowDown, LoaderCircle } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import InstanceHeader from './InstanceHeader.svelte';
  import MessageList from './MessageList.svelte';
  import { PermissionRequest } from '$lib/components/features';
  import { ChatInput } from '$lib/components/features';
  import { createAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
  import {
    instances,
    permissions as permissionsStore,
    updateInstancePreferences,
    setInstanceThinking,
    ui,
    type Message,
  } from '$lib/stores';
  import { api } from '$lib/api';
  import { mapApiMessages } from '$lib/utils/message-mapper';
  import { deriveActivityState } from './ActivityIndicator.svelte';
  import type { ActivityEvent } from './ActivityIndicator.svelte';
  import {
    DEFAULT_COMMANDS,
    isClientCommand,
    isOAuthCode,
    fetchCommands,
    handleLoginSubmit as doLoginSubmit,
    handleClientCommand as doClientCommand,
    handleModelSelect as doModelSelect,
    handleMemorySelect as doMemorySelect,
    handleMemorySave as doMemorySave,
    type AvailableCommand,
  } from './client-commands';
  import {
    sendMessage,
    resumeAndSend,
    fallbackResume,
    editMessage,
    interruptInstance,
    submitQuestionResponse,
    cancelQuestion,
  } from './instance-actions';

  // ============================================
  // Props
  // ============================================

  interface Props {
    instanceId: string;
    ssrMessages?: import('@agentdeck/core/dashboard').CanonicalMessage[];
    isLoadingMessages?: boolean;
  }

  let { instanceId, ssrMessages: ssrMessagesRaw = [], isLoadingMessages = false }: Props = $props();

  // Map raw API messages to UI format (pure function)
  function mapToUIMessages(raw: typeof ssrMessagesRaw): Message[] {
    if (!raw?.length) return [];
    const { parsed } = mapApiMessages(instanceId, raw);
    return parsed;
  }

  // Initialize store from SSR data on mount
  if (ssrMessagesRaw.length > 0) {
    instances.initializeMessagesFromSSR(instanceId, ssrMessagesRaw);
  }

  // ============================================
  // Store-derived state
  // ============================================

  const instance = $derived(instances.get(instanceId));
  // Use store messages if available (after hydration + WS updates), else SSR data
  const ssrMessages = $derived(mapToUIMessages(ssrMessagesRaw));
  const storeMessages = $derived(instances.getMessages(instanceId));
  const currentMessages = $derived(storeMessages.length > 0 ? storeMessages : ssrMessages);
  const currentPermissions = $derived(permissionsStore.getByInstance(instanceId));
  const streamingState = $derived(instances.getStreamingState(instanceId));
  const streamingMessage = $derived(instances.getStreamingMessage(instanceId));
  const transientStatus = $derived(instances.getStatus(instanceId));
  const activityEvent = $derived(instances.getActivityEvent(instanceId));
  const activeSubagentCount = $derived(instances.getActiveSubagentsForInstance(instanceId).length);
  const viewMode = $derived(ui.getViewMode(instanceId));

  // ============================================
  // Local UI state
  // ============================================

  let sending = $state(false);
  let restarting = $state(false);
  let interrupting = $state(false);
  let error = $state<string | null>(null);
  let pendingOAuthState = $state<string | null>(null);
  let pendingModelPickerIndex = $state<number | null>(null);
  let pendingMemoryPickerIndex = $state<number | null>(null);
  let commands = $state<AvailableCommand[]>(DEFAULT_COMMANDS);
  let commandsFetched = $state(false);

  // Keep the last prompt contents rendered while the dock panel animates closed
  let displayedPermissions: typeof currentPermissions = $state([]);
  $effect(() => {
    if (currentPermissions.length > 0) displayedPermissions = currentPermissions;
  });

  const isStreaming = $derived(streamingState?.isStreaming ?? false);
  const isInitializing = $derived(streamingState?.isInitializing ?? false);
  const isActive = $derived(instance?.status === 'running' || instance?.status === 'starting');
  const hasPermissionRequests = $derived(currentPermissions.length > 0);
  const lastMessage = $derived.by(() =>
    storeMessages && storeMessages.length > 0 ? storeMessages[storeMessages.length - 1] : null
  );

  // ============================================
  // Streaming text accumulation
  // ============================================

  const streamingText = $derived.by(() => {
    const msg = streamingMessage;
    if (!msg || !msg.contentBlocks) return '';
    const texts: string[] = [];
    const sortedIndices = Array.from(msg.contentBlocks.keys()).sort((a: number, b: number) => a - b);
    for (const idx of sortedIndices) {
      texts.push(msg.contentBlocks.get(idx) || '');
    }
    return texts.join('');
  });

  // ============================================
  // Chunk pulse (visual feedback for streaming)
  // ============================================

  let chunkPulse = $state(false);
  let chunkTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
    if (!streamingState?.isStreaming || !streamingState?.lastChunkAt) {
      chunkPulse = false;
      return;
    }
    const last = streamingState.lastChunkAt instanceof Date
      ? streamingState.lastChunkAt.getTime()
      : new Date(streamingState.lastChunkAt).getTime();
    const remaining = 500 - (Date.now() - last);
    if (remaining > 0) {
      chunkPulse = true;
      chunkTimer = setTimeout(() => { chunkPulse = false; }, remaining);
    } else {
      chunkPulse = false;
    }
    return () => { if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; } };
  });

  // ============================================
  // Activity state (derived, fed to ActivityIndicator)
  // ============================================

  const activityRaw = $derived.by(() =>
    deriveActivityState({
      instanceStatus: instance?.status ?? null,
      transientStatus,
      activityEvent: activityEvent as ActivityEvent,
      isStreaming,
      isInitializing,
      isSending: sending,
      isResuming: restarting,
      activeSubagentCount,
      hasPermissionRequests,
      lastMessage,
      error,
    })
  );


  // ============================================
  // Command fetching
  // ============================================

  $effect(() => {
    const isRunning = instance && instance.status === 'running';
    if (isRunning && !commandsFetched) {
      commandsFetched = true;
      fetchCommands(instanceId, commands).then(c => { commands = c; });
    } else if (!isRunning) {
      commandsFetched = false;
    }
  });

  // ============================================
  // Resuming state sync
  // ============================================

  const storeIsResuming = $derived(instances.isResuming(instanceId));

  $effect(() => {
    if (!storeIsResuming && restarting) {
      restarting = false;
    }
  });

  // ============================================
  // Auto-scroll
  // ============================================

  const autoScroll = createAutoScroll();

  $effect(() => {
    const _msgCount = storeMessages.length;
    const _streaming = streamingText;
    requestAnimationFrame(() => { autoScroll.scrollToBottom(); });
  });

  // ============================================
  // Keyboard shortcut: Ctrl/Cmd+G to toggle view mode
  // ============================================

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault();
      const currentMode = ui.getViewMode(instanceId);
      updateInstancePreferences({ instanceId, viewMode: currentMode === 'flow' ? 'chat' : 'flow' });
    }
    // Alt+T: Cycle thinking mode (off -> think -> ultrathink)
    if (e.altKey && e.key === 't') {
      e.preventDefault();
      if (instance) {
        const modes = ['off', 'think', 'ultrathink'] as const;
        const current = instance.thinkingMode ?? 'ultrathink';
        const idx = modes.indexOf(current as typeof modes[number]);
        const next = modes[(idx + 1) % modes.length];
        const isLive = instance.status === 'running' || instance.status === 'starting';
        instances.setThinkingMode(instanceId, next);
        if (isLive) {
          setInstanceThinking({ instanceId, mode: next }).catch((err) => {
            console.error('Failed to set thinking mode:', err);
            instances.setThinkingMode(instanceId, current as typeof modes[number]);
          });
        }
      }
    }
  }

  // ============================================
  // Callback handlers (wire extracted modules to UI)
  // ============================================

  // svelte-ignore state_referenced_locally
  let currentModel = $state<string | undefined>(instance?.model);

  async function onLoginSubmit(code: string): Promise<void> {
    if (!pendingOAuthState) throw new Error('No pending login. Please run /login first.');
    await doLoginSubmit(instanceId, code, pendingOAuthState);
    pendingOAuthState = null;
  }

  function onLoginCancel() {
    pendingOAuthState = null;
    instances.addMessage(instanceId, {
      type: 'system.notice',
      content: 'Login cancelled.',
      timestamp: new Date(),
    });
  }

  async function onModelSelect(model: string): Promise<void> {
    await doModelSelect(instanceId, model, pendingModelPickerIndex);
    currentModel = model;
    pendingModelPickerIndex = null;
  }

  function onModelCancel() {
    pendingModelPickerIndex = null;
  }

  async function onMemorySelect(memoryType: 'project' | 'user'): Promise<void> {
    if (pendingMemoryPickerIndex === null) return;
    await doMemorySelect(instanceId, memoryType, pendingMemoryPickerIndex);
  }

  async function onMemorySave(content: string): Promise<void> {
    if (pendingMemoryPickerIndex === null) return;
    await doMemorySave(instanceId, content, storeMessages, pendingMemoryPickerIndex);
    pendingMemoryPickerIndex = null;
  }

  function onMemoryCancel() {
    pendingMemoryPickerIndex = null;
  }

  async function onQuestionSubmit(requestId: string, answers: Record<string, string>): Promise<void> {
    await submitQuestionResponse(instanceId, requestId, answers);
  }

  function onQuestionCancel() {
    cancelQuestion(instanceId);
  }

  async function onEditMessage(messageId: string, newContent: string): Promise<void> {
    restarting = true;
    const result = await editMessage(instanceId, messageId, newContent, storeMessages);
    if (result.error) {
      error = result.error;
    }
    restarting = false;
  }

  // ============================================
  // Session recovery (invalid session)
  // ============================================

  /**
   * Serialize the full conversation history for session reconstruction.
   * Includes user messages, assistant responses, tool uses/results — everything.
   */
  function buildConversationTranscript(msgs: Message[]): string {
    const relevant = msgs.filter(m =>
      m.type === 'user' ||
      m.type === 'assistant' ||
      m.type === 'tool.use' ||
      m.type === 'tool.result' ||
      m.type === 'thinking' ||
      m.type === 'result.success' ||
      m.type === 'result.error'
    );

    const lines: string[] = [];
    for (const m of relevant) {
      switch (m.type) {
        case 'user':
          lines.push(`[User]\n${m.content}`);
          break;
        case 'assistant':
          lines.push(`[Assistant]\n${m.content}`);
          break;
        case 'thinking':
          lines.push(`[Thinking]\n${m.content}`);
          break;
        case 'tool.use': {
          const toolName = m.metadata?.toolName || 'unknown';
          const input = m.metadata?.toolInput;
          const inputStr = input ? JSON.stringify(input, null, 2) : '';
          lines.push(`[Tool Use: ${toolName}]\n${inputStr}`);
          break;
        }
        case 'tool.result': {
          const result = m.metadata?.toolResult;
          const resultStr = typeof result === 'string' ? result : result ? JSON.stringify(result, null, 2) : m.content;
          lines.push(`[Tool Result]\n${resultStr}`);
          break;
        }
        case 'result.success':
          lines.push(`[Turn Complete]`);
          break;
        case 'result.error':
          lines.push(`[Turn Error]\n${m.content}`);
          break;
      }
    }
    return lines.join('\n\n');
  }

  async function onResetSession(): Promise<void> {
    try {
      // 1. Clear the invalid sdkSessionId
      await api.api.instances({ id: instanceId })['reset-session'].post({});

      // 2. Build full conversation transcript to inject as context
      const transcript = buildConversationTranscript(storeMessages);
      const contextPrompt = transcript
        ? `<system-reminder>\nThis is a continuation of a previous conversation. The SDK session data was lost, so this is a fresh session.\nBelow is the full conversation history from the previous session. Continue naturally from where we left off.\n\n${transcript}\n</system-reminder>\n\nThe previous session was recovered. Please acknowledge briefly and continue.`
        : 'Continue from where we left off.';

      // 3. Resume (spawns fresh since sdkSessionId is now cleared)
      const result = await resumeAndSend(instanceId, contextPrompt);
      if (result.error) {
        instances.addMessage(instanceId, {
          type: 'ui.error',
          content: `Failed to start fresh session: ${result.error}`,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      instances.addMessage(instanceId, {
        type: 'ui.error',
        content: `Failed to reset session: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    }
  }

  function onDownloadTranscript(): void {
    const transcript = buildConversationTranscript(storeMessages);
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${instanceId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================
  // Send message (main handler)
  // ============================================

  async function handleSend(message: string) {
    if (!instance || sending || restarting) return;
    error = null;

    // OAuth code paste
    if (isOAuthCode(message)) {
      instances.addMessage(instanceId, { type: 'user', content: message, timestamp: new Date() });
      if (pendingOAuthState) {
        try {
          await doLoginSubmit(instanceId, message, pendingOAuthState);
          pendingOAuthState = null;
        } catch (err) {
          instances.addMessage(instanceId, {
            type: 'ui.error',
            content: `Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: new Date(),
          });
        }
      }
      return;
    }

    // Client-side command check
    const clientCmd = isClientCommand(message);
    const LOCAL_ONLY_COMMANDS = ['/help', '/login', '/logout', '/clear', '/vim', '/terminal-setup'] as const;
    const needsInstance = clientCmd && !LOCAL_ONLY_COMMANDS.includes(clientCmd as typeof LOCAL_ONLY_COMMANDS[number]);

    // Auto-resume if needed
    if (!isActive && (needsInstance || !clientCmd)) {
      restarting = true;
      instances.setResuming(instanceId, true);

      if (!clientCmd) {
        instances.addMessage(instanceId, { type: 'user', content: message, timestamp: new Date() });
        autoScroll.scrollToBottom(true);
      }

      const result = await resumeAndSend(instanceId, clientCmd ? '' : message);
      if (result.error) {
        error = result.error;
        instances.setResuming(instanceId, false);
        restarting = false;
        return;
      }

      if (!clientCmd) return; // Keep restarting=true until WS event
    }

    // Handle client-side commands
    if (clientCmd) {
      if (isActive) {
        instances.addMessage(instanceId, { type: 'user', content: message, timestamp: new Date() });
      }
      const cmdResult = await doClientCommand(clientCmd, {
        instanceId,
        instance,
        commands,
        isActive,
        currentMessages: storeMessages,
      });
      if (cmdResult.commands) commands = cmdResult.commands;
      if (cmdResult.pendingModelPickerIndex !== undefined) pendingModelPickerIndex = cmdResult.pendingModelPickerIndex;
      if (cmdResult.pendingMemoryPickerIndex !== undefined) pendingMemoryPickerIndex = cmdResult.pendingMemoryPickerIndex;
      return;
    }

    // Send message normally
    sending = true;
    instances.addMessage(instanceId, { type: 'user', content: message, timestamp: new Date() });
    autoScroll.scrollToBottom(true);

    const result = await sendMessage(instanceId, message);
    if (result.needsResume) {
      sending = false;
      restarting = true;
      instances.setResuming(instanceId, true);
      const resumeResult = await fallbackResume(instanceId, message);
      if (resumeResult.error) {
        error = resumeResult.error;
        instances.setResuming(instanceId, false);
        restarting = false;
      }
    } else if (result.error) {
      error = result.error;
      instances.updateStreamingState(instanceId, { isStreaming: false, isInitializing: false });
    }
    sending = false;
  }

  // Interrupt handler
  async function handleInterrupt() {
    if (!instance || interrupting) return;
    interrupting = true;
    error = null;
    const result = await interruptInstance(instanceId);
    if (result.error) error = result.error;
    interrupting = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex-1 flex flex-col overflow-hidden relative">
  <!-- Instance Header -->
  {#if instance}
    <InstanceHeader {instance} />
  {/if}

  <!-- View Mode: Flow or Chat -->
  {#if viewMode === 'flow'}
    <div class="flex-1 overflow-hidden" transition:fade={{ duration: 150 }}>
      {#await import('$lib/components/features/flow') then { FlowView }}
        <FlowView {instanceId} />
      {/await}
    </div>
  {:else}
    <!-- Chat View — flex-col-reverse so the browser scrolls to bottom before JS loads -->
    <div
      class="flex-1 overflow-y-auto scroll-smooth flex flex-col-reverse"
      bind:this={autoScroll.ref}
      onscroll={autoScroll.onScroll}
      transition:fade={{ duration: 150 }}
    >
      <div class="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <MessageList
          {instanceId}
          messages={currentMessages}
          {isLoadingMessages}
          {isActive}
          {streamingText}
          {activityRaw}
          {chunkPulse}
          {onLoginSubmit}
          {onLoginCancel}
          {onModelSelect}
          {onModelCancel}
          {onMemorySelect}
          {onMemorySave}
          {onMemoryCancel}
          {onQuestionSubmit}
          {onQuestionCancel}
          {onEditMessage}
          {onResetSession}
          {onDownloadTranscript}
          {pendingOAuthState}
          {pendingModelPickerIndex}
          {pendingMemoryPickerIndex}
        />
      </div>
    </div>
  {/if}

  <!-- Jump to Present -->
  {#if autoScroll.userHasScrolled}
    <Button
      variant="default"
      size="sm"
      class="absolute bottom-20 right-8 rounded-full shadow-lg z-10 gap-1.5"
      onclick={() => autoScroll.scrollToBottom(true)}
    >
      <ArrowDown class="size-4" />
      Jump to present
    </Button>
  {/if}

  <!-- Floating dock — input card plus the prompt panel that slides up out of it -->
  <div class="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
    <div class="max-w-4xl mx-auto relative">

      {#if error}
        <div class="mb-2 rounded-xl border border-error/30 bg-card shadow-lg px-3 py-2 flex items-center justify-between">
          <span class="text-sm text-error">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            class="text-error hover:text-error"
            onclick={() => error = null}
          >
            Dismiss
          </Button>
        </div>
      {/if}

      {#if transientStatus}
        <div class="mb-2 rounded-xl border border-border bg-card shadow-lg px-3 py-2 flex items-center gap-2">
          <LoaderCircle class="size-4 animate-spin text-warning" />
          <span class="text-sm text-warning capitalize">{transientStatus}...</span>
        </div>
      {/if}

      <ChatInput
        disabled={!instance}
        loading={sending || restarting}
        streaming={isStreaming}
        {commands}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        attachmentOpen={hasPermissionRequests}
        placeholder={
          restarting
            ? 'Resuming session...'
            : instance?.status === 'sleeping'
            ? 'Send a message to resume...'
            : instance?.status === 'stopped'
            ? 'Send a message to restart...'
            : isStreaming
            ? 'Claude is responding... (⌘↵ to interrupt)'
            : 'Ask Claude anything... (⌘↵ to send)'
        }
      >
        {#snippet attachment()}
          <div class="divide-y divide-border/60">
            {#each displayedPermissions as permission (permission.requestId)}
              <PermissionRequest request={permission} />
            {/each}
          </div>
        {/snippet}
      </ChatInput>
    </div>
  </div>
</div>

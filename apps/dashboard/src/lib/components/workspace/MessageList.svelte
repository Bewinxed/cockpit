<script lang="ts">
  /**
   * MessageList — filters, groups, and renders messages for an instance.
   */
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { LoaderCircle } from 'lucide-svelte';
  import { ChatMessage, ToolGroup, SubagentBranch } from '$lib/components/features';
  import { instances, questions as questionsStore, type Message } from '$lib/stores';
  import type { ActivityState } from './ActivityIndicator.svelte';
  import ActivityIndicator from './ActivityIndicator.svelte';

  interface Props {
    instanceId: string;
    messages: Message[];
    isLoadingMessages: boolean;
    isActive: boolean;
    streamingText: string;
    activityRaw: ActivityState;
    chunkPulse: boolean;
    // Callback handlers
    onLoginSubmit: (code: string) => Promise<void>;
    onLoginCancel: () => void;
    onModelSelect: (model: string) => Promise<void>;
    onModelCancel: () => void;
    onMemorySelect: (type: 'project' | 'user') => Promise<void>;
    onMemorySave: (content: string) => Promise<void>;
    onMemoryCancel: () => void;
    onQuestionSubmit: (requestId: string, answers: Record<string, string>) => Promise<void>;
    onQuestionCancel: () => void;
    onEditMessage: (messageId: string, newContent: string) => Promise<void>;
    onResetSession?: () => Promise<void>;
    onDownloadTranscript?: () => void;
    // Active state for inline editors
    pendingOAuthState: string | null;
    pendingModelPickerIndex: number | null;
    pendingMemoryPickerIndex: number | null;
  }

  let {
    instanceId,
    messages,
    isLoadingMessages,
    isActive,
    streamingText,
    activityRaw,
    chunkPulse,
    onLoginSubmit,
    onLoginCancel,
    onModelSelect,
    onModelCancel,
    onMemorySelect,
    onMemorySave,
    onMemoryCancel,
    onQuestionSubmit,
    onQuestionCancel,
    onEditMessage,
    onResetSession,
    onDownloadTranscript,
    pendingOAuthState,
    pendingModelPickerIndex,
    pendingMemoryPickerIndex,
  }: Props = $props();

  // ============================================
  // Message filtering helpers
  // ============================================

  function isTaskToolUse(msg: Message): boolean {
    return msg.type === 'tool.use' && !!msg.metadata?.subagentType;
  }

  function isTaskOutputTool(msg: Message): boolean {
    return msg.type === 'tool.use' && msg.metadata?.toolName === 'TaskOutput';
  }

  function isAskUserQuestion(msg: Message): boolean {
    return (msg.type === 'tool.use' || msg.type === 'tool.result') && msg.metadata?.toolName === 'AskUserQuestion';
  }

  function isSubagentMessage(msg: Message): boolean {
    return !!msg.parentToolUseId;
  }

  // Filtered messages (no TaskOutput, no subagent children)
  const chatMessages = $derived(
    messages.filter(msg => !isTaskOutputTool(msg) && !isSubagentMessage(msg))
  );

  // ============================================
  // Message grouping
  // ============================================

  type MessageGroup =
    | { type: 'single'; message: Message; index: number }
    | { type: 'tool_group'; messages: Message[]; startIndex: number }
    | { type: 'subagent_group'; messages: Message[]; startIndex: number };

  const groupedMessages = $derived.by((): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < chatMessages.length) {
      const msg = chatMessages[i];

      if (isTaskToolUse(msg)) {
        const subagentMessages: Message[] = [msg];
        const startIndex = i;
        i++;
        while (i < chatMessages.length && isTaskToolUse(chatMessages[i])) {
          subagentMessages.push(chatMessages[i]);
          i++;
        }
        groups.push({ type: 'subagent_group', messages: subagentMessages, startIndex });
      } else if (isAskUserQuestion(msg)) {
        groups.push({ type: 'single', message: msg, index: i });
        i++;
      } else if (msg.type === 'tool.use' || msg.type === 'tool.result') {
        const toolMessages: Message[] = [msg];
        const startIndex = i;
        i++;
        while (i < chatMessages.length) {
          const nextMsg = chatMessages[i];
          if ((nextMsg.type === 'tool.use' || nextMsg.type === 'tool.result') && !isTaskToolUse(nextMsg) && !isTaskOutputTool(nextMsg) && !isAskUserQuestion(nextMsg)) {
            toolMessages.push(nextMsg);
            i++;
          } else {
            break;
          }
        }
        groups.push({ type: 'tool_group', messages: toolMessages, startIndex });
      } else {
        groups.push({ type: 'single', message: msg, index: i });
        i++;
      }
    }

    return groups;
  });
</script>

<!-- Loading state -->
{#if isLoadingMessages && chatMessages.length === 0}
  <div class="flex items-center justify-center py-8 text-muted-foreground">
    <LoaderCircle class="size-5 animate-spin mr-2" />
    <span class="text-sm">Loading messages...</span>
  </div>
{:else if chatMessages.length === 0}
  <!-- Empty state -->
  <div class="flex flex-col items-center justify-center py-12 text-center">
    <div class="text-muted-foreground text-sm">
      {isActive
        ? "What project are we working on today?"
        : "Send a message to start the conversation."}
    </div>
  </div>
{:else}
  {#each groupedMessages as group (group.type === 'tool_group' ? `tools-${group.startIndex}` : group.type === 'subagent_group' ? `subagents-${group.startIndex}` : group.message.id)}
    <div
      animate:flip={{ duration: 300 }}
      in:fly={{ y: 20, duration: 300 }}
      out:fly={{ y: -20, duration: 200 }}
    >
      {#if group.type === 'subagent_group'}
        {@const isParallel = group.messages.length > 1}
        <div class="flex items-start gap-3">
          <div class="shrink-0 w-9 h-9 rounded-xl bg-info/10 flex items-center justify-center mt-0.5">
            <svg class="w-4.5 h-4.5 text-info" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          </div>
          <div class="flex-1">
            {#if isParallel}
              <div class="flex items-center gap-2 mb-2 px-2 py-1 bg-info/10 rounded-lg border border-info/30 w-fit">
                <svg class="w-3.5 h-3.5 text-info" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span class="text-xs font-medium text-info">Parallel Execution</span>
                <span class="text-xs text-muted-foreground">{group.messages.length} agents</span>
              </div>
            {/if}
            <div
              class="gap-3"
              class:grid={isParallel}
              class:grid-cols-1={isParallel}
              class:lg:grid-cols-2={isParallel}
              class:xl:grid-cols-3={isParallel && group.messages.length >= 3}
            >
              {#each group.messages as msg (msg.metadata?.toolId)}
                {@const toolId = msg.metadata?.toolId}
                {@const subagent = toolId ? instances.getSubagent(toolId) : null}
                {#if subagent}
                  <SubagentBranch {subagent} />
                {:else}
                  <div class="rounded-lg border border-border bg-card/50 px-3 py-2 animate-pulse">
                    <span class="text-sm text-muted-foreground">
                      Starting {msg.metadata?.subagentType || 'agent'}...
                    </span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      {:else if group.type === 'tool_group'}
        <div class="flex items-start gap-3">
          <div class="shrink-0 w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center mt-0.5">
            <svg class="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
          </div>
          <div class="flex-1 max-w-[85%]">
            <ToolGroup tools={group.messages} />
          </div>
        </div>
      {:else}
        {@const message = group.message}
        {@const i = group.index}
        <ChatMessage
          {message}
          {instanceId}
          showTimestamp={i === 0 || chatMessages[i - 1]?.type !== message.type}
          {onLoginSubmit}
          {onLoginCancel}
          {onModelSelect}
          {onModelCancel}
          {onMemorySelect}
          {onMemorySave}
          {onMemoryCancel}
          {onQuestionSubmit}
          {onQuestionCancel}
          onDismissMessage={() => instances.removeMessage(instanceId, i)}
          {onEditMessage}
          onResetSession={message.type === 'ui.session_error' ? onResetSession : undefined}
          onDownloadTranscript={message.type === 'ui.session_error' ? onDownloadTranscript : undefined}
          canEdit={message.type === 'user'}
          isLoginActive={message.type === 'system.login_prompt' && pendingOAuthState === message.metadata?.oauthState}
          isModelPickerActive={message.type === 'system.model_picker' && pendingModelPickerIndex === i}
          isMemoryPickerActive={message.type === 'system.memory_picker' && pendingMemoryPickerIndex === i}
          isQuestionPickerActive={message.type === 'system.ask_question' && questionsStore.has(message.metadata?.questionRequestId as string)}
        />
      {/if}
    </div>
  {/each}

  <!-- Activity Indicator -->
  <ActivityIndicator {activityRaw} {streamingText} {chunkPulse} />
{/if}

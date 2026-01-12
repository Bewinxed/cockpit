<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { ArrowDown, Bot, Loader2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import InstanceHeader from './InstanceHeader.svelte';
  import { ChatMessage, ChatInput, StreamingIndicator, PermissionRequest, ToolGroup } from '$lib/components/features';
  import { UseAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
  import { ActivityGrid } from '$lib/components/ui/activity-grid';
  import {
    instances,
    agents,
    instanceMessages,
    getInstanceMessages,
    getInstancePermissions,
    getStreamingState,
    getInstanceStatus,
    getStreamingMessage,
    addMessage,
    removeMessage,
    clearInstanceMessages,
    updateStreamingState,
    updateMessageMetadata,
    updateUserMessageUuid,
    streamingMessages,
    type Message
  } from '$lib/stores/realtime.svelte';
  import { api } from '$lib/api';

  interface AvailableCommand {
    name: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
    description?: string;
    source?: string;
  }

  interface DbMessage {
    id: string;
    content: string | Record<string, unknown>;
    messageType: string;
    timestamp: string | Date;
    sdkUuid?: string;
  }

  // Default commands available in all instances
  const DEFAULT_COMMANDS: AvailableCommand[] = [
    { name: '/help', type: 'builtin', description: 'Show available commands' },
    { name: '/clear', type: 'builtin', description: 'Clear conversation history' },
    { name: '/compact', type: 'builtin', description: 'Clear conversation but keep a summary' },
    { name: '/model', type: 'builtin', description: 'Switch Claude model' },
    { name: '/login', type: 'builtin', description: 'Login to Claude with API key' },
    { name: '/logout', type: 'builtin', description: 'Logout from Claude' },
    { name: '/memory', type: 'builtin', description: 'View/edit CLAUDE.md memory files' },
    { name: '/vim', type: 'builtin', description: 'Toggle vim mode' },
    { name: '/terminal-setup', type: 'builtin', description: 'Configure terminal settings' },
  ];

  // Client-side commands that need special handling
  const CLIENT_COMMANDS = ['/help', '/login', '/logout', '/model', '/clear', '/memory', '/vim', '/terminal-setup'] as const;

  interface Props {
    instanceId: string;
  }

  let { instanceId }: Props = $props();

  // Reactive stores for this instance
  const instance = $derived($instances.get(instanceId));
  const agent = $derived(instance?.machineId ? $agents.get(instance.machineId) : undefined);

  // Create stores that react to instanceId changes
  let messagesStore = $derived.by(() => getInstanceMessages(instanceId));
  let permissionsStore = $derived.by(() => getInstancePermissions(instanceId));
  let streamingStateStore = $derived.by(() => getStreamingState(instanceId));
  let streamingMessageStore = $derived.by(() => getStreamingMessage(instanceId));
  let instanceStatusStore = $derived.by(() => getInstanceStatus(instanceId));

  // Track which instances we've loaded messages for
  let loadedInstances = new Set<string>();
  let isLoadingMessages = $state(false);

  // Parse database messages into UI format
  function parseDbMessages(dbMessages: DbMessage[]): Message[] {
    const result: Message[] = [];
    // First pass: collect tool results from user messages (SDK sends tool_result as user messages)
    const toolResults = new Map<string, { content: unknown; isError: boolean }>();

    for (const dbMsg of dbMessages) {
      const content = typeof dbMsg.content === 'string' ? JSON.parse(dbMsg.content) : dbMsg.content;
      const sdkType = content?.type || dbMsg.messageType;

      // Look for tool_result blocks in user messages
      if (sdkType === 'user' && content?.message?.content && Array.isArray(content.message.content)) {
        for (const block of content.message.content) {
          if (block?.type === 'tool_result' && block.tool_use_id) {
            toolResults.set(block.tool_use_id, {
              content: block.content,
              isError: block.is_error || false,
            });
          }
        }
      }
    }

    // Second pass: build messages and match tool results
    for (const dbMsg of dbMessages) {
      const content = typeof dbMsg.content === 'string' ? JSON.parse(dbMsg.content) : dbMsg.content;
      const sdkType = content?.type || dbMsg.messageType;
      const sdkUuid = dbMsg.sdkUuid || (content?.uuid as string | undefined);

      if (sdkType === 'user' && content?.content) {
        result.push({
          id: dbMsg.id,
          instanceId,
          type: 'user',
          content: content.content,
          timestamp: new Date(dbMsg.timestamp),
          sdkUuid,
        });
      } else if (sdkType === 'assistant' && content?.message?.content) {
        for (const block of content.message.content) {
          if (block?.type === 'text' && block.text) {
            result.push({
              id: dbMsg.id,
              instanceId,
              type: 'assistant',
              content: block.text,
              timestamp: new Date(dbMsg.timestamp),
              sdkUuid,
            });
          } else if (block?.type === 'tool_use') {
            const toolResult = toolResults.get(block.id);
            result.push({
              id: dbMsg.id + '-' + block.id,
              instanceId,
              type: 'tool_use',
              content: block.name || 'Tool',
              timestamp: new Date(dbMsg.timestamp),
              sdkUuid,
              metadata: {
                toolId: block.id,
                toolName: block.name,
                toolInput: block.input,
                toolResult: toolResult?.content,
                toolStatus: toolResult ? (toolResult.isError ? 'error' : 'success') : 'pending',
              },
            });
          }
        }
      } else if (sdkType === 'system' && content?.subtype === 'init') {
        result.push({
          id: dbMsg.id,
          instanceId,
          type: 'system',
          content: `Session started with ${content.model || 'Claude'}`,
          timestamp: new Date(dbMsg.timestamp),
          sdkUuid,
        });
      }
    }
    return result;
  }

  // Load messages from API when instance changes
  $effect(() => {
    if (instanceId && !loadedInstances.has(instanceId)) {
      loadedInstances.add(instanceId);
      isLoadingMessages = true;
      loadMessages(instanceId).finally(() => {
        isLoadingMessages = false;
      });
    }
  });

  async function loadMessages(id: string) {
    try {
      const response = await api.api.instances({ id }).messages.get();
      const result = response.data;
      const messages = result?.data;
      if (messages && Array.isArray(messages) && messages.length > 0) {
        instanceMessages.update((map) => {
          const existing = map.get(id) || [];
          if (existing.length === 0) {
            const parsedMessages = parseDbMessages(messages as DbMessage[]);
            map.set(id, parsedMessages);
          }
          return map;
        });
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  // Get current messages (from store)
  const currentMessages = $derived($messagesStore || []);

  // Group consecutive tool messages for compact display
  type MessageGroup = { type: 'single'; message: Message; index: number } | { type: 'tool_group'; messages: Message[]; startIndex: number };

  const groupedMessages = $derived((): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < currentMessages.length) {
      const msg = currentMessages[i];

      if (msg.type === 'tool_use' || msg.type === 'tool_result') {
        const toolMessages: Message[] = [msg];
        const startIndex = i;
        i++;

        while (i < currentMessages.length) {
          const nextMsg = currentMessages[i];
          if (nextMsg.type === 'tool_use' || nextMsg.type === 'tool_result') {
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

  // Auto-scroll hook
  const autoScroll = new UseAutoScroll();
  let shouldAutoScroll = $state(true);
  let messagesContainer: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (messagesContainer) {
      autoScroll.ref = messagesContainer;
    }
  });

  $effect(() => {
    shouldAutoScroll = autoScroll.isAtBottom;
  });

  // Commands state
  let commands = $state<AvailableCommand[]>(DEFAULT_COMMANDS);
  let commandsFetched = $state(false);

  // Fetch commands when instance becomes running
  $effect(() => {
    const isRunning = instance && instance.status === 'running';
    if (isRunning && !commandsFetched) {
      commandsFetched = true;
      fetchCommands();
    } else if (!isRunning) {
      commandsFetched = false;
    }
  });

  async function fetchCommands() {
    try {
      const { data, error } = await api.api.instances({ id: instanceId }).commands.get();
      if (error) {
        console.error('Failed to fetch commands:', error);
        return;
      }
      if (data?.success && data.data) {
        const result = data.data as { commands?: AvailableCommand[] };
        const fetchedCommands = result.commands || [];
        const fetchedNames = new Set(fetchedCommands.map(c => c.name));
        const uniqueDefaults = DEFAULT_COMMANDS.filter(c => !fetchedNames.has(c.name));
        commands = [...fetchedCommands, ...uniqueDefaults];
      }
    } catch (err) {
      console.error('Failed to fetch commands:', err);
    }
  }

  // UI State
  let sending = $state(false);
  let restarting = $state(false);
  let interrupting = $state(false);
  let error = $state<string | null>(null);

  // Get streaming state
  const isStreaming = $derived($streamingStateStore?.isStreaming ?? false);
  const transientStatus = $derived($instanceStatusStore);

  // Streaming message for progressive text display
  const streamingMessage = $derived($streamingMessageStore);
  const streamingText = $derived.by(() => {
    const msg = streamingMessage;
    if (!msg || !msg.contentBlocks) return '';
    const texts: string[] = [];
    const sortedIndices = Array.from(msg.contentBlocks.keys()).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      texts.push(msg.contentBlocks.get(idx) || '');
    }
    return texts.join('');
  });

  // OAuth state
  let pendingOAuthState = $state<string | null>(null);
  let pendingAuthUrl = $state<string | null>(null);

  // Model picker state
  let pendingModelPickerIndex = $state<number | null>(null);
  // svelte-ignore state_referenced_locally
  let currentModel = $state<string | undefined>(instance?.model);

  // Memory picker state
  let pendingMemoryPickerIndex = $state<number | null>(null);

  // Auth event listener cleanup
  let authCleanup: (() => void) | null = null;

  onMount(() => {
    const handleAuthRequired = (event: Event) => {
      const { instanceId: errorInstanceId } = (event as CustomEvent).detail;
      if (errorInstanceId === instanceId) {
        startLoginFlow();
      }
    };
    window.addEventListener('cockpit:auth-required', handleAuthRequired);
    authCleanup = () => window.removeEventListener('cockpit:auth-required', handleAuthRequired);
  });

  onDestroy(() => {
    authCleanup?.();
  });

  const isActive = $derived(
    instance?.status === 'running' || instance?.status === 'starting'
  );

  function isClientCommand(msg: string): (typeof CLIENT_COMMANDS)[number] | null {
    const trimmed = msg.trim().toLowerCase();
    for (const cmd of CLIENT_COMMANDS) {
      if (trimmed === cmd || trimmed.startsWith(cmd + ' ')) {
        return cmd;
      }
    }
    return null;
  }

  // Start the login flow
  async function startLoginFlow() {
    try {
      const { data, error: startError } = await api.api.auth.oauth.start.post();

      if (startError || !data?.success) {
        throw new Error('Failed to start OAuth flow');
      }

      pendingOAuthState = data.data.state;
      pendingAuthUrl = data.data.authUrl;

      addMessage(instanceId, {
        type: 'system',
        content: 'Login to Claude',
        timestamp: new Date(),
        metadata: {
          subtype: 'login_prompt',
          authUrl: data.data.authUrl,
          oauthState: data.data.state,
        },
      });
    } catch (err) {
      addMessage(instanceId, {
        type: 'system',
        content: `Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    }
  }

  async function handleClientCommand(command: (typeof CLIENT_COMMANDS)[number]) {
    if (command === '/help') {
      await fetchCommands();

      let version = 'unknown';
      if (instance?.machineId) {
        try {
          const versionResponse = await api.api.agents({ machineId: instance.machineId })['claude-version'].get();
          if (versionResponse.data?.success && versionResponse.data.data?.version) {
            version = versionResponse.data.data.version;
          }
        } catch {
          // Fall back to unknown
        }
      }

      addMessage(instanceId, {
        type: 'help_menu',
        content: '',
        timestamp: new Date(),
        metadata: {
          version,
          commands: commands.map(c => ({
            name: c.name,
            description: c.description,
            type: c.type,
          })),
        },
      });
    } else if (command === '/login') {
      await startLoginFlow();
    } else if (command === '/logout') {
      try {
        await api.api.auth.logout.delete();
        addMessage(instanceId, {
          type: 'system',
          content: 'Logged out successfully',
          timestamp: new Date(),
        });
      } catch (err) {
        addMessage(instanceId, {
          type: 'system',
          content: `Logout failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date(),
        });
      }
    } else if (command === '/model') {
      if (!isActive) {
        addMessage(instanceId, {
          type: 'system',
          content: 'Cannot change model: Instance is not running',
          timestamp: new Date(),
        });
        return;
      }

      addMessage(instanceId, {
        type: 'system',
        content: 'Switch Model',
        timestamp: new Date(),
        metadata: {
          subtype: 'model_picker',
          loading: true,
          models: [],
          currentModel: currentModel,
        },
      });

      const messages = $messagesStore || [];
      pendingModelPickerIndex = messages.length - 1;

      try {
        const response = await fetch(`/api/instances/${instanceId}/models`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch models');
        }

        updateMessageMetadata(instanceId, pendingModelPickerIndex!, {
          loading: false,
          models: data.data.models || [],
          currentModel: data.data.currentModel,
        });
        currentModel = data.data.currentModel;
      } catch (err) {
        updateMessageMetadata(instanceId, pendingModelPickerIndex!, {
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch models',
        });
      }
    } else if (command === '/memory') {
      addMessage(instanceId, {
        type: 'system',
        content: 'Edit Memory',
        timestamp: new Date(),
        metadata: {
          subtype: 'memory_picker',
          memoryPhase: 'selection',
        },
      });

      const messages = $messagesStore || [];
      pendingMemoryPickerIndex = messages.length - 1;
    } else if (command === '/vim') {
      addMessage(instanceId, {
        type: 'system',
        content: 'Vim Mode',
        timestamp: new Date(),
        metadata: {
          subtype: 'vim_info',
        },
      });
    } else if (command === '/terminal-setup') {
      addMessage(instanceId, {
        type: 'system',
        content: 'Terminal Setup',
        timestamp: new Date(),
        metadata: {
          subtype: 'terminal_setup_info',
        },
      });
    } else if (command === '/clear') {
      clearInstanceMessages(instanceId);

      if (isActive) {
        try {
          await api.api.instances({ id: instanceId }).send.post({ message: '/clear' });
        } catch {
          // Ignore errors for clear command
        }
      }

      addMessage(instanceId, {
        type: 'system',
        content: 'Conversation cleared',
        timestamp: new Date(),
      });
    }
  }

  // Model picker handlers
  async function handleModelSelect(model: string): Promise<void> {
    const response = await fetch(`/api/instances/${instanceId}/models`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to set model');
    }

    currentModel = model;

    if (pendingModelPickerIndex !== null) {
      updateMessageMetadata(instanceId, pendingModelPickerIndex, {
        selectedModel: model,
      });
    }
    pendingModelPickerIndex = null;

    addMessage(instanceId, {
      type: 'system',
      content: `Model changed to ${model}`,
      timestamp: new Date(),
    });
  }

  function handleModelCancel() {
    pendingModelPickerIndex = null;
  }

  // Memory picker handlers
  async function handleMemorySelect(memoryType: 'project' | 'user'): Promise<void> {
    if (pendingMemoryPickerIndex === null) return;

    updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
      loading: true,
      selectedMemoryType: memoryType,
      memoryPhase: 'editing',
    });

    try {
      const response = await fetch(`/api/instances/${instanceId}/memory?type=${memoryType}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch memory');
      }

      updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
        loading: false,
        memoryContent: data.data?.content || '',
        memoryPath: data.data?.path || (memoryType === 'project' ? './CLAUDE.md' : '~/.claude/CLAUDE.md'),
      });
    } catch (err) {
      updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch memory',
      });
    }
  }

  async function handleMemorySave(content: string): Promise<void> {
    if (pendingMemoryPickerIndex === null) return;

    const messages = $messagesStore || [];
    const message = messages[pendingMemoryPickerIndex];
    const memoryType = message?.metadata?.selectedMemoryType as 'project' | 'user';

    if (!memoryType) {
      throw new Error('No memory type selected');
    }

    const response = await fetch(`/api/instances/${instanceId}/memory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: memoryType, content }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to save memory');
    }

    pendingMemoryPickerIndex = null;

    addMessage(instanceId, {
      type: 'system',
      content: `Memory saved (${memoryType})`,
      timestamp: new Date(),
    });
  }

  function handleMemoryCancel() {
    pendingMemoryPickerIndex = null;
  }

  // Login handlers
  async function handleLoginSubmit(code: string): Promise<void> {
    if (!pendingOAuthState) {
      throw new Error('No pending login. Please run /login first.');
    }

    const { data, error: callbackError } = await api.api.auth.oauth.callback.post({
      code: code.trim(),
      state: pendingOAuthState,
    });

    if (callbackError || !data?.success) {
      const errorMsg = (callbackError as { value?: { message?: string } })?.value?.message || (data as { error?: string })?.error || 'Token exchange failed';
      throw new Error(errorMsg);
    }

    pendingOAuthState = null;
    pendingAuthUrl = null;

    addMessage(instanceId, {
      type: 'system',
      content: 'Login successful! You are now authenticated.',
      timestamp: new Date(),
    });
  }

  function handleLoginCancel() {
    pendingOAuthState = null;
    pendingAuthUrl = null;
    addMessage(instanceId, {
      type: 'system',
      content: 'Login cancelled.',
      timestamp: new Date(),
    });
  }

  // Edit message handler
  async function handleEditMessage(messageId: string, newContent: string): Promise<void> {
    if (!instance) return;

    const messages = currentMessages;
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    let resumeFromUuid: string | undefined;
    if (msgIndex > 0) {
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].sdkUuid) {
          resumeFromUuid = messages[i].sdkUuid;
          break;
        }
      }
    }

    clearInstanceMessages(instanceId);
    addMessage(instanceId, {
      type: 'user',
      content: newContent,
      timestamp: new Date(),
    });

    restarting = true;
    try {
      const resumeParams: {
        prompt: string;
        resumeFromMessageId?: string;
        forkSession?: boolean;
      } = {
        prompt: newContent,
      };

      if (resumeFromUuid) {
        resumeParams.resumeFromMessageId = resumeFromUuid;
        resumeParams.forkSession = true;
      }

      const result = await api.api.instances({ id: instanceId }).resume.post(resumeParams);

      if (result.error || !result.data?.success) {
        throw new Error((result.error as { message?: string })?.message || 'Failed to resume');
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to edit message';
    } finally {
      restarting = false;
    }
  }

  // Check for OAuth code
  function isOAuthCode(msg: string): boolean {
    const trimmed = msg.trim();
    return trimmed.includes('#') && trimmed.length > 20 && !trimmed.startsWith('/');
  }

  // Send message handler
  async function handleSend(message: string) {
    if (!instance || sending || restarting) return;

    error = null;

    // Check for OAuth code paste
    if (isOAuthCode(message)) {
      addMessage(instanceId, {
        type: 'user',
        content: message,
        timestamp: new Date(),
      });
      if (pendingOAuthState) {
        try {
          await handleLoginSubmit(message);
        } catch (err) {
          addMessage(instanceId, {
            type: 'system',
            content: `Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: new Date(),
          });
        }
      }
      return;
    }

    // Check for client-side commands
    const clientCmd = isClientCommand(message);

    const LOCAL_ONLY_COMMANDS = ['/help', '/login', '/logout', '/clear', '/vim', '/terminal-setup'] as const;
    const needsInstance = clientCmd && !LOCAL_ONLY_COMMANDS.includes(clientCmd as typeof LOCAL_ONLY_COMMANDS[number]);

    // Auto-resume if needed
    if (!isActive && (needsInstance || !clientCmd)) {
      restarting = true;

      try {
        const promptToSend = clientCmd ? '' : message;
        const result = await api.api.instances({ id: instanceId }).resume.post({
          prompt: promptToSend,
        });

        if (result.error || !result.data?.success) {
          error = (result.error as { message?: string })?.message || 'Failed to resume session';
          return;
        }

        addMessage(instanceId, {
          type: 'system',
          content: 'Session resumed',
          timestamp: new Date(),
        });

        if (!clientCmd) {
          return;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
        return;
      } finally {
        restarting = false;
      }
    }

    // Handle client-side commands
    if (clientCmd) {
      if (isActive) {
        addMessage(instanceId, {
          type: 'user',
          content: message,
          timestamp: new Date(),
        });
      }
      await handleClientCommand(clientCmd);
      return;
    }

    // Send message normally
    sending = true;
    updateStreamingState(instanceId, { isStreaming: true });

    const sentMessage = message;

    addMessage(instanceId, {
      type: 'user',
      content: message,
      timestamp: new Date(),
    });

    try {
      const result = await api.api.instances({ id: instanceId }).send.post({
        message,
      });

      if (result.data?.success && result.data.messageUuid) {
        updateUserMessageUuid(instanceId, sentMessage, result.data.messageUuid);
      }

      if (result.error || !result.data?.success) {
        const errMsg = (result.error as { message?: string })?.message || 'Failed to send message';
        if (errMsg.toLowerCase().includes('not found')) {
          sending = false;
          restarting = true;

          try {
            const resumeResult = await api.api.instances({ id: instanceId }).resume.post({
              prompt: message,
            });
            if (resumeResult.error || !resumeResult.data?.success) {
              error = (resumeResult.error as { message?: string })?.message || 'Failed to resume';
            } else {
              addMessage(instanceId, {
                type: 'system',
                content: 'Session resumed',
                timestamp: new Date(),
              });
            }
          } catch (resumeErr) {
            error = resumeErr instanceof Error ? resumeErr.message : 'Failed to resume';
          } finally {
            restarting = false;
          }
        } else {
          error = errMsg;
          updateStreamingState(instanceId, { isStreaming: false });
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      updateStreamingState(instanceId, { isStreaming: false });
    } finally {
      sending = false;
    }
  }

  // Interrupt handler
  async function handleInterrupt() {
    if (!instance || interrupting) return;

    interrupting = true;
    error = null;

    try {
      const result = await api.api.instances({ id: instanceId }).interrupt.post();
      if (result.error || !result.data?.success) {
        error = (result.error as { message?: string })?.message || 'Failed to interrupt';
      } else {
        addMessage(instanceId, {
          type: 'system',
          content: 'Operation interrupted',
          timestamp: new Date(),
        });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      interrupting = false;
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
    class="flex-1 overflow-y-auto scroll-smooth"
    bind:this={messagesContainer}
  >
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <!-- Loading state -->
      {#if isLoadingMessages && currentMessages.length === 0}
        <div class="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 class="size-5 animate-spin mr-2" />
          <span class="text-sm">Loading messages...</span>
        </div>
      {:else if currentMessages.length === 0}
        <!-- Empty state -->
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <div class="text-muted-foreground text-sm">
            {isActive
              ? "What project are we working on today?"
              : "Send a message to start the conversation."}
          </div>
        </div>
      {:else}
        {#each groupedMessages() as group, groupIdx (group.type === 'tool_group' ? `tools-${group.startIndex}` : group.message.id)}
          <div
            animate:flip={{ duration: 300 }}
            in:fly={{ y: 20, duration: 300 }}
            out:fly={{ y: -20, duration: 200 }}
          >
            {#if group.type === 'tool_group'}
              <!-- Grouped tool messages -->
              <div class="flex items-start gap-3">
                <!-- Tool icon avatar -->
                <div class="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center mt-0.5">
                  <svg class="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                </div>
                <!-- Tool group component -->
                <div class="flex-1 max-w-[85%]">
                  <ToolGroup tools={group.messages} />
                </div>
              </div>
            {:else}
              <!-- Single message -->
              {@const message = group.message}
              {@const i = group.index}
              <ChatMessage
                {message}
                showTimestamp={i === 0 || currentMessages[i - 1]?.type !== message.type}
                onLoginSubmit={handleLoginSubmit}
                onLoginCancel={handleLoginCancel}
                onModelSelect={handleModelSelect}
                onModelCancel={handleModelCancel}
                onMemorySelect={handleMemorySelect}
                onMemorySave={handleMemorySave}
                onMemoryCancel={handleMemoryCancel}
                onDismissMessage={() => removeMessage(instanceId, i)}
                onEditMessage={handleEditMessage}
                canEdit={message.type === 'user'}
                isLoginActive={message.metadata?.subtype === 'login_prompt' && pendingOAuthState === message.metadata?.oauthState}
                isModelPickerActive={message.metadata?.subtype === 'model_picker' && pendingModelPickerIndex === i}
                isMemoryPickerActive={message.metadata?.subtype === 'memory_picker' && pendingMemoryPickerIndex === i}
              />
            {/if}
          </div>
        {/each}

        <!-- Streaming/Loading Indicator -->
        {#if sending || restarting || isStreaming}
          <div
            class="flex items-start gap-3"
            in:fly={{ y: 10, duration: 250, delay: 50 }}
            out:fly={{ y: -5, duration: 150 }}
          >
            <!-- Bot Avatar -->
            <div class="flex-shrink-0 w-9 h-9 rounded-xl bg-secondary border border-border flex items-center justify-center mt-0.5">
              <Bot class="w-4.5 h-4.5 text-muted-foreground" />
            </div>
            <!-- Streaming content or activity indicator -->
            {#if streamingText}
              <!-- Show streaming text with typing cursor -->
              <div class="flex-1 max-w-[85%]">
                <div class="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                  <div class="text-sm text-foreground whitespace-pre-wrap break-words">
                    {streamingText}<span class="inline-block w-0.5 h-4 bg-foreground/70 ml-0.5 animate-pulse"></span>
                  </div>
                </div>
              </div>
            {:else}
              <!-- Activity indicator bubble when no text yet -->
              <div class="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-3">
                <ActivityGrid {instanceId} size="sm" />
                {#if restarting}
                  <span class="text-sm text-muted-foreground">Resuming session...</span>
                {:else}
                  <span class="text-sm text-muted-foreground">Thinking...</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
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

  <!-- Error Display -->
  {#if error}
    <div class="border-t border-error/30 bg-error/10 px-4 py-2 flex items-center justify-between">
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

  <!-- Transient Status (compacting, etc.) -->
  {#if transientStatus}
    <div class="border-t border-border bg-warning/10 px-4 py-2 flex items-center gap-2">
      <Loader2 class="size-4 animate-spin text-warning" />
      <span class="text-sm text-warning capitalize">{transientStatus}...</span>
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
        loading={sending || restarting}
        streaming={isStreaming}
        {commands}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
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
      />
    </div>
  </div>
</div>

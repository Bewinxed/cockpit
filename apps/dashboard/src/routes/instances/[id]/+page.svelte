<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { instances, instanceMessages, agents, addMessage, removeMessage, updateMessageMetadata, updateUserMessageUuid, clearInstanceMessages, getStreamingState, updateStreamingState, getInstanceStatus, getInstancePermissions, type Message } from '$lib/stores/realtime.svelte';
  import { sendMessage, stopInstance, resumeInstance, interruptInstance } from '$lib/actions';
  import { api } from '$lib/api';
  import { Badge, Button, LoadingButton, EmptyState } from '$lib/components/ui';
  import { ChatMessage, ChatInput, StreamingIndicator, PermissionRequest, ToolGroup } from '$lib/components/features';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { getInstance, getInstanceMessages } from '$lib/data.remote';
  import { UseAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
  import { ActivityGrid } from '$lib/components/ui/activity-grid';
  import {
    ArrowLeft,
    Square,
    StopCircle,
    Server,
    FolderOpen,
    Clock,
    Cpu,
    DollarSign,
    MessageSquare,
    Loader2,
    AlertCircle,
    Bot
  } from 'lucide-svelte';

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
    /** SDK's message UUID - required for resumeSessionAt when editing */
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

  // Get instance ID from route params
  const instanceId = $derived(page.params.id ?? '');

  // SSR data via remote functions - $derived with await for reactive SSR queries
  const ssrInstance = $derived(await getInstance(instanceId));
  const ssrMessages = $derived(await getInstanceMessages(instanceId));

  // Get instance from store (prefer store for real-time updates, fallback to SSR data)
  const storeInstance = $derived($instances.get(instanceId));
  const instance = $derived(storeInstance || (ssrInstance ? {
    id: ssrInstance.id,
    name: ssrInstance.lastPrompt?.slice(0, 50) || 'Instance',
    status: ssrInstance.status as 'starting' | 'running' | 'stopping' | 'stopped' | 'sleeping' | 'error' | 'disconnected',
    agent: '',
    machineId: ssrInstance.machineId,
    project: null,
    projectId: ssrInstance.projectId || null,
    lastActivity: ssrInstance.createdAt ? new Date(ssrInstance.createdAt).toISOString() : new Date().toISOString(),
    cwd: ssrInstance.cwd,
    model: ssrInstance.model,
    totalCostUsd: ssrInstance.totalCostUsd,
  } : undefined));

  // Get agent (machine) info
  const agent = $derived(instance?.machineId ? $agents.get(instance.machineId) : undefined);

  // Get pending permission requests for this instance
  // Note: instanceId comes from page params and won't change during component lifetime
  const permissionRequestsStore = getInstancePermissions(instanceId);
  const permissionRequests = $derived(permissionRequestsStore);

  // Cleanup function for auth event listener
  let authCleanup: (() => void) | null = null;

  // Parse SSR messages into UI format
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
      // SDK UUID is stored in database column, with fallback to content.uuid for migration
      const sdkUuid = dbMsg.sdkUuid || (content?.uuid as string | undefined);

      if (sdkType === 'user' && content?.content) {
        result.push({
          id: dbMsg.id,
          instanceId,
          type: 'user',
          content: content.content,
          timestamp: new Date(dbMsg.timestamp),
          sdkUuid, // User messages may not have UUID, but include if present
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
              sdkUuid, // Store SDK UUID for edit support (resumeSessionAt)
            });
          } else if (block?.type === 'tool_use') {
            // Look up the tool result for this tool_use
            const toolResult = toolResults.get(block.id);
            result.push({
              id: dbMsg.id + '-' + block.id,
              instanceId,
              type: 'tool_use',
              content: block.name || 'Tool',
              timestamp: new Date(dbMsg.timestamp),
              sdkUuid, // Store SDK UUID
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

  // Derive parsed SSR messages
  const parsedSsrMessages = $derived(ssrMessages ? parseDbMessages(ssrMessages) : []);

  // Set up auth event listener
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

  // Commands for the instance (starts with defaults)
  let commands = $state<AvailableCommand[]>(DEFAULT_COMMANDS);
  let commandsFetched = $state(false);

  // Fetch commands when instance becomes running (only once per running state)
  $effect(() => {
    const isRunning = instance && instance.status === 'running';
    if (isRunning && !commandsFetched) {
      commandsFetched = true;
      fetchCommands();
    } else if (!isRunning) {
      // Reset when no longer running so we fetch again if it starts again
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
        // Merge: fetched commands take precedence, then defaults
        const fetchedNames = new Set(fetchedCommands.map(c => c.name));
        const uniqueDefaults = DEFAULT_COMMANDS.filter(c => !fetchedNames.has(c.name));
        commands = [...fetchedCommands, ...uniqueDefaults];
      }
    } catch (err) {
      console.error('Failed to fetch commands:', err);
      // Keep default commands on error
    }
  }

  // Messages: Merge SSR history + real-time SSE updates
  // - SSR provides initial history (parsedSsrMessages)
  // - SSE provides new messages only (replays are skipped in realtime store)
  // - Always merge both, sorted by timestamp
  const realtimeMessages = $derived($instanceMessages.get(instanceId) || []);

  const currentMessages = $derived(
    [...parsedSsrMessages, ...realtimeMessages].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  );

  // Group consecutive tool messages for compact display
  type MessageGroup = { type: 'single'; message: Message; index: number } | { type: 'tool_group'; messages: Message[]; startIndex: number };

  const groupedMessages = $derived((): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < currentMessages.length) {
      const msg = currentMessages[i];

      // Check if this is a tool message (tool_use or tool_result)
      if (msg.type === 'tool_use' || msg.type === 'tool_result') {
        // Collect consecutive tool messages
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

        // If we have multiple tools OR just one, group them
        // (Single tools also benefit from the compact view)
        groups.push({ type: 'tool_group', messages: toolMessages, startIndex });
      } else {
        // Regular message
        groups.push({ type: 'single', message: msg, index: i });
        i++;
      }
    }

    return groups;
  });

  // UI State
  let sending = $state(false);
  let stopping = $state(false);
  let restarting = $state(false);
  let interrupting = $state(false);
  let error = $state<string | null>(null);

  // Get streaming state for interrupt functionality
  const streamingStateStore = $derived(getStreamingState(instanceId));
  const isStreaming = $derived($streamingStateStore?.isStreaming ?? false);

  // Auto-scroll to bottom on new messages (uses MutationObserver internally)
  const autoScroll = new UseAutoScroll();

  // Status config
  const statusConfig = {
    starting: { variant: 'warning' as const, label: 'Starting', pulse: true },
    running: { variant: 'success' as const, label: 'Running', pulse: true },
    stopping: { variant: 'warning' as const, label: 'Stopping', pulse: true },
    stopped: { variant: 'default' as const, label: 'Stopped', pulse: false },
    sleeping: { variant: 'info' as const, label: 'Sleeping', pulse: false },
    error: { variant: 'error' as const, label: 'Error', pulse: false },
    disconnected: { variant: 'warning' as const, label: 'Disconnected', pulse: false },
  };

  const status = $derived(instance ? statusConfig[instance.status] : null);

  // Client-side commands that need special handling
  // These are commands handled locally because the SDK doesn't emit their output
  const CLIENT_COMMANDS = ['/help', '/login', '/logout', '/model', '/clear', '/memory', '/vim', '/terminal-setup'] as const;

  function isClientCommand(msg: string): (typeof CLIENT_COMMANDS)[number] | null {
    const trimmed = msg.trim().toLowerCase();
    for (const cmd of CLIENT_COMMANDS) {
      if (trimmed === cmd || trimmed.startsWith(cmd + ' ')) {
        return cmd;
      }
    }
    return null;
  }

  // Model state - initialized from instance, updated when model is changed
  // svelte-ignore state_referenced_locally
  let currentModel = $state<string | undefined>(instance?.model);

  // Track pending OAuth state (verifier is stored server-side)
  let pendingOAuthState = $state<string | null>(null);
  let pendingAuthUrl = $state<string | null>(null);

  // Start the login flow - reusable by /login command and auth_required errors
  async function startLoginFlow() {
    try {
      // Call server to start OAuth flow - it generates PKCE and returns auth URL
      const { data, error: startError } = await api.api.auth.oauth.start.post();

      if (startError || !data?.success) {
        throw new Error('Failed to start OAuth flow');
      }

      // Store state for later verification
      pendingOAuthState = data.data.state;
      pendingAuthUrl = data.data.authUrl;

      // Add login prompt message with inline form
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
      // Re-fetch commands to ensure we have the latest
      await fetchCommands();

      // Fetch Claude version from machine
      let version = 'unknown';
      if (instance?.machineId) {
        try {
          const versionResponse = await api.api.agents({ machineId: instance.machineId })['claude-version'].get();
          if (versionResponse.data?.success && versionResponse.data.data?.version) {
            version = versionResponse.data.data.version;
          }
        } catch {
          // Fall back to unknown if we can't fetch
        }
      }

      // Use the new help_menu message type with Claude CLI-style tabbed UI
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
      // Show inline model picker
      if (!isActive) {
        addMessage(instanceId, {
          type: 'system',
          content: 'Cannot change model: Instance is not running',
          timestamp: new Date(),
        });
        return;
      }

      // Add loading message first
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

      // Track this as active model picker - get index AFTER adding message
      const messages = $instanceMessages.get(instanceId) || [];
      pendingModelPickerIndex = messages.length - 1;

      // Fetch models
      try {
        const response = await fetch(`/api/instances/${instanceId}/models`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch models');
        }

        // Update the message with models
        updateMessageMetadata(instanceId, pendingModelPickerIndex!, {
          loading: false,
          models: data.data.models || [],
          currentModel: data.data.currentModel,
        });
        currentModel = data.data.currentModel;
      } catch (err) {
        // Update message with error
        updateMessageMetadata(instanceId, pendingModelPickerIndex!, {
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch models',
        });
      }
    } else if (command === '/memory') {
      // Auto-resume is handled by handleSendMessage before calling handleClientCommand
      // Show memory picker UI (selection phase)
      addMessage(instanceId, {
        type: 'system',
        content: 'Edit Memory',
        timestamp: new Date(),
        metadata: {
          subtype: 'memory_picker',
          memoryPhase: 'selection', // 'selection' or 'editing'
        },
      });

      // Track this as active memory picker - get index AFTER adding message
      const messages = $instanceMessages.get(instanceId) || [];
      pendingMemoryPickerIndex = messages.length - 1;
    } else if (command === '/vim') {
      // Vim mode not available in web UI
      addMessage(instanceId, {
        type: 'system',
        content: 'Vim Mode',
        timestamp: new Date(),
        metadata: {
          subtype: 'vim_info',
        },
      });
    } else if (command === '/terminal-setup') {
      // Terminal setup not applicable in web
      addMessage(instanceId, {
        type: 'system',
        content: 'Terminal Setup',
        timestamp: new Date(),
        metadata: {
          subtype: 'terminal_setup_info',
        },
      });
    } else if (command === '/clear') {
      // Clear both local messages and send to SDK to clear server-side
      clearInstanceMessages(instanceId);

      // Send /clear to SDK to clear the conversation on the server
      if (isActive) {
        await sendMessage(instanceId, '/clear');
      }

      // Add a system message indicating the clear was successful
      addMessage(instanceId, {
        type: 'system',
        content: 'Conversation cleared',
        timestamp: new Date(),
      });
    }
  }

  // Track pending model picker message index
  let pendingModelPickerIndex = $state<number | null>(null);

  // Track pending memory picker message index
  let pendingMemoryPickerIndex = $state<number | null>(null);

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

    // Update current model
    currentModel = model;

    // Mark model picker as complete
    if (pendingModelPickerIndex !== null) {
      updateMessageMetadata(instanceId, pendingModelPickerIndex, {
        selectedModel: model,
      });
    }
    pendingModelPickerIndex = null;

    // Add success message
    addMessage(instanceId, {
      type: 'system',
      content: `Model changed to ${model}`,
      timestamp: new Date(),
    });
  }

  function handleModelCancel() {
    if (pendingModelPickerIndex !== null) {
      // Just mark as inactive, don't delete
      pendingModelPickerIndex = null;
    }
  }

  // Memory picker handlers
  async function handleMemorySelect(memoryType: 'project' | 'user'): Promise<void> {
    if (pendingMemoryPickerIndex === null) return;

    // Update message to show loading state
    updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
      loading: true,
      selectedMemoryType: memoryType,
      memoryPhase: 'editing',
    });

    // Fetch memory content from agent
    try {
      const response = await fetch(`/api/instances/${instanceId}/memory?type=${memoryType}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch memory');
      }

      // Update message with content for editing
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

    const messages = $instanceMessages.get(instanceId) || [];
    const message = messages[pendingMemoryPickerIndex];
    const memoryType = message?.metadata?.selectedMemoryType as 'project' | 'user';

    if (!memoryType) {
      throw new Error('No memory type selected');
    }

    // Save memory content to agent
    const response = await fetch(`/api/instances/${instanceId}/memory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: memoryType, content }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to save memory');
    }

    // Mark picker as inactive
    pendingMemoryPickerIndex = null;

    // Add success message
    addMessage(instanceId, {
      type: 'system',
      content: `Memory saved (${memoryType})`,
      timestamp: new Date(),
    });
  }

  function handleMemoryCancel() {
    if (pendingMemoryPickerIndex !== null) {
      // Just mark as inactive, don't delete
      pendingMemoryPickerIndex = null;
    }
  }

  // Check if message looks like an OAuth code (code#state format)
  function isOAuthCode(msg: string): boolean {
    const trimmed = msg.trim();
    return trimmed.includes('#') && trimmed.length > 20 && !trimmed.startsWith('/');
  }

  // Handle login form submission from inline ChatMessage
  async function handleLoginSubmit(code: string): Promise<void> {
    if (!pendingOAuthState) {
      throw new Error('No pending login. Please run /login first.');
    }

    // Send to server for token exchange (server has the PKCE verifier)
    const { data, error: callbackError } = await api.api.auth.oauth.callback.post({
      code: code.trim(),
      state: pendingOAuthState,
    });

    if (callbackError || !data?.success) {
      const errorMsg = (callbackError as { value?: { message?: string } })?.value?.message || (data as { error?: string })?.error || 'Token exchange failed';
      throw new Error(errorMsg);
    }

    // Clear pending state
    pendingOAuthState = null;
    pendingAuthUrl = null;

    // Add success message
    addMessage(instanceId, {
      type: 'system',
      content: 'Login successful! You are now authenticated.',
      timestamp: new Date(),
    });
  }

  // Handle login cancellation
  function handleLoginCancel() {
    pendingOAuthState = null;
    pendingAuthUrl = null;
    addMessage(instanceId, {
      type: 'system',
      content: 'Login cancelled.',
      timestamp: new Date(),
    });
  }

  async function handleOAuthCode(codeWithState: string) {
    if (!pendingOAuthState) {
      addMessage(instanceId, {
        type: 'system',
        content: 'No pending login. Please run /login first.',
        timestamp: new Date(),
      });
      return;
    }

    addMessage(instanceId, {
      type: 'system',
      content: 'Exchanging code for tokens...',
      timestamp: new Date(),
    });

    try {
      await handleLoginSubmit(codeWithState);
    } catch (err) {
      addMessage(instanceId, {
        type: 'system',
        content: `Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    }
  }

  async function handleSendMessage(message: string) {
    if (!instance || sending || restarting) return;

    error = null;

    // Check for OAuth code paste (code#state format)
    if (isOAuthCode(message)) {
      addMessage(instanceId, {
        type: 'user',
        content: message,
        timestamp: new Date(),
      });
      await handleOAuthCode(message);
      return;
    }

    // Check for client-side commands
    const clientCmd = isClientCommand(message);

    // Commands that don't need instance running (purely local UI)
    const LOCAL_ONLY_COMMANDS = ['/help', '/login', '/logout', '/clear', '/vim', '/terminal-setup'] as const;
    const needsInstance = clientCmd && !LOCAL_ONLY_COMMANDS.includes(clientCmd as typeof LOCAL_ONLY_COMMANDS[number]);

    // Auto-resume: If instance is not running and we need it, resume first
    // This applies to regular messages AND commands that need the instance (like /memory, /model)
    if (!isActive && (needsInstance || !clientCmd)) {
      restarting = true;

      // Don't add user message locally - SSE will add it with sdkUuid for edit support
      try {
        // Resume instance - for commands, don't send the message as prompt
        // For regular messages, send them as the initial prompt
        const promptToSend = clientCmd ? '' : message;
        const result = await resumeInstance(instanceId, promptToSend);

        if (!result.success) {
          error = result.error || 'Failed to resume session';
          return;
        }

        // Add system message about resumption
        addMessage(instanceId, {
          type: 'system',
          content: 'Session resumed',
          timestamp: new Date(),
        });

        // For regular messages, we're done (message was sent with resume)
        // For commands, continue to handle the command now that instance is running
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
      // Only add user message if we didn't already (from auto-resume above)
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

    // Instance is running - send message normally
    sending = true;

    // Set streaming state immediately to prevent gap between sending and SSE events
    // This ensures the loading indicator stays visible without flashing
    updateStreamingState(instanceId, { isStreaming: true });

    // Store the message content for UUID update after API response
    const sentMessage = message;

    // Add user message optimistically for immediate UI feedback
    addMessage(instanceId, {
      type: 'user',
      content: message,
      timestamp: new Date(),
    });

    try {
      const result = await sendMessage(instanceId, message);

      // If server returned a messageUuid, update the optimistic message for edit support
      if (result.success && result.messageUuid) {
        updateUserMessageUuid(instanceId, sentMessage, result.messageUuid);
      }

      if (!result.success) {
        // If instance not found, try to resume it
        if (result.error?.toLowerCase().includes('not found')) {
          sending = false;
          restarting = true;

          try {
            const resumeResult = await resumeInstance(instanceId, message);
            if (!resumeResult.success) {
              // If resume also fails with not found, the instance doesn't exist at all
              if (resumeResult.error?.toLowerCase().includes('not found')) {
                error = 'This session no longer exists. Please start a new conversation.';
              } else {
                error = resumeResult.error || 'Failed to resume session';
              }
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
          error = result.error || 'Failed to send message';
          // Reset streaming state on error since we won't get SSE events
          updateStreamingState(instanceId, { isStreaming: false });
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      // Reset streaming state on error since we won't get SSE events
      updateStreamingState(instanceId, { isStreaming: false });
    } finally {
      sending = false;
    }
  }

  async function handleStop() {
    if (!instance || stopping) return;

    stopping = true;
    error = null;

    try {
      const result = await stopInstance(instanceId);
      if (!result.success) {
        error = result.error || 'Failed to stop instance';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      stopping = false;
    }
  }

  async function handleInterrupt() {
    if (!instance || interrupting) return;

    interrupting = true;
    error = null;

    try {
      const result = await interruptInstance(instanceId);
      if (!result.success) {
        error = result.error || 'Failed to interrupt';
      } else {
        // Add system message about interruption
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

  const isActive = $derived(
    instance?.status === 'running' || instance?.status === 'starting'
  );

  // Handle editing a user message and restarting from that point
  async function handleEditMessage(messageId: string, newContent: string): Promise<void> {
    if (!instance) return;

    // Use currentMessages which includes both SSR and realtime messages
    const messages = currentMessages;
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    // We need the SDK UUID to use resumeSessionAt properly
    // The SDK expects the UUID of the message BEFORE the one we want to edit
    // For editing, we want to go back to BEFORE this user message

    // Find the previous message's SDK UUID (if it exists)
    // If editing first message, we just start fresh
    let resumeFromUuid: string | undefined;
    if (msgIndex > 0) {
      // Find the last assistant message before this user message
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].sdkUuid) {
          resumeFromUuid = messages[i].sdkUuid;
          break;
        }
      }
    }

    // Clear realtime messages and add the edited user message
    // SSR messages will be refreshed on next load
    clearInstanceMessages(instanceId);
    addMessage(instanceId, {
      type: 'user',
      content: newContent,
      timestamp: new Date(),
    });

    // Resume the instance with the edited message
    restarting = true;
    try {
      // Build resume params - only include resumeFromMessageId if we have a valid SDK UUID
      const resumeParams: {
        prompt: string;
        resumeFromMessageId?: string;
        forkSession?: boolean;
      } = {
        prompt: newContent,
      };

      // Only use resumeFromMessageId when we have a valid SDK UUID
      // This properly rewinds the conversation to before the edited message
      if (resumeFromUuid) {
        resumeParams.resumeFromMessageId = resumeFromUuid;
        // Fork to preserve original conversation history
        resumeParams.forkSession = true;
      }
      // If no resumeFromUuid and editing first message, we just resume with new prompt

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

  const formattedCost = $derived(
    instance?.totalCostUsd
      ? `$${instance.totalCostUsd.toFixed(4)}`
      : '$0.00'
  );

  const timeAgo = $derived(
    instance?.lastActivity
      ? formatDistanceToNow(new Date(instance.lastActivity))
      : null
  );

  // Get transient status for this instance (e.g., "compacting")
  const transientStatusStore = $derived(getInstanceStatus(instanceId));
  const transientStatus = $derived($transientStatusStore);
</script>

<svelte:head>
  <title>{instance?.name || 'Instance'} | Cockpit</title>
</svelte:head>

<div class="h-screen flex flex-col bg-background overflow-hidden relative">
  {#if instance}
    <!-- Header -->
    <header class="flex-shrink-0 bg-card/80 backdrop-blur-md border-b border-border px-6 py-3 z-10 shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <!-- Back button -->
          <a
            href="/instances"
            class="p-2 rounded-lg hover:bg-accent transition-colors shrink-0"
            title="Back to instances"
          >
            <ArrowLeft class="w-5 h-5 text-muted-foreground" />
          </a>

          <div class="min-w-0">
            <div class="flex items-center gap-2.5 mb-0.5">
              <h1 class="text-lg font-bold text-foreground truncate font-sans tracking-tight">
                {instance.name || 'Untitled Session'}
              </h1>
              {#if status}
                <Badge variant={status.variant} class="shrink-0 scale-90 origin-left">
                  {status.label}
                </Badge>
              {/if}
            </div>

            <div class="flex items-center gap-3 text-xs text-muted-foreground overflow-hidden">
              {#if agent}
                <div class="flex items-center gap-1 shrink-0" title="Running on {agent.name}">
                  <Server class="w-3.5 h-3.5" />
                  <span class="truncate max-w-[100px]">{agent.name}</span>
                </div>
                <span>•</span>
              {/if}

              {#if instance.cwd}
                <div class="flex items-center gap-1 shrink-0" title="CWD: {instance.cwd}">
                  <FolderOpen class="w-3.5 h-3.5" />
                  <span class="font-mono truncate max-w-[150px]">{instance.cwd.split('/').pop() || instance.cwd}</span>
                </div>
                <span>•</span>
              {/if}

              {#if instance.model}
                <div class="flex items-center gap-1 shrink-0">
                  <Cpu class="w-3.5 h-3.5" />
                  <span>{instance.model.replace('claude-3-5-', '')}</span>
                </div>
                <span>•</span>
              {/if}

              <div class="flex items-center gap-1 shrink-0">
                <DollarSign class="w-3.5 h-3.5" />
                <span>{formattedCost}</span>
              </div>

              <!-- Streaming Indicator -->
              <div class="ml-2 border-l border-border pl-3">
                <StreamingIndicator {instanceId} />
              </div>

              <!-- Transient Status (e.g., "compacting") -->
              {#if transientStatus}
                <div class="flex items-center gap-1.5 text-warning animate-pulse ml-2">
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                  <span class="capitalize font-medium">{transientStatus}...</span>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 shrink-0">
          {#if isActive}
            {#if isStreaming}
              <Button
                variant="secondary"
                size="sm"
                class="border-warning/30 text-warning hover:bg-warning/10"
                onclick={handleInterrupt}
                disabled={interrupting}
              >
                {#if interrupting}
                  <Loader2 class="size-3.5 animate-spin" />
                {:else}
                  <StopCircle class="size-3.5" />
                {/if}
                <span>Interrupt</span>
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-error hover:bg-error/10"
              onclick={handleStop}
              disabled={stopping || interrupting}
              title="Stop instance"
            >
              {#if stopping}
                <Loader2 class="size-4 animate-spin" />
              {:else}
                <Square class="size-4" />
              {/if}
            </Button>
          {/if}
        </div>
      </div>

      {#if error}
        <div class="mt-2 flex items-center gap-2 text-xs text-error bg-error/10 rounded-md px-3 py-1.5 animate-fade-in" in:fly={{ y: -5, duration: 200 }}>
          <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
          <span class="flex-1 font-medium">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 text-xs text-error hover:text-error"
            onclick={() => error = null}
          >
            Dismiss
          </Button>
        </div>
      {/if}
    </header>

    <!-- Messages Area -->
    <div class="flex-1 relative overflow-hidden flex flex-col">
      <div
        bind:this={autoScroll.ref}
        class="flex-1 overflow-y-auto p-6 space-y-6 bg-background scroll-smooth selection:bg-primary/10"
      >
        {#if currentMessages.length > 0}
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

          {#if sending || restarting || isStreaming}
            <div
              class="flex items-start gap-3"
              in:fly={{ y: 10, duration: 250, delay: 50 }}
              out:fly={{ y: -5, duration: 150 }}
            >
              <!-- Bot Avatar (same as assistant messages) -->
              <div class="flex-shrink-0 w-9 h-9 rounded-xl bg-secondary border border-border flex items-center justify-center mt-0.5">
                <Bot class="w-4.5 h-4.5 text-muted-foreground" />
              </div>
              <!-- Activity indicator bubble -->
              <div class="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-3">
                <ActivityGrid {instanceId} size="sm" />
                {#if restarting}
                  <span class="text-sm text-muted-foreground">Resuming session...</span>
                {:else}
                  <span class="text-sm text-muted-foreground">Thinking...</span>
                {/if}
              </div>
            </div>
          {/if}
        {:else}
          <div class="h-full flex items-center justify-center" in:fly={{ y: 20, duration: 400 }}>
            <EmptyState
              icon={MessageSquare}
              title="New Conversation"
              description={isActive
                ? "What project are we working on today?"
                : "This instance is currently idle. Send a message to start."}
            />
          </div>
        {/if}
      </div>

      {#if !autoScroll.isAtBottom}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
          <Button
            class="rounded-full shadow-lg animate-fade-in-up"
            onclick={() => autoScroll.scrollToBottom()}
          >
            <span>Jump to present</span>
            <ArrowLeft class="w-4 h-4 -rotate-90" />
          </Button>
        </div>
      {/if}
    </div>

    <!-- Pending Permission Requests -->
    {#if permissionRequests.length > 0}
      <div class="flex-shrink-0 px-4 py-2 border-t border-border bg-card space-y-2">
        {#each permissionRequests as request (request.requestId)}
          <PermissionRequest {request} />
        {/each}
      </div>
    {/if}

    <!-- Chat Input -->
    <div class="flex-shrink-0 relative z-10">
      <ChatInput
        onSend={handleSendMessage}
        onInterrupt={handleInterrupt}
        disabled={restarting}
        loading={sending || restarting}
        streaming={isStreaming}
        placeholder={restarting
          ? 'Resuming session...'
          : isStreaming
            ? 'Claude is responding... (⌘↵ to interrupt)'
            : 'Ask Claude anything... (⌘↵ to send)'}
        {commands}
      />
    </div>

  {:else}
    <!-- Instance not found -->
    <div class="flex-1 flex items-center justify-center bg-background" in:fly={{ y: 20, duration: 400 }}>
      <EmptyState
        icon={AlertCircle}
        title="Session not found"
        description="This session might have been closed or removed from the agent."
        action={{ label: 'Back to Dashboard', onClick: () => goto('/') }}
      />
    </div>
  {/if}
</div>
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { instances, instanceMessages, agents, addMessage, removeMessage, updateMessageMetadata, clearInstanceMessages, getStreamingState, getInstanceStatus, getInstancePermissions, type Message } from '$lib/stores/realtime.svelte';
  import { sendMessage, stopInstance, resumeInstance, interruptInstance } from '$lib/actions';
  import { api } from '$lib/api';
  import { Badge, LoadingButton, EmptyState } from '$lib/components/ui';
  import { ChatMessage, ChatInput, StreamingIndicator, PermissionRequest } from '$lib/components/features';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { getInstance, getInstanceMessages } from '$lib/data.remote';
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
    AlertCircle
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
    agentId: ssrInstance.agentId,
    project: null,
    projectId: ssrInstance.projectId || null,
    lastActivity: ssrInstance.createdAt ? new Date(ssrInstance.createdAt).toISOString() : new Date().toISOString(),
    cwd: ssrInstance.cwd,
    model: ssrInstance.model,
    totalCostUsd: ssrInstance.totalCostUsd,
  } : undefined));

  // Get agent info
  const agent = $derived(instance?.agentId ? $agents.get(instance.agentId) : undefined);

  // Get pending permission requests for this instance
  const permissionRequests = getInstancePermissions(instanceId);

  // Cleanup function for auth event listener
  let authCleanup: (() => void) | null = null;

  // Initialize messages from SSR data on mount
  onMount(() => {
    // Listen for auth-required events - auto-trigger login flow
    const handleAuthRequired = (event: Event) => {
      const { instanceId: errorInstanceId } = (event as CustomEvent).detail;
      if (errorInstanceId === instanceId) {
        startLoginFlow();
      }
    };
    window.addEventListener('cockpit:auth-required', handleAuthRequired);

    // Store cleanup function
    authCleanup = () => window.removeEventListener('cockpit:auth-required', handleAuthRequired);

    if (ssrMessages && ssrMessages.length > 0 && !$instanceMessages.get(instanceId)?.length) {
      // Convert DB messages to UI Message format
      for (const dbMsg of ssrMessages as DbMessage[]) {
        const content = typeof dbMsg.content === 'string' ? JSON.parse(dbMsg.content) : dbMsg.content;
        const sdkType = content?.type || dbMsg.messageType;

        // Only add displayable messages
        if (sdkType === 'user' && content?.content) {
          // User messages
          addMessage(instanceId, {
            id: dbMsg.id,
            type: 'user',
            content: content.content,
            timestamp: new Date(dbMsg.timestamp),
          });
        } else if (sdkType === 'assistant' && content?.message?.content) {
          for (const block of content.message.content) {
            if (block?.type === 'text' && block.text) {
              addMessage(instanceId, {
                id: dbMsg.id,
                type: 'assistant',
                content: block.text,
                timestamp: new Date(dbMsg.timestamp),
              });
            } else if (block?.type === 'tool_use') {
              addMessage(instanceId, {
                id: dbMsg.id + '-' + block.id,
                type: 'tool_use',
                content: block.name || 'Tool',
                timestamp: new Date(dbMsg.timestamp),
                metadata: {
                  toolId: block.id,
                  toolName: block.name,
                  toolInput: block.input,
                  toolStatus: 'success',
                },
              });
            }
          }
        } else if (sdkType === 'system' && content?.subtype === 'init') {
          addMessage(instanceId, {
            id: dbMsg.id,
            type: 'system',
            content: `Session started with ${content.model || 'Claude'}`,
            timestamp: new Date(dbMsg.timestamp),
          });
        }
      }
    }
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

  // Get messages for this instance directly from the Map
  const currentMessages = $derived($instanceMessages.get(instanceId) || []);

  // UI State
  let sending = $state(false);
  let stopping = $state(false);
  let restarting = $state(false);
  let interrupting = $state(false);
  let error = $state<string | null>(null);
  let messagesContainer = $state<HTMLDivElement | null>(null);

  // Get streaming state for interrupt functionality
  const streamingStateStore = $derived(getStreamingState(instanceId));
  const isStreaming = $derived($streamingStateStore?.isStreaming ?? false);

  // Smart scroll logic
  let userHasScrolledUp = $state(false);

  function handleScroll() {
    if (!messagesContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
    // If we are more than 150px from the bottom, the user has scrolled up
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    userHasScrolledUp = distanceToBottom > 150;
  }

  // Auto-scroll to bottom on new messages
  $effect(() => {
    if (currentMessages.length && messagesContainer && !userHasScrolledUp) {
      tick().then(() => {
        messagesContainer?.scrollTo({
          top: messagesContainer.scrollHeight,
          behavior: 'smooth'
        });
      });
    }
  });

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

      // Fetch Claude version from agent
      let version = 'unknown';
      if (instance?.agentId) {
        try {
          const versionResponse = await api.api.agents({ id: instance.agentId })['claude-version'].get();
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

      // Add user's message to current view immediately
      addMessage(instanceId, {
        type: 'user',
        content: message,
        timestamp: new Date(),
      });

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

    // Add user's message to current view immediately
    addMessage(instanceId, {
      type: 'user',
      content: message,
      timestamp: new Date(),
    });

    try {
      const result = await sendMessage(instanceId, message);
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
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
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

    // Find the message
    const messages = $instanceMessages.get(instanceId) || [];
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const editedMessage = messages[msgIndex];

    // We need the SDK UUID to use resumeSessionAt properly
    // The SDK expects the UUID of the message BEFORE the one we want to edit
    // So we need the previous assistant message's UUID, not the user message's
    // Actually, resumeSessionAt takes the message to resume AT (inclusive)
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

    // Remove all messages from the edited message onwards in the UI
    const messagesToRemove = messages.length - msgIndex;
    for (let i = 0; i < messagesToRemove; i++) {
      removeMessage(instanceId, msgIndex);
    }

    // Add the edited user message to UI
    addMessage(instanceId, {
      type: 'user',
      content: newContent,
      timestamp: new Date(),
    });

    // Resume the instance with the edited message
    restarting = true;
    try {
      // Only pass resumeFromMessageId if we have a valid UUID
      // If no UUID found (e.g., first message), don't use resumeSessionAt - just send the message
      const resumeParams: { prompt: string; resumeFromMessageId?: string } = {
        prompt: newContent,
      };
      if (resumeFromUuid) {
        resumeParams.resumeFromMessageId = resumeFromUuid;
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

<div class="h-screen flex flex-col bg-bg overflow-hidden relative">
  {#if instance}
    <!-- Header -->
    <header class="flex-shrink-0 bg-paper/80 backdrop-blur-md border-b border-border px-6 py-3 z-10 shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <!-- Back button -->
          <a
            href="/instances"
            class="p-2 rounded-lg hover:bg-surface-hover transition-colors shrink-0"
            title="Back to instances"
          >
            <ArrowLeft class="w-5 h-5 text-text-secondary" />
          </a>

          <div class="min-w-0">
            <div class="flex items-center gap-2.5 mb-0.5">
              <h1 class="text-lg font-bold text-text truncate font-serif tracking-tight">
                {instance.name || 'Untitled Session'}
              </h1>
              {#if status}
                <Badge variant={status.variant} class="shrink-0 scale-90 origin-left">
                  {status.label}
                </Badge>
              {/if}
            </div>

            <div class="flex items-center gap-3 text-xs text-text-muted overflow-hidden">
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
              <button
                class="btn btn-secondary btn-sm h-9 px-3 gap-1.5 border-warning/30 text-warning hover:bg-warning-light"
                onclick={handleInterrupt}
                disabled={interrupting}
              >
                {#if interrupting}
                  <Loader2 class="size-3.5 animate-spin" />
                {:else}
                  <StopCircle class="size-3.5" />
                {/if}
                <span>Interrupt</span>
              </button>
            {/if}
            <button
              class="btn btn-ghost btn-sm h-9 w-9 p-0 text-error hover:bg-error-light"
              onclick={handleStop}
              disabled={stopping || interrupting}
              title="Stop instance"
            >
              {#if stopping}
                <Loader2 class="size-4 animate-spin" />
              {:else}
                <Square class="size-4" />
              {/if}
            </button>
          {/if}
        </div>
      </div>

      {#if error}
        <div class="mt-2 flex items-center gap-2 text-xs text-error bg-error-light rounded-md px-3 py-1.5 animate-fade-in" in:fly={{ y: -5, duration: 200 }}>
          <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
          <span class="flex-1 font-medium">{error}</span>
          <button
            class="text-error-dark hover:underline flex-shrink-0"
            onclick={() => error = null}
          >
            Dismiss
          </button>
        </div>
      {/if}
    </header>

    <!-- Messages Area -->
    <div class="flex-1 relative overflow-hidden flex flex-col">
      <div
        bind:this={messagesContainer}
        onscroll={handleScroll}
        class="flex-1 overflow-y-auto p-6 space-y-6 bg-bg scroll-smooth selection:bg-primary-light"
      >
        {#if currentMessages.length > 0}
          {#each currentMessages as message, i (message.id)}
            <div
              animate:flip={{ duration: 300 }}
              in:fly={{ y: 20, duration: 300 }}
              out:fly={{ y: -20, duration: 200 }}
            >
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
                canEdit={message.type === 'user' && !!message.sdkUuid}
                isLoginActive={message.metadata?.subtype === 'login_prompt' && pendingOAuthState === message.metadata?.oauthState}
                isModelPickerActive={message.metadata?.subtype === 'model_picker' && pendingModelPickerIndex === i}
                isMemoryPickerActive={message.metadata?.subtype === 'memory_picker' && pendingMemoryPickerIndex === i}
              />
            </div>
          {/each}

          {#if sending || restarting}
            <div class="flex items-center gap-3 animate-fade-in py-2" in:fly={{ y: 10, duration: 200 }}>
              <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                <Loader2 class="w-4 h-4 text-primary animate-spin" />
              </div>
              {#if restarting}
                <span class="text-xs text-text-muted italic animate-pulse">Resuming session...</span>
              {:else}
                <div class="typing-indicator bg-surface border border-border rounded-2xl">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              {/if}
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

      {#if userHasScrolledUp}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
          <button
            class="px-4 py-2 bg-primary text-white rounded-full shadow-lg border border-primary-hover
                   flex items-center gap-2 text-sm font-medium animate-fade-in-up hover:bg-primary-hover transition-all"
            onclick={() => {
              userHasScrolledUp = false;
              messagesContainer?.scrollTo({
                top: messagesContainer.scrollHeight,
                behavior: 'smooth'
              });
            }}
          >
            <span>Jump to present</span>
            <ArrowLeft class="w-4 h-4 -rotate-90" />
          </button>
        </div>
      {/if}
    </div>

    <!-- Pending Permission Requests -->
    {#if $permissionRequests.length > 0}
      <div class="flex-shrink-0 px-4 py-2 border-t border-border bg-surface space-y-2">
        {#each $permissionRequests as request (request.requestId)}
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
    <div class="flex-1 flex items-center justify-center bg-bg" in:fly={{ y: 20, duration: 400 }}>
      <EmptyState
        icon={AlertCircle}
        title="Session not found"
        description="This session might have been closed or removed from the agent."
        action={{ label: 'Back to Dashboard', onClick: () => goto('/') }}
      />
    </div>
  {/if}
</div>
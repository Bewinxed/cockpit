<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tick, onMount } from 'svelte';
  import { instances, instanceMessages, agents, addMessage, removeMessage, getStreamingState, getInstanceStatus, type Message } from '$lib/stores/realtime';
  import { sendMessage, stopInstance, resumeInstance, interruptInstance } from '$lib/actions';
  import { api } from '$lib/api';
  import { Button, Badge, EmptyState, LoadingButton } from '$lib/components/ui';
  import { ChatMessage, ChatInput, StreamingIndicator } from '$lib/components/features';
  import { formatDistanceToNow } from '$lib/utils/time';
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

  // Page data from load function
  let { data } = $props();

  // Get instance ID from route
  const instanceId = $derived(page.params.id);

  // Get instance from store (prefer store for real-time updates, fallback to page data)
  const storeInstance = $derived($instances.get(instanceId));
  const instance = $derived(storeInstance || (data.instance ? {
    id: data.instance.id,
    name: data.instance.lastPrompt?.slice(0, 50) || 'Instance',
    status: data.instance.status as 'starting' | 'running' | 'stopping' | 'stopped' | 'sleeping' | 'error' | 'disconnected',
    agent: '',
    agentId: data.instance.agentId,
    project: null,
    projectId: data.instance.projectId || null,
    lastActivity: data.instance.createdAt ? new Date(data.instance.createdAt).toISOString() : new Date().toISOString(),
    cwd: data.instance.cwd,
    model: data.instance.model,
    totalCostUsd: data.instance.totalCostUsd,
  } : undefined));

  // Get agent info
  const agent = $derived(instance?.agentId ? $agents.get(instance.agentId) : undefined);

  // Initialize messages from page data on mount
  onMount(() => {
    if (data.messages && data.messages.length > 0 && !$instanceMessages.get(instanceId)?.length) {
      // Convert DB messages to UI Message format
      for (const dbMsg of data.messages) {
        const content = typeof dbMsg.content === 'string' ? JSON.parse(dbMsg.content) : dbMsg.content;
        const sdkType = content?.type || dbMsg.messageType;

        // Only add displayable messages
        if (sdkType === 'user' && content?.content) {
          // User messages
          addMessage(instanceId, {
            type: 'user',
            content: content.content,
            timestamp: new Date(dbMsg.timestamp),
          });
        } else if (sdkType === 'assistant' && content?.message?.content) {
          for (const block of content.message.content) {
            if (block?.type === 'text' && block.text) {
              addMessage(instanceId, {
                type: 'assistant',
                content: block.text,
                timestamp: new Date(dbMsg.timestamp),
              });
            } else if (block?.type === 'tool_use') {
              addMessage(instanceId, {
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
            type: 'system',
            content: `Session started with ${content.model || 'Claude'}`,
            timestamp: new Date(dbMsg.timestamp),
          });
        }
      }
    }
  });

  // Commands for the instance
  let commands = $state<AvailableCommand[]>([]);

  // Fetch commands when instance is available
  $effect(() => {
    if (instance && instance.status === 'running') {
      fetchCommands();
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
        commands = result.commands || [];
      }
    } catch (err) {
      console.error('Failed to fetch commands:', err);
      // Commands are optional, don't show error
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

  // Auto-scroll to bottom on new messages
  $effect(() => {
    if (currentMessages.length && messagesContainer) {
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
  const CLIENT_COMMANDS = ['/login', '/logout', '/model'] as const;

  function isClientCommand(msg: string): (typeof CLIENT_COMMANDS)[number] | null {
    const trimmed = msg.trim().toLowerCase();
    for (const cmd of CLIENT_COMMANDS) {
      if (trimmed === cmd || trimmed.startsWith(cmd + ' ')) {
        return cmd;
      }
    }
    return null;
  }

  // Model state
  let currentModel = $state<string | undefined>(instance?.model);

  // Track pending OAuth state (verifier is stored server-side)
  let pendingOAuthState = $state<string | null>(null);
  let pendingAuthUrl = $state<string | null>(null);

  async function handleClientCommand(command: (typeof CLIENT_COMMANDS)[number]) {
    if (command === '/login') {
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
      const messageIndex = addMessage(instanceId, {
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

      // Track this as active model picker
      pendingModelPickerIndex = currentMessages.length - 1;

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
    }
  }

  // Track pending model picker message index
  let pendingModelPickerIndex = $state<number | null>(null);

  // Helper to update message metadata
  function updateMessageMetadata(instId: string, index: number, metadata: Record<string, unknown>) {
    const messages = $instanceMessages.get(instId);
    if (messages && messages[index]) {
      messages[index] = {
        ...messages[index],
        metadata: {
          ...messages[index].metadata,
          ...metadata,
        },
      };
      // Trigger reactivity by updating the store
      $instanceMessages.set(instId, [...messages]);
    }
  }

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
      const errorMsg = callbackError?.message || (data as { error?: string })?.error || 'Token exchange failed';
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

    // Check for client-side commands first
    const clientCmd = isClientCommand(message);
    if (clientCmd) {
      addMessage(instanceId, {
        type: 'user',
        content: message,
        timestamp: new Date(),
      });
      await handleClientCommand(clientCmd);
      return;
    }

    // If instance is not running, resume it (re-spawn with same ID)
    if (!isActive) {
      restarting = true;

      // Add user's message to current view immediately
      addMessage(instanceId, {
        type: 'user',
        content: message,
        timestamp: new Date(),
      });

      try {
        // Resume instance - this re-spawns with the SAME instance ID
        const result = await resumeInstance(instanceId, message);

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

        // No navigation needed - we stay on the same page!
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      } finally {
        restarting = false;
      }
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

<div class="h-screen flex flex-col -m-6 bg-bg">
  {#if instance}
    <!-- Header -->
    <header class="flex-shrink-0 bg-paper border-b border-border px-6 py-4">
      <div class="flex items-start justify-between">
        <div class="flex items-start gap-4">
          <!-- Back button -->
          <a
            href="/instances"
            class="mt-1 p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <ArrowLeft class="w-5 h-5 text-text-secondary" />
          </a>

          <div>
            <div class="flex items-center gap-3 mb-1">
              <h1 class="text-xl font-semibold text-text">
                {instance.name || 'Instance'}
              </h1>
              {#if status}
                <Badge variant={status.variant}>
                  {status.label}
                </Badge>
              {/if}
            </div>

            <div class="flex flex-wrap items-center gap-4 text-sm text-text-secondary">
              {#if agent}
                <div class="flex items-center gap-1.5">
                  <Server class="w-4 h-4 text-text-muted" />
                  <span>{agent.name}</span>
                </div>
              {/if}

              {#if instance.cwd}
                <div class="flex items-center gap-1.5">
                  <FolderOpen class="w-4 h-4 text-text-muted" />
                  <span class="font-mono text-xs truncate max-w-[200px]">{instance.cwd}</span>
                </div>
              {/if}

              {#if instance.model}
                <div class="flex items-center gap-1.5">
                  <Cpu class="w-4 h-4 text-text-muted" />
                  <span>{instance.model}</span>
                </div>
              {/if}

              {#if timeAgo}
                <div class="flex items-center gap-1.5">
                  <Clock class="w-4 h-4 text-text-muted" />
                  <span>{timeAgo}</span>
                </div>
              {/if}

              <div class="flex items-center gap-1.5">
                <DollarSign class="w-4 h-4 text-text-muted" />
                <span>{formattedCost}</span>
              </div>

              <!-- Streaming Indicator -->
              <StreamingIndicator {instanceId} />

              <!-- Transient Status (e.g., "compacting") -->
              {#if transientStatus}
                <div class="flex items-center gap-1.5 text-warning animate-pulse">
                  <Loader2 class="w-4 h-4 animate-spin" />
                  <span class="capitalize">{transientStatus}...</span>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2">
          {#if isActive}
            {#if isStreaming}
              <!-- Show Interrupt button when streaming -->
              <LoadingButton
                variant="outline"
                size="sm"
                onclick={handleInterrupt}
                loading={interrupting}
                disabled={interrupting}
              >
                <StopCircle class="size-4" />
                Interrupt
              </LoadingButton>
            {/if}
            <LoadingButton
              variant="destructive"
              size="sm"
              onclick={handleStop}
              loading={stopping}
              disabled={stopping || interrupting}
            >
              <Square class="size-4" />
              Stop
            </LoadingButton>
          {/if}
        </div>
      </div>

      {#if error}
        <div class="mt-3 flex items-center gap-2 text-sm text-error bg-error-light rounded-lg px-3 py-2">
          <AlertCircle class="w-4 h-4 flex-shrink-0" />
          <span class="flex-1">{error}</span>
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
    <div
      bind:this={messagesContainer}
      class="flex-1 overflow-y-auto p-6 space-y-4 bg-bg"
    >
      {#if currentMessages.length > 0}
        {#each currentMessages as message, i (i)}
          <ChatMessage
            {message}
            showTimestamp={i === 0 || currentMessages[i - 1]?.type !== message.type}
            onLoginSubmit={handleLoginSubmit}
            onLoginCancel={handleLoginCancel}
            onModelSelect={handleModelSelect}
            onModelCancel={handleModelCancel}
            onDismissMessage={() => removeMessage(instanceId, i)}
            isLoginActive={message.metadata?.subtype === 'login_prompt' && pendingOAuthState === message.metadata?.oauthState}
            isModelPickerActive={message.metadata?.subtype === 'model_picker' && pendingModelPickerIndex === i}
          />
        {/each}

        {#if sending}
          <div class="flex items-center gap-3 animate-fade-in">
            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-secondary-light flex items-center justify-center">
              <Loader2 class="w-4 h-4 text-secondary animate-spin" />
            </div>
            <div class="typing-indicator bg-surface border border-border rounded-2xl">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        {/if}
      {:else}
        <div class="h-full flex items-center justify-center">
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description={isActive
              ? "Send a message to start working with Claude"
              : "This instance has no message history"}
          />
        </div>
      {/if}
    </div>

    <!-- Chat Input -->
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
          : 'Type a message... (⌘↵ to send, / for commands)'}
      {commands}
    />

  {:else}
    <!-- Instance not found -->
    <div class="flex-1 flex items-center justify-center bg-bg">
      <EmptyState
        icon={AlertCircle}
        title="Instance not found"
        description="This instance may have been removed or doesn't exist"
        action={{ label: 'Back to Instances', onClick: () => goto('/instances') }}
      />
    </div>
  {/if}
</div>

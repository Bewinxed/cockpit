<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { ArrowDown, Bot, Loader2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import InstanceHeader from './InstanceHeader.svelte';
  import { ChatMessage, ChatInput, StreamingIndicator, PermissionRequest, ToolGroup, SubagentBranch } from '$lib/components/features';
  import { UseAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
  import { ActivityGrid } from '$lib/components/ui/activity-grid';
  import {
    instances,
    agents,
    permissions as permissionsStore,
    type Message
  } from '$lib/stores';
  import { api } from '$lib/api';

  interface AvailableCommand {
    name: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
    description?: string;
    source?: string;
  }

  interface DbMessage {
    id: string;
    instanceId: string;
    timestamp: string | Date;
    sdkUuid?: string;
    // Normalized fields
    sdkType: string;
    sdkSubtype?: string | null;
    parentToolUseId?: string | null;
    role?: 'user' | 'assistant' | null;
    textContent?: string | null;
    rawContent: unknown;
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
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

  // Reactive stores for this instance - using new Svelte 5 entity stores
  const instance = $derived(instances.get(instanceId));
  const agent = $derived(instance?.machineId ? agents.get(instance.machineId) : undefined);

  // Messages and permissions for this instance
  const currentMessages = $derived(instances.getMessages(instanceId));
  const currentPermissions = $derived(permissionsStore.getByInstance(instanceId));

  // Streaming state
  const streamingState = $derived(instances.getStreamingState(instanceId));
  const streamingMessage = $derived(instances.getStreamingMessage(instanceId));

  // Transient status (compacting, etc.)
  const transientStatus = $derived(instances.getStatus(instanceId));

  // Track which instances we've loaded messages for
  let loadedInstances = $state(new Set<string>());
  let isLoadingMessages = $state(false);

  // Content block types from SDK messages
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
    | { type: string; [key: string]: unknown };

  // Parse database messages into UI format using normalized fields
  function parseDbMessages(dbMessages: DbMessage[]): Message[] {
    const result: Message[] = [];
    // First pass: collect tool results from user messages (SDK sends tool_result as user messages)
    const toolResults = new Map<string, { content: unknown; isError: boolean }>();

    for (const dbMsg of dbMessages) {
      // Use normalized sdkType field
      if (dbMsg.sdkType === 'user' && dbMsg.rawContent) {
        const raw = dbMsg.rawContent as { message?: { content?: ContentBlock[] } };
        if (raw.message?.content && Array.isArray(raw.message.content)) {
          for (const block of raw.message.content) {
            if (block?.type === 'tool_result') {
              const toolResultBlock = block as { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean };
              toolResults.set(toolResultBlock.tool_use_id, {
                content: toolResultBlock.content,
                isError: toolResultBlock.is_error || false,
              });
            }
          }
        }
      }
    }

    // Second pass: build messages and match tool results
    for (const dbMsg of dbMessages) {
      const sdkUuid = dbMsg.sdkUuid;
      // Use normalized parentToolUseId field
      const parentToolUseId = dbMsg.parentToolUseId ?? undefined;

      // Skip messages from subagents in main chat - they'll be shown in SubagentBranch
      if (parentToolUseId) {
        // Still parse tool_use blocks for subagent messages (they need to be in subagent.messages)
        if (dbMsg.sdkType === 'assistant' && dbMsg.rawContent) {
          const raw = dbMsg.rawContent as { message?: { content?: ContentBlock[] } };
          if (raw.message?.content && Array.isArray(raw.message.content)) {
            for (const block of raw.message.content) {
              if (block?.type === 'tool_use') {
                const toolUseBlock = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
                const toolResult = toolResults.get(toolUseBlock.id);
                result.push({
                  id: dbMsg.id + '-' + toolUseBlock.id,
                  instanceId,
                  type: 'tool_use',
                  content: toolUseBlock.name || 'Tool',
                  timestamp: new Date(dbMsg.timestamp),
                  sdkUuid,
                  parentToolUseId,
                  metadata: {
                    toolId: toolUseBlock.id,
                    toolName: toolUseBlock.name,
                    toolInput: toolUseBlock.input,
                    toolResult: toolResult?.content,
                    toolStatus: toolResult ? (toolResult.isError ? 'error' : 'success') : 'pending',
                  },
                });
              }
            }
          }
        }
        continue;
      }

      // Use normalized textContent for user messages
      if (dbMsg.sdkType === 'user' && dbMsg.textContent) {
        result.push({
          id: dbMsg.id,
          instanceId,
          type: 'user',
          content: dbMsg.textContent,
          timestamp: new Date(dbMsg.timestamp),
          sdkUuid,
        });
      } else if (dbMsg.sdkType === 'assistant' && dbMsg.rawContent) {
        const raw = dbMsg.rawContent as { message?: { content?: ContentBlock[] } };
        if (raw.message?.content && Array.isArray(raw.message.content)) {
          for (const block of raw.message.content) {
            if (block?.type === 'text') {
              const textBlock = block as { type: 'text'; text: string };
              result.push({
                id: dbMsg.id,
                instanceId,
                type: 'assistant',
                content: textBlock.text,
                timestamp: new Date(dbMsg.timestamp),
                sdkUuid,
              });
            } else if (block?.type === 'tool_use') {
              const toolUseBlock = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
              const toolResult = toolResults.get(toolUseBlock.id);
              const toolInput = toolUseBlock.input;

              // Check if this is a Task tool (subagent spawn)
              const isTaskTool = toolUseBlock.name === 'Task';
              const subagentType = isTaskTool ? (toolInput?.subagent_type as string) : undefined;
              const subagentDescription = isTaskTool ? (toolInput?.description as string) : undefined;

              result.push({
                id: dbMsg.id + '-' + toolUseBlock.id,
                instanceId,
                type: 'tool_use',
                content: toolUseBlock.name || 'Tool',
                timestamp: new Date(dbMsg.timestamp),
                sdkUuid,
                metadata: {
                  toolId: toolUseBlock.id,
                  toolName: toolUseBlock.name,
                  toolInput: toolUseBlock.input,
                  toolResult: toolResult?.content,
                  toolStatus: toolResult ? (toolResult.isError ? 'error' : 'success') : 'pending',
                  // Add subagent metadata for Task tools
                  subagentType,
                  subagentDescription,
                },
              });
            }
          }
        }
      } else if (dbMsg.sdkType === 'system' && dbMsg.sdkSubtype === 'init') {
        result.push({
          id: dbMsg.id,
          instanceId,
          type: 'system',
          content: `Session started with ${dbMsg.model || 'Claude'}`,
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
      // Fetch messages and tool invocations in parallel
      const [messagesResponse, toolsResponse] = await Promise.all([
        api.api.instances({ id }).messages.get(),
        api.api.instances({ id }).tools.get(),
      ]);

      const messagesResult = messagesResponse.data;
      const messages = messagesResult?.data;
      const toolsResult = toolsResponse.data;
      const toolInvocations = toolsResult?.data;

      if (messages && Array.isArray(messages) && messages.length > 0) {
        // Check if we already have messages loaded
        const existingMessages = instances.getMessages(id);
        let parsedMessages: Message[];

        if (existingMessages.length === 0) {
          parsedMessages = parseDbMessages(messages as DbMessage[]);
          // Add each message to the store
          for (const msg of parsedMessages) {
            instances.addMessage(id, msg);
          }
        } else {
          parsedMessages = existingMessages;
        }

        // Reconstruct subagent tree from loaded messages and tool invocations
        if (parsedMessages.length > 0) {
          instances.reconstructSubagentsFromHistory(id, parsedMessages, toolInvocations);
        }
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  // Note: currentMessages is already derived above from messagesStoreRef

  // Helper to check if a message is a Task tool_use (subagent spawn)
  function isTaskToolUse(msg: Message): boolean {
    return msg.type === 'tool_use' && !!msg.metadata?.subagentType;
  }

  // Helper to check if a message is a TaskOutput tool (retrieves subagent results)
  // These are hidden from chat - the result is shown inside SubagentBranch
  function isTaskOutputTool(msg: Message): boolean {
    return msg.type === 'tool_use' && msg.metadata?.toolName === 'TaskOutput';
  }

  // Helper to check if a message belongs to a subagent (has parentToolUseId)
  // These are shown inside SubagentBranch, not in main chat
  function isSubagentMessage(msg: Message): boolean {
    return !!msg.parentToolUseId;
  }

  // Filter out:
  // - TaskOutput tools (retrieval wrappers)
  // - Messages with parentToolUseId (belong to subagents, shown in SubagentBranch)
  const chatMessages = $derived(
    currentMessages.filter(msg => !isTaskOutputTool(msg) && !isSubagentMessage(msg))
  );

  // Group consecutive tool messages for compact display
  // Task tools get grouped together for parallel display
  type MessageGroup =
    | { type: 'single'; message: Message; index: number }
    | { type: 'tool_group'; messages: Message[]; startIndex: number }
    | { type: 'subagent_group'; messages: Message[]; startIndex: number };

  const groupedMessages = $derived.by((): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < chatMessages.length) {
      const msg = chatMessages[i];

      // Task tool_use messages - group consecutive ones for parallel display
      if (isTaskToolUse(msg)) {
        const subagentMessages: Message[] = [msg];
        const startIndex = i;
        i++;

        // Collect consecutive Task tools (parallel agents)
        while (i < chatMessages.length && isTaskToolUse(chatMessages[i])) {
          subagentMessages.push(chatMessages[i]);
          i++;
        }

        groups.push({ type: 'subagent_group', messages: subagentMessages, startIndex });
      }
      // Regular tool messages get grouped together
      else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
        const toolMessages: Message[] = [msg];
        const startIndex = i;
        i++;

        while (i < chatMessages.length) {
          const nextMsg = chatMessages[i];
          // Don't include Task or TaskOutput tools in regular tool groups
          if ((nextMsg.type === 'tool_use' || nextMsg.type === 'tool_result') && !isTaskToolUse(nextMsg) && !isTaskOutputTool(nextMsg)) {
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
  let messagesContainer: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (messagesContainer) {
      autoScroll.ref = messagesContainer;
    }
  });

  const shouldAutoScroll = $derived(autoScroll.isAtBottom);

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

  // Get streaming state (streamingState, transientStatus, streamingMessage derived above)
  const isStreaming = $derived(streamingState?.isStreaming ?? false);

  // Streaming message text for progressive display
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

  // OAuth state
  let pendingOAuthState = $state<string | null>(null);
  let pendingAuthUrl = $state<string | null>(null);

  // Model picker state
  let pendingModelPickerIndex = $state<number | null>(null);
  // svelte-ignore state_referenced_locally
  let currentModel = $state<string | undefined>(instance?.model);

  // Memory picker state
  let pendingMemoryPickerIndex = $state<number | null>(null);


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

      instances.addMessage(instanceId, {
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
      instances.addMessage(instanceId, {
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

      instances.addMessage(instanceId, {
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
        instances.addMessage(instanceId, {
          type: 'system',
          content: 'Logged out successfully',
          timestamp: new Date(),
        });
      } catch (err) {
        instances.addMessage(instanceId, {
          type: 'system',
          content: `Logout failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date(),
        });
      }
    } else if (command === '/model') {
      if (!isActive) {
        instances.addMessage(instanceId, {
          type: 'system',
          content: 'Cannot change model: Instance is not running',
          timestamp: new Date(),
        });
        return;
      }

      instances.addMessage(instanceId, {
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

      pendingModelPickerIndex = currentMessages.length - 1;

      try {
        const response = await fetch(`/api/instances/${instanceId}/models`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch models');
        }

        instances.updateMessageMetadata(instanceId, pendingModelPickerIndex!, {
          loading: false,
          models: data.data.models || [],
          currentModel: data.data.currentModel,
        });
        currentModel = data.data.currentModel;
      } catch (err) {
        instances.updateMessageMetadata(instanceId, pendingModelPickerIndex!, {
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch models',
        });
      }
    } else if (command === '/memory') {
      instances.addMessage(instanceId, {
        type: 'system',
        content: 'Edit Memory',
        timestamp: new Date(),
        metadata: {
          subtype: 'memory_picker',
          memoryPhase: 'selection',
        },
      });

      pendingMemoryPickerIndex = currentMessages.length - 1;
    } else if (command === '/vim') {
      instances.addMessage(instanceId, {
        type: 'system',
        content: 'Vim Mode',
        timestamp: new Date(),
        metadata: {
          subtype: 'vim_info',
        },
      });
    } else if (command === '/terminal-setup') {
      instances.addMessage(instanceId, {
        type: 'system',
        content: 'Terminal Setup',
        timestamp: new Date(),
        metadata: {
          subtype: 'terminal_setup_info',
        },
      });
    } else if (command === '/clear') {
      // Clear local state
      instances.clearMessages(instanceId);
      instances.clearSubagentsForInstance(instanceId);

      // Delete messages from database
      try {
        await fetch(`/api/instances/${instanceId}/messages`, { method: 'DELETE' });
      } catch {
        // Ignore errors for clear command
      }

      // Notify agent if active
      if (isActive) {
        try {
          await api.api.instances({ id: instanceId }).send.post({ message: '/clear' });
        } catch {
          // Ignore errors for clear command
        }
      }

      instances.addMessage(instanceId, {
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
      instances.updateMessageMetadata(instanceId, pendingModelPickerIndex, {
        selectedModel: model,
      });
    }
    pendingModelPickerIndex = null;

    instances.addMessage(instanceId, {
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

    instances.updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
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

      instances.updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
        loading: false,
        memoryContent: data.data?.content || '',
        memoryPath: data.data?.path || (memoryType === 'project' ? './CLAUDE.md' : '~/.claude/CLAUDE.md'),
      });
    } catch (err) {
      instances.updateMessageMetadata(instanceId, pendingMemoryPickerIndex, {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch memory',
      });
    }
  }

  async function handleMemorySave(content: string): Promise<void> {
    if (pendingMemoryPickerIndex === null) return;

    const message = currentMessages[pendingMemoryPickerIndex];
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

    instances.addMessage(instanceId, {
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

    instances.addMessage(instanceId, {
      type: 'system',
      content: 'Login successful! You are now authenticated.',
      timestamp: new Date(),
    });
  }

  function handleLoginCancel() {
    pendingOAuthState = null;
    pendingAuthUrl = null;
    instances.addMessage(instanceId, {
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

    instances.clearMessages(instanceId);
    instances.addMessage(instanceId, {
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
      instances.addMessage(instanceId, {
        type: 'user',
        content: message,
        timestamp: new Date(),
      });
      if (pendingOAuthState) {
        try {
          await handleLoginSubmit(message);
        } catch (err) {
          instances.addMessage(instanceId, {
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

        instances.addMessage(instanceId, {
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
        instances.addMessage(instanceId, {
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
    instances.updateStreamingState(instanceId, { isStreaming: true });

    instances.addMessage(instanceId, {
      type: 'user',
      content: message,
      timestamp: new Date(),
    });

    try {
      const result = await api.api.instances({ id: instanceId }).send.post({
        message,
      });

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
              instances.addMessage(instanceId, {
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
          instances.updateStreamingState(instanceId, { isStreaming: false });
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      instances.updateStreamingState(instanceId, { isStreaming: false });
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
        instances.addMessage(instanceId, {
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
      {#if isLoadingMessages && chatMessages.length === 0}
        <div class="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 class="size-5 animate-spin mr-2" />
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
        {#each groupedMessages as group, groupIdx (group.type === 'tool_group' ? `tools-${group.startIndex}` : group.type === 'subagent_group' ? `subagents-${group.startIndex}` : group.message.id)}
          <div
            animate:flip={{ duration: 300 }}
            in:fly={{ y: 20, duration: 300 }}
            out:fly={{ y: -20, duration: 200 }}
          >
            {#if group.type === 'subagent_group'}
              <!-- Subagent group (Task tools) - render side by side if parallel -->
              {@const isParallel = group.messages.length > 1}
              <div class="flex items-start gap-3">
                <!-- Subagent avatar (single icon for the group) -->
                <div class="flex-shrink-0 w-9 h-9 rounded-xl bg-info/10 flex items-center justify-center mt-0.5">
                  <svg class="w-4.5 h-4.5 text-info" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                </div>
                <!-- Subagent branches - grid if parallel, stack if single -->
                <div class="flex-1">
                  {#if isParallel}
                    <!-- Parallel indicator -->
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
                        <!-- Fallback if subagent state not found (loading state) -->
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
                showTimestamp={i === 0 || chatMessages[i - 1]?.type !== message.type}
                onLoginSubmit={handleLoginSubmit}
                onLoginCancel={handleLoginCancel}
                onModelSelect={handleModelSelect}
                onModelCancel={handleModelCancel}
                onMemorySelect={handleMemorySelect}
                onMemorySave={handleMemorySave}
                onMemoryCancel={handleMemoryCancel}
                onDismissMessage={() => instances.removeMessage(instanceId, i)}
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
  {#if currentPermissions.length > 0}
    <div class="border-t border-border bg-warning/5 px-4 py-3">
      {#each currentPermissions as permission (permission.requestId)}
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

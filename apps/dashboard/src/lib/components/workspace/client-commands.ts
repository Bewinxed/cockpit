/**
 * Client-side command handling for instance workspace.
 *
 * Handles: /help, /login, /logout, /model, /clear, /memory, /vim, /terminal-setup
 */

import { instances, sendInstanceMessage } from '$lib/stores';
import { api } from '$lib/api';

export interface AvailableCommand {
  name: string;
  type: 'builtin' | 'custom' | 'skill' | 'mcp';
  description?: string;
  source?: string;
}

export const DEFAULT_COMMANDS: AvailableCommand[] = [
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

export const CLIENT_COMMANDS = ['/help', '/login', '/logout', '/model', '/clear', '/memory', '/vim', '/terminal-setup'] as const;
export type ClientCommand = (typeof CLIENT_COMMANDS)[number];

export function isClientCommand(msg: string): ClientCommand | null {
  const trimmed = msg.trim().toLowerCase();
  for (const cmd of CLIENT_COMMANDS) {
    if (trimmed === cmd || trimmed.startsWith(cmd + ' ')) {
      return cmd;
    }
  }
  return null;
}

export async function fetchCommands(instanceId: string, existingCommands: AvailableCommand[]): Promise<AvailableCommand[]> {
  try {
    const { data, error } = await api.api.instances({ id: instanceId }).commands.get();
    if (error) {
      console.error('Failed to fetch commands:', error);
      return existingCommands;
    }
    if (data?.success && data.data) {
      const result = data.data as { commands?: AvailableCommand[] };
      const fetchedCommands = result.commands || [];
      const fetchedNames = new Set(fetchedCommands.map(c => c.name));
      const uniqueDefaults = DEFAULT_COMMANDS.filter(c => !fetchedNames.has(c.name));
      return [...fetchedCommands, ...uniqueDefaults];
    }
  } catch (err) {
    console.error('Failed to fetch commands:', err);
  }
  return existingCommands;
}

// ============================================
// Login / OAuth flow
// ============================================

export async function startLoginFlow(instanceId: string): Promise<string | null> {
  try {
    const { data, error: startError } = await api.api.auth.oauth.start.post();

    if (startError || !data?.success) {
      throw new Error('Failed to start OAuth flow');
    }

    instances.addMessage(instanceId, {
      type: 'system.login_prompt',
      content: 'Login to Claude',
      timestamp: new Date(),
      metadata: {
        subtype: 'login_prompt',
        authUrl: data.data.authUrl,
        oauthState: data.data.state,
      },
    });

    return data.data.state;
  } catch (err) {
    instances.addMessage(instanceId, {
      type: 'ui.error',
      content: `Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      timestamp: new Date(),
    });
    return null;
  }
}

export async function handleLoginSubmit(instanceId: string, code: string, pendingOAuthState: string): Promise<void> {
  const { data, error: callbackError } = await api.api.auth.oauth.callback.post({
    code: code.trim(),
    state: pendingOAuthState,
  });

  if (callbackError || !data?.success) {
    const errorMsg = (callbackError as { value?: { message?: string } })?.value?.message || (data as { error?: string })?.error || 'Token exchange failed';
    throw new Error(errorMsg);
  }

  instances.addMessage(instanceId, {
    type: 'system.notice',
    content: 'Login successful! You are now authenticated.',
    timestamp: new Date(),
  });
}

// ============================================
// Client command handler
// ============================================

import type { Message } from '$lib/stores';

export interface ClientCommandContext {
  instanceId: string;
  instance: { machineId?: string; status?: string; model?: string } | undefined;
  commands: AvailableCommand[];
  isActive: boolean;
  currentMessages: Message[];
}

export async function handleClientCommand(
  command: ClientCommand,
  ctx: ClientCommandContext,
): Promise<{
  pendingModelPickerIndex?: number | null;
  pendingMemoryPickerIndex?: number | null;
  commands?: AvailableCommand[];
}> {
  const { instanceId, instance, isActive, currentMessages } = ctx;
  let { commands } = ctx;

  if (command === '/help') {
    commands = await fetchCommands(instanceId, commands);

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
      type: 'ui.help_menu',
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
    return { commands };
  }

  if (command === '/login') {
    await startLoginFlow(instanceId);
    return {};
  }

  if (command === '/logout') {
    try {
      await api.api.auth.logout.delete();
      instances.addMessage(instanceId, {
        type: 'system.notice',
        content: 'Logged out successfully',
        timestamp: new Date(),
      });
    } catch (err) {
      instances.addMessage(instanceId, {
        type: 'ui.error',
        content: `Logout failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    }
    return {};
  }

  if (command === '/model') {
    if (!isActive) {
      instances.addMessage(instanceId, {
        type: 'ui.error',
        content: 'Cannot change model: Instance is not running',
        timestamp: new Date(),
      });
      return {};
    }

    instances.addMessage(instanceId, {
      type: 'system.model_picker',
      content: 'Switch Model',
      timestamp: new Date(),
      metadata: {
        subtype: 'model_picker',
        loading: true,
        models: [],
        currentModel: instance?.model,
      },
    });

    const modelPickerIndex = currentMessages.length; // after addMessage, it's at the end

    try {
      const response = await fetch(`/api/instances/${instanceId}/models`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch models');
      }

      instances.updateMessageMetadata(instanceId, modelPickerIndex, {
        loading: false,
        models: data.data.models || [],
        currentModel: data.data.currentModel,
      });
    } catch (err) {
      instances.updateMessageMetadata(instanceId, modelPickerIndex, {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch models',
      });
    }

    return { pendingModelPickerIndex: modelPickerIndex };
  }

  if (command === '/memory') {
    instances.addMessage(instanceId, {
      type: 'system.memory_picker',
      content: 'Edit Memory',
      timestamp: new Date(),
      metadata: {
        subtype: 'memory_picker',
        memoryPhase: 'selection',
      },
    });
    return { pendingMemoryPickerIndex: currentMessages.length };
  }

  if (command === '/vim') {
    instances.addMessage(instanceId, {
      type: 'system.vim_info',
      content: 'Vim Mode',
      timestamp: new Date(),
      metadata: { subtype: 'vim_info' },
    });
    return {};
  }

  if (command === '/terminal-setup') {
    instances.addMessage(instanceId, {
      type: 'system.terminal_setup_info',
      content: 'Terminal Setup',
      timestamp: new Date(),
      metadata: { subtype: 'terminal_setup_info' },
    });
    return {};
  }

  if (command === '/clear') {
    // Subagents are derived from messages, so clearing messages automatically clears subagents
    instances.clearMessages(instanceId);

    try {
      await fetch(`/api/instances/${instanceId}/messages`, { method: 'DELETE' });
    } catch {
      // Ignore errors for clear
    }

    if (isActive) {
      try {
        await sendInstanceMessage({ instanceId, message: '/clear' });
      } catch {
        // Ignore errors for clear
      }
    }

    instances.addMessage(instanceId, {
      type: 'system.notice',
      content: 'Conversation cleared',
      timestamp: new Date(),
    });
    return {};
  }

  return {};
}

// ============================================
// Model / Memory picker handlers
// ============================================

export async function handleModelSelect(instanceId: string, model: string, pendingModelPickerIndex: number | null): Promise<void> {
  const response = await fetch(`/api/instances/${instanceId}/models`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to set model');
  }

  if (pendingModelPickerIndex !== null) {
    instances.updateMessageMetadata(instanceId, pendingModelPickerIndex, {
      selectedModel: model,
    });
  }

  instances.addMessage(instanceId, {
    type: 'system.notice',
    content: `Model changed to ${model}`,
    timestamp: new Date(),
  });
}

export async function handleMemorySelect(instanceId: string, memoryType: 'project' | 'user', pendingMemoryPickerIndex: number): Promise<void> {
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

export async function handleMemorySave(
  instanceId: string,
  content: string,
  currentMessages: Message[],
  pendingMemoryPickerIndex: number,
): Promise<void> {
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

  instances.addMessage(instanceId, {
    type: 'system.notice',
    content: `Memory saved (${memoryType})`,
    timestamp: new Date(),
  });
}

export function isOAuthCode(msg: string): boolean {
  const trimmed = msg.trim();
  return trimmed.includes('#') && trimmed.length > 20 && !trimmed.startsWith('/');
}

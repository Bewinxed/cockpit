<script lang="ts">
  import { Shield, Check, X, ChevronDown, ChevronRight, LoaderCircle, Clock, Infinity as InfinityIcon } from 'lucide-svelte';
  import { permissions as permissionsStore, sendPermissionResponse, type PermissionRequest } from '$lib/stores';
  import type { PermissionUpdate } from '@agentdeck/core/types';

  interface Props {
    request: PermissionRequest;
  }

  let { request }: Props = $props();

  let isExpanded = $state(false);
  // Index of the allow option in flight, 'deny' for the deny button, null when idle
  let pendingAction = $state<null | 'deny' | number>(null);
  let error = $state<string | null>(null);

  // Parse suggestions into user-friendly options
  const allowOptions = $derived(() => {
    const options: Array<{
      label: string;
      description: string;
      permissions?: PermissionUpdate[];
      isSession?: boolean;
      isPermanent?: boolean;
    }> = [];

    // Always add "Allow once" as default
    options.push({
      label: 'Allow once',
      description: 'Allow this specific operation',
    });

    if (request.suggestions && Array.isArray(request.suggestions)) {
      for (const suggestion of request.suggestions as PermissionUpdate[]) {
        if (suggestion.type === 'addRules' && suggestion.behavior === 'allow') {
          const dest = suggestion.destination;
          const ruleDesc = suggestion.rules?.[0]?.ruleContent || request.toolName;

          if (dest === 'session') {
            options.push({
              label: 'Allow for session',
              description: `Allow "${ruleDesc}" until session ends`,
              permissions: [suggestion],
              isSession: true,
            });
          } else if (dest === 'projectSettings') {
            options.push({
              label: 'Always allow (project)',
              description: `Always allow "${ruleDesc}" in this project`,
              permissions: [suggestion],
              isPermanent: true,
            });
          } else if (dest === 'userSettings') {
            options.push({
              label: 'Always allow (global)',
              description: `Always allow "${ruleDesc}" everywhere`,
              permissions: [suggestion],
              isPermanent: true,
            });
          }
        }
      }
    }

    return options;
  });

  // Format tool input for display
  function formatToolInput(input: Record<string, unknown>): string {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }

  // Get a summary of the tool action
  function getActionSummary(): string {
    const { toolName, toolInput, blockedPath } = request;

    if (blockedPath) {
      return `${toolName} wants to access: ${blockedPath}`;
    }

    // Common tool summaries
    switch (toolName) {
      case 'Edit':
        return `Edit file: ${toolInput.file_path || 'unknown'}`;
      case 'Write':
        return `Write file: ${toolInput.file_path || 'unknown'}`;
      case 'Read':
        return `Read file: ${toolInput.file_path || 'unknown'}`;
      case 'Bash': {
        const cmd = String(toolInput.command || '').slice(0, 50);
        return `Run command: ${cmd}${cmd.length >= 50 ? '...' : ''}`;
      }
      case 'Glob':
        return `Search files: ${toolInput.pattern || 'unknown'}`;
      case 'Grep':
        return `Search content: ${toolInput.pattern || 'unknown'}`;
      default:
        return `${toolName} operation`;
    }
  }

  async function handleAllow(optionIndex: number, permissions?: PermissionUpdate[]) {
    pendingAction = optionIndex;
    error = null;
    try {
      const response = await sendPermissionResponse({
        requestId: request.requestId,
        instanceId: request.instanceId,
        behavior: 'allow',
        updatedInput: request.toolInput,
        updatedPermissions: permissions,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to send permission response');
      }

      // Remove from pending list
      permissionsStore.remove(request.requestId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to allow operation';
    } finally {
      pendingAction = null;
    }
  }

  async function handleDeny(message?: string) {
    pendingAction = 'deny';
    error = null;
    try {
      const response = await sendPermissionResponse({
        requestId: request.requestId,
        instanceId: request.instanceId,
        behavior: 'deny',
        message: message || 'User denied permission',
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to send permission response');
      }

      // Remove from pending list
      permissionsStore.remove(request.requestId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to deny operation';
    } finally {
      pendingAction = null;
    }
  }
</script>

<div class="bg-warning/10 p-3">
  <div class="flex gap-2 items-start">
    <div class="text-warning shrink-0 mt-0.5">
      <Shield size={18} />
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="font-semibold text-warning text-sm">Permission required</div>
        <!-- Yes/no cluster — top right so the body keeps the room for the explanation -->
        <div class="flex items-center gap-1.5 shrink-0 -mt-0.5">
          <button
            type="button"
            class="size-7 rounded-md flex items-center justify-center text-muted-foreground
                   hover:text-error hover:bg-error/10 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
            onclick={() => handleDeny()}
            disabled={pendingAction !== null}
            aria-label="Deny"
            title="Deny"
          >
            {#if pendingAction === 'deny'}
              <LoaderCircle size={14} class="animate-spin" />
            {:else}
              <X size={14} />
            {/if}
          </button>
          <button
            type="button"
            class="size-7 rounded-md flex items-center justify-center
                   bg-primary text-primary-foreground hover:bg-primary/90 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
            onclick={() => handleAllow(0, allowOptions()[0]?.permissions)}
            disabled={pendingAction !== null}
            aria-label="Allow once"
            title="Allow once"
          >
            {#if pendingAction === 0}
              <LoaderCircle size={14} class="animate-spin" />
            {:else}
              <Check size={14} />
            {/if}
          </button>
        </div>
      </div>
      <div class="text-muted-foreground text-sm mt-0.5 break-words">{getActionSummary()}</div>
      {#if request.decisionReason}
        <div class="text-muted-foreground text-xs mt-1 italic">{request.decisionReason}</div>
      {/if}

      <!-- Broader allow scopes as quiet chips, below the explanation -->
      {#if allowOptions().length > 1}
        <div class="flex flex-wrap items-center gap-1.5 mt-2">
          {#each allowOptions().slice(1) as option, idx (option.label)}
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground
                     border border-border/60 hover:text-foreground hover:bg-accent transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
              onclick={() => handleAllow(idx + 1, option.permissions)}
              disabled={pendingAction !== null}
              title={option.description}
            >
              {#if pendingAction === idx + 1}
                <LoaderCircle size={12} class="animate-spin" />
              {:else if option.isSession}
                <Clock size={12} />
              {:else}
                <InfinityIcon size={12} />
              {/if}
              {option.label}
            </button>
          {/each}
        </div>
      {/if}

      <button
        class="flex items-center gap-1 bg-transparent border-none py-1 text-muted-foreground text-xs cursor-pointer mt-1.5 hover:text-foreground"
        onclick={() => isExpanded = !isExpanded}
        type="button"
      >
        {#if isExpanded}
          <ChevronDown size={14} />
        {:else}
          <ChevronRight size={14} />
        {/if}
        <span>Details</span>
      </button>

      {#if isExpanded}
        <div class="bg-muted rounded p-2 mt-1 text-xs">
          <div class="flex gap-2 mb-1">
            <span class="font-medium text-muted-foreground shrink-0">Tool:</span>
            <span class="text-foreground">{request.toolName}</span>
          </div>
          <div class="flex gap-2">
            <span class="font-medium text-muted-foreground shrink-0">Input:</span>
            <pre class="bg-background/50 px-2 py-1 rounded font-mono text-xs whitespace-pre-wrap break-all max-h-[200px] overflow-auto m-0 flex-1">{formatToolInput(request.toolInput)}</pre>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="text-error text-xs mt-2 px-2 py-1 bg-error/10 rounded">{error}</div>
      {/if}
    </div>
  </div>
</div>

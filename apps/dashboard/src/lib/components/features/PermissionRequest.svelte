<script lang="ts">
  import { Shield, Check, X, ChevronDown, ChevronRight, LoaderCircle, Clock, Infinity as InfinityIcon } from 'lucide-svelte';
  import { permissions as permissionsStore, type PermissionRequest } from '$lib/stores';
  import { api } from '$lib/api';
  import { Button } from '$lib/components/ui/button';

  // Permission update types from SDK
  interface PermissionUpdate {
    type: 'addRules' | 'replaceRules' | 'removeRules' | 'setMode' | 'addDirectories' | 'removeDirectories';
    rules?: Array<{ toolName: string; ruleContent?: string }>;
    behavior?: 'allow' | 'deny' | 'ask';
    destination: 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg';
    mode?: string;
    directories?: string[];
  }

  interface Props {
    request: PermissionRequest;
  }

  let { request }: Props = $props();

  let isExpanded = $state(false);
  let isLoading = $state(false);
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

  async function handleAllow(permissions?: PermissionUpdate[]) {
    isLoading = true;
    error = null;
    try {
      const response = await api.api.instances({ id: request.instanceId }).permission.post({
        requestId: request.requestId,
        behavior: 'allow',
        updatedInput: request.toolInput,
        updatedPermissions: permissions,
      });

      if (response.error || !response.data?.success) {
        const errValue = response.error as { value?: { message?: string } } | undefined;
        throw new Error(errValue?.value?.message || 'Failed to send permission response');
      }

      // Remove from pending list
      permissionsStore.remove(request.requestId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to allow operation';
    } finally {
      isLoading = false;
    }
  }

  async function handleDeny(message?: string) {
    isLoading = true;
    error = null;
    try {
      const response = await api.api.instances({ id: request.instanceId }).permission.post({
        requestId: request.requestId,
        behavior: 'deny',
        message: message || 'User denied permission',
      });

      if (response.error || !response.data?.success) {
        const errValue = response.error as { value?: { message?: string } } | undefined;
        throw new Error(errValue?.value?.message || 'Failed to send permission response');
      }

      // Remove from pending list
      permissionsStore.remove(request.requestId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to deny operation';
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="bg-warning/10 border border-warning rounded-lg p-3 my-2">
  <div class="flex gap-2 items-start">
    <div class="text-warning shrink-0 mt-0.5">
      <Shield size={18} />
    </div>
    <div class="flex-1 min-w-0">
      <div class="font-semibold text-warning text-sm">Permission Required</div>
      <div class="text-muted-foreground text-sm mt-0.5 break-words">{getActionSummary()}</div>
      {#if request.decisionReason}
        <div class="text-muted-foreground text-xs mt-1 italic">{request.decisionReason}</div>
      {/if}
    </div>
  </div>

  <button
    class="flex items-center gap-1 bg-transparent border-none py-1 text-muted-foreground text-xs cursor-pointer mt-2 hover:text-foreground"
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
    <div class="bg-muted rounded p-2 mt-2 text-xs">
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

  <div class="flex justify-end items-center gap-2 mt-3 pt-2 border-t border-warning/50 flex-wrap">
    <Button
      variant="ghost"
      size="sm"
      onclick={() => handleDeny()}
      disabled={isLoading}
    >
      {#if isLoading}
        <LoaderCircle size={14} class="animate-spin" />
      {:else}
        <X size={14} />
      {/if}
      Deny
    </Button>

    <!-- Show allow options based on SDK suggestions -->
    {#if allowOptions().length > 1}
      <div class="flex gap-1 flex-wrap">
        {#each allowOptions() as option, i (option.label)}
          <Button
            variant={i === 0 ? 'secondary' : option.isPermanent ? 'ghost' : 'default'}
            size="sm"
            onclick={() => handleAllow(option.permissions)}
            disabled={isLoading}
            title={option.description}
          >
            {#if isLoading}
              <LoaderCircle size={14} class="animate-spin" />
            {:else if option.isSession}
              <Clock size={14} />
            {:else if option.isPermanent}
              <InfinityIcon size={14} />
            {:else}
              <Check size={14} />
            {/if}
            {option.label}
          </Button>
        {/each}
      </div>
    {:else}
      <Button
        variant="default"
        size="sm"
        onclick={() => handleAllow()}
        disabled={isLoading}
      >
        {#if isLoading}
          <LoaderCircle size={14} class="animate-spin" />
        {:else}
          <Check size={14} />
        {/if}
        Allow
      </Button>
    {/if}
  </div>
</div>

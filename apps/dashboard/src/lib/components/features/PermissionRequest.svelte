<script lang="ts">
  import { Shield, Check, X, ChevronDown, ChevronRight, Loader2, Clock, Infinity } from 'lucide-svelte';
  import type { PermissionRequest } from '$lib/stores/realtime.svelte';
  import { api } from '$lib/api';
  import { removePermissionRequest } from '$lib/stores/realtime.svelte';
  import Button from '$lib/components/ui/Button.svelte';

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
      case 'Bash':
        const cmd = String(toolInput.command || '').slice(0, 50);
        return `Run command: ${cmd}${cmd.length >= 50 ? '...' : ''}`;
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
        throw new Error(response.error?.message || 'Failed to send permission response');
      }

      // Remove from pending list
      removePermissionRequest(request.requestId);
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
        throw new Error(response.error?.message || 'Failed to send permission response');
      }

      // Remove from pending list
      removePermissionRequest(request.requestId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to deny operation';
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="permission-request">
  <div class="permission-header">
    <div class="permission-icon">
      <Shield size={18} />
    </div>
    <div class="permission-info">
      <div class="permission-title">Permission Required</div>
      <div class="permission-summary">{getActionSummary()}</div>
      {#if request.decisionReason}
        <div class="permission-reason">{request.decisionReason}</div>
      {/if}
    </div>
  </div>

  <button
    class="expand-toggle"
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
    <div class="permission-details">
      <div class="detail-row">
        <span class="detail-label">Tool:</span>
        <span class="detail-value">{request.toolName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Input:</span>
        <pre class="detail-code">{formatToolInput(request.toolInput)}</pre>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="permission-error">{error}</div>
  {/if}

  <div class="permission-actions">
    <Button
      variant="ghost"
      size="sm"
      onclick={() => handleDeny()}
      disabled={isLoading}
    >
      {#if isLoading}
        <Loader2 size={14} class="animate-spin" />
      {:else}
        <X size={14} />
      {/if}
      Deny
    </Button>

    <!-- Show allow options based on SDK suggestions -->
    {#if allowOptions().length > 1}
      <div class="allow-options">
        {#each allowOptions() as option, i}
          <Button
            variant={i === 0 ? 'secondary' : option.isPermanent ? 'ghost' : 'primary'}
            size="sm"
            onclick={() => handleAllow(option.permissions)}
            disabled={isLoading}
            title={option.description}
          >
            {#if isLoading}
              <Loader2 size={14} class="animate-spin" />
            {:else if option.isSession}
              <Clock size={14} />
            {:else if option.isPermanent}
              <Infinity size={14} />
            {:else}
              <Check size={14} />
            {/if}
            {option.label}
          </Button>
        {/each}
      </div>
    {:else}
      <Button
        variant="primary"
        size="sm"
        onclick={() => handleAllow()}
        disabled={isLoading}
      >
        {#if isLoading}
          <Loader2 size={14} class="animate-spin" />
        {:else}
          <Check size={14} />
        {/if}
        Allow
      </Button>
    {/if}
  </div>
</div>

<style>
  .permission-request {
    background: var(--color-warning-bg, #fef3c7);
    border: 1px solid var(--color-warning-border, #f59e0b);
    border-radius: var(--radius-md, 8px);
    padding: var(--spacing-3, 12px);
    margin: var(--spacing-2, 8px) 0;
  }

  .permission-header {
    display: flex;
    gap: var(--spacing-2, 8px);
    align-items: flex-start;
  }

  .permission-icon {
    color: var(--color-warning, #f59e0b);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .permission-info {
    flex: 1;
    min-width: 0;
  }

  .permission-title {
    font-weight: 600;
    color: var(--color-warning-text, #92400e);
    font-size: var(--text-sm, 14px);
  }

  .permission-summary {
    color: var(--color-text-secondary, #6b7280);
    font-size: var(--text-sm, 14px);
    margin-top: 2px;
    word-break: break-word;
  }

  .permission-reason {
    color: var(--color-text-tertiary, #9ca3af);
    font-size: var(--text-xs, 12px);
    margin-top: 4px;
    font-style: italic;
  }

  .expand-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: var(--spacing-1, 4px) 0;
    color: var(--color-text-secondary, #6b7280);
    font-size: var(--text-xs, 12px);
    cursor: pointer;
    margin-top: var(--spacing-2, 8px);
  }

  .expand-toggle:hover {
    color: var(--color-text-primary, #374151);
  }

  .permission-details {
    background: var(--color-bg-secondary, rgba(0, 0, 0, 0.05));
    border-radius: var(--radius-sm, 4px);
    padding: var(--spacing-2, 8px);
    margin-top: var(--spacing-2, 8px);
    font-size: var(--text-xs, 12px);
  }

  .detail-row {
    display: flex;
    gap: var(--spacing-2, 8px);
    margin-bottom: var(--spacing-1, 4px);
  }

  .detail-row:last-child {
    margin-bottom: 0;
  }

  .detail-label {
    font-weight: 500;
    color: var(--color-text-secondary, #6b7280);
    flex-shrink: 0;
  }

  .detail-value {
    color: var(--color-text-primary, #374151);
  }

  .detail-code {
    background: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
    padding: var(--spacing-1, 4px) var(--spacing-2, 8px);
    border-radius: var(--radius-sm, 4px);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs, 12px);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow: auto;
    margin: 0;
    flex: 1;
  }

  .permission-error {
    color: var(--color-error, #ef4444);
    font-size: var(--text-xs, 12px);
    margin-top: var(--spacing-2, 8px);
    padding: var(--spacing-1, 4px) var(--spacing-2, 8px);
    background: var(--color-error-bg, #fef2f2);
    border-radius: var(--radius-sm, 4px);
  }

  .permission-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--spacing-2, 8px);
    margin-top: var(--spacing-3, 12px);
    padding-top: var(--spacing-2, 8px);
    border-top: 1px solid var(--color-warning-border, #f59e0b);
    flex-wrap: wrap;
  }

  .allow-options {
    display: flex;
    gap: var(--spacing-1, 4px);
    flex-wrap: wrap;
  }

  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>

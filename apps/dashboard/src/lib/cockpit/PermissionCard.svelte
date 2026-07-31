<script lang="ts">
  import { Check, ChevronDown, ChevronRight, Shield, X } from '@lucide/svelte';
  import type { PermissionResult } from '@cockpit/core';
  import type { PendingPermission } from './client.svelte';
  import { permissionSummary } from './permission-summary';

  interface Props {
    request: PendingPermission;
    onResolve: (requestId: string, result: PermissionResult) => void;
  }

  let { request, onResolve }: Props = $props();

  let isExpanded = $state(false);

  const summary = $derived(permissionSummary(request.toolName, request.input));
  // The summary is cut to one line, so the details have to carry the whole thing —
  // reading it out of the JSON dump is not reviewing it.
  const command = $derived(
    typeof request.input.command === 'string' ? request.input.command : null
  );

  const detailsId = $props.id();
</script>

<div class="bg-warning/10 p-3" role="alert">
  <div class="flex gap-2 items-start">
    <div class="text-warning shrink-0 mt-0.5">
      <Shield size={18} />
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="font-semibold text-warning text-sm">Permission required</div>
        <div class="flex items-center gap-1.5 shrink-0 -mt-0.5">
          <button
            type="button"
            class="size-7 rounded-md flex items-center justify-center text-muted-foreground
                   hover:text-error hover:bg-error/10 transition-colors"
            onclick={() =>
              onResolve(request.requestId, { behavior: 'deny', message: 'User denied permission' })}
            aria-label="Deny"
            title="Deny"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            class="size-7 rounded-md flex items-center justify-center
                   bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onclick={() =>
              onResolve(request.requestId, { behavior: 'allow', updatedInput: request.input })}
            aria-label="Allow once"
            title="Allow once"
          >
            <Check size={14} />
          </button>
        </div>
      </div>
      <div class="text-muted-foreground text-sm mt-0.5 break-words">{summary}</div>

      <button
        type="button"
        class="flex items-center gap-1 bg-transparent border-none py-1 text-muted-foreground text-xs cursor-pointer mt-1.5 hover:text-foreground"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onclick={() => (isExpanded = !isExpanded)}
      >
        {#if isExpanded}
          <ChevronDown size={14} />
        {:else}
          <ChevronRight size={14} />
        {/if}
        <span>Details</span>
      </button>

      {#if isExpanded}
        <div id={detailsId} class="bg-muted rounded p-2 mt-1 text-xs flex flex-col gap-2">
          {#if command}
            <div class="flex gap-2">
              <span class="font-medium text-muted-foreground shrink-0">Command:</span>
              <pre class="bg-background/50 px-2 py-1 rounded font-mono text-xs whitespace-pre-wrap break-all max-h-[200px] overflow-auto m-0 flex-1">{command}</pre>
            </div>
          {/if}
          <div class="flex gap-2">
            <span class="font-medium text-muted-foreground shrink-0">Input:</span>
            <pre class="bg-background/50 px-2 py-1 rounded font-mono text-xs whitespace-pre-wrap break-all max-h-[200px] overflow-auto m-0 flex-1">{JSON.stringify(
                request.input,
                null,
                2
              )}</pre>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

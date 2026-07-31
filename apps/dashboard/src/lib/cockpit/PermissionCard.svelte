<script lang="ts">
  import { IconCheck, IconChevronRight, IconShield, IconClose } from '$lib/icons';
  import { scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import type { PermissionResult } from '@cockpit/core';
  import type { PendingPermission, PermissionAnswer } from './client.svelte';
  import { permissionAnswer } from './client.svelte';
  import { permissionSummary, suggestedRule } from './permission-summary';

  interface Props {
    request: PendingPermission;
    /** Whether the keyboard shortcuts answer this card — the stack's top one. */
    shortcuts?: boolean;
    onResolve: (requestId: string, result: PermissionResult) => void;
  }

  let { request, shortcuts = false, onResolve }: Props = $props();

  let isExpanded = $state(false);
  /**
   * The answer travels browser → hub → agent before the card is dropped, so the
   * card says it heard you the moment you click rather than sitting inert.
   */
  let resolved = $state<'allow' | 'deny' | null>(null);

  function answer(kind: PermissionAnswer) {
    if (resolved) return;
    resolved = kind === 'deny' ? 'deny' : 'allow';
    onResolve(request.requestId, permissionAnswer(request, kind));
  }

  const summary = $derived(permissionSummary(request.toolName, request.input));
  // The summary is cut to one line, so the details have to carry the whole thing —
  // reading it out of the JSON dump is not reviewing it.
  const command = $derived(
    typeof request.input.command === 'string' ? request.input.command : null
  );
  /** The rule an "always allow" would add, when the SDK suggested one. */
  const rule = $derived(request.suggestions?.length ? suggestedRule(request.suggestions) : null);

  const kbd = 'rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground';
</script>

<div class="bg-warning/10 p-3" role="alert">
  <div class="flex gap-2 items-start">
    <div class="text-warning shrink-0 mt-0.5">
      <IconShield class="size-[18px]" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="font-semibold text-warning text-sm">Permission required</div>
        <div class="flex items-center gap-1.5 shrink-0 -mt-0.5">
          {#if shortcuts}
            <kbd class={kbd}>N</kbd>
          {/if}
          <button
            type="button"
            disabled={!!resolved}
            class="size-7 rounded-md flex items-center justify-center
                   transition-[color,background-color,opacity] duration-200 ease-out
                   {resolved === 'deny'
              ? 'bg-error/10 text-error'
              : resolved
                ? 'text-muted-foreground opacity-0'
                : 'text-muted-foreground hover:text-error hover:bg-error/10'}"
            onclick={() => answer('deny')}
            aria-label="Deny"
            title="Deny"
          >
            <IconClose class="size-3.5" />
          </button>
          {#if shortcuts}
            <kbd class={kbd}>Y</kbd>
          {/if}
          <button
            type="button"
            disabled={!!resolved}
            class="size-7 rounded-md flex items-center justify-center
                   transition-[color,background-color,opacity] duration-200 ease-out
                   {resolved === 'allow'
              ? 'bg-success text-success-foreground'
              : resolved
                ? 'bg-primary text-primary-foreground opacity-0'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
            onclick={() => answer('allow')}
            aria-label="Allow once"
            title="Allow once"
          >
            {#key resolved}
              <span in:scale={{ duration: resolved ? 260 : 0, start: 0.25, easing: quintOut }}>
                <IconCheck class="size-3.5" />
              </span>
            {/key}
          </button>
        </div>
      </div>
      <div class="text-muted-foreground text-sm mt-0.5 break-words">{summary}</div>

      <Collapsible.Root open={isExpanded} onOpenChange={() => (isExpanded = !isExpanded)}>
        <div class="flex items-center gap-3 mt-1.5 min-w-0">
          <Collapsible.Trigger
            class="flex items-center gap-1 bg-transparent border-none py-1 text-muted-foreground text-xs cursor-pointer shrink-0 hover:text-foreground"
          >
            <IconChevronRight
              class="size-3.5 transition-transform duration-200 ease-out {isExpanded ? 'rotate-90' : ''}"
            />
            <span>Details</span>
          </Collapsible.Trigger>

          <!-- The SDK's own suggestions, granted verbatim — including where it
               wants them remembered, which is what the scope in the label says. -->
          {#if rule}
            <button
              type="button"
              disabled={!!resolved}
              class="flex items-center gap-1.5 min-w-0 bg-transparent border-none py-1 text-muted-foreground text-xs cursor-pointer
                     transition-colors hover:text-foreground disabled:opacity-40"
              title={rule.full}
              onclick={() => answer('always')}
            >
              <span class="truncate">Always allow {rule.short} ({rule.scope})</span>
              {#if shortcuts}
                <kbd class="{kbd} shrink-0">⇧Y</kbd>
              {/if}
            </button>
          {/if}
        </div>

        <Collapsible.Content>
          <div class="bg-muted rounded p-2 mt-1 text-xs flex flex-col gap-2">
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
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>
</div>

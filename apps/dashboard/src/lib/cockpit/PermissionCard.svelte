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
  const command = $derived(
    typeof request.input.command === 'string' ? request.input.command : null
  );
  const rule = $derived(request.suggestions?.length ? suggestedRule(request.suggestions) : null);

  const kbd =
    'rounded-[var(--radius-mark)] bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground shadow-sm border border-border/50';
</script>

<div class="bg-card rounded-[var(--radius-card)] shadow-sm p-4" role="alert">
  <div class="flex gap-2.5 items-start">
    <div class="text-muted-foreground shrink-0 mt-0.5">
      <IconShield class="size-[18px]" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="font-medium text-sm">Permission required</div>
      <div class="text-caption mt-0.5 break-words">{summary}</div>

      <Collapsible.Root open={isExpanded} onOpenChange={() => (isExpanded = !isExpanded)}>
        <Collapsible.Trigger
          class="flex items-center gap-1 bg-transparent border-none py-1 mt-1.5 text-muted-foreground text-micro cursor-pointer shrink-0
                 transition-colors duration-[160ms] ease-[var(--e-in)] hover:text-foreground"
        >
          <IconChevronRight
            class="size-3.5 transition-transform duration-[160ms] ease-[var(--e-in)] {isExpanded
              ? 'rotate-90'
              : ''}"
          />
          <span>Details</span>
        </Collapsible.Trigger>

        <Collapsible.Content>
          <div class="bg-muted/50 rounded-[var(--radius-well)] p-3 mt-1 text-micro flex flex-col gap-2.5">
            {#if command}
              <pre
                class="bg-background/60 px-3 py-2 rounded-[var(--radius-mark)] font-mono text-micro whitespace-pre-wrap break-all max-h-[200px] overflow-auto m-0"
              >{command}</pre>
            {:else}
              {#each Object.entries(request.input) as [key, value]}
                {@const text = typeof value === 'string' ? value : JSON.stringify(value)}
                {#if text.length > 200}
                  <!-- A diff or any long value inline would stretch the card past
                       the viewport; a capped block keeps the card answerable. -->
                  <div>
                    <div class="font-medium text-muted-foreground">{key}:</div>
                    <pre
                      class="bg-background/60 px-3 py-2 rounded-[var(--radius-mark)] font-mono text-micro whitespace-pre-wrap break-all max-h-[200px] overflow-auto mt-1 m-0"
                    >{text}</pre>
                  </div>
                {:else}
                  <div class="flex gap-2">
                    <span class="font-medium text-muted-foreground shrink-0">{key}:</span>
                    <span class="break-all">{text}</span>
                  </div>
                {/if}
              {/each}
            {/if}

            <details>
              <summary
                class="text-muted-foreground text-micro cursor-pointer select-none
                       transition-colors duration-[160ms] ease-[var(--e-in)] hover:text-foreground"
              >
                Raw
              </summary>
              <pre
                class="bg-background/60 px-3 py-2 rounded-[var(--radius-mark)] font-mono text-micro whitespace-pre-wrap break-all max-h-[200px] overflow-auto mt-1.5 m-0"
              >{JSON.stringify(request.input, null, 2)}</pre>
            </details>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>

      <!-- The three answers are not one row of buttons. A standing grant
           outlives this ask, so it sits on its own line above the two answers
           to it, held clear of Allow by more than the thumb that would cross
           into it; Deny and Allow then take opposite ends of the row below.
           Travel cost to a costly target is the point (Fitts 1954) — buttons
           set side by side make a rushed thumb a permanent permission. -->
      {#if rule}
        <div class="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!!resolved}
            class="inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-secondary px-3.5 py-2 text-micro font-medium text-secondary-foreground
                   transition-[color,background-color,opacity] duration-[160ms] ease-[var(--e-in)]
                   hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
            title={rule.full}
            aria-label="Always allow {rule.full} — a standing grant on {rule.scope}, not just this time"
            onclick={() => answer('always')}
          >
            <span class="truncate">Always allow {rule.short} ({rule.scope})</span>
            {#if shortcuts}
              <kbd class="{kbd} shrink-0">⇧Y</kbd>
            {/if}
          </button>
        </div>
      {/if}

      <div class="flex items-center gap-2 {rule ? 'mt-6 border-t border-border/50 pt-6' : 'mt-3'}">
        {#if shortcuts}
          <kbd class={kbd}>N</kbd>
        {/if}
        <button
          type="button"
          disabled={!!resolved}
          class="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-4 py-2 text-micro font-medium
                 transition-[color,background-color,border-color,opacity] duration-[160ms] ease-[var(--e-in)]
                 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
                 {resolved === 'deny'
            ? 'bg-error/10 text-error border-error/20'
            : resolved
              ? 'opacity-0'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
          onclick={() => answer('deny')}
          aria-label="Deny"
        >
          <IconClose class="size-3.5" />
          Deny
        </button>

        <div class="flex-1"></div>

        {#if shortcuts}
          <kbd class={kbd}>Y</kbd>
        {/if}
        <button
          type="button"
          disabled={!!resolved}
          class="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2 text-micro font-medium
                 transition-[color,background-color,opacity] duration-[160ms] ease-[var(--e-in)]
                 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
                 {resolved === 'allow'
            ? 'bg-success text-success-foreground'
            : resolved
              ? 'opacity-0'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
          onclick={() => answer('allow')}
          aria-label="Allow once"
        >
          {#key resolved}
            <span in:scale={{ duration: resolved ? 260 : 0, start: 0.25, easing: quintOut }}>
              <IconCheck class="size-3.5" />
            </span>
          {/key}
          Allow
        </button>
      </div>
    </div>
  </div>
</div>

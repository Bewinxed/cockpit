<script lang="ts">
  /**
   * Every session in the fleet parked on a human, in one calm list — the
   * Outpost fleet view's whole answer to "what needs me right now". A
   * permission or a question blocks the turn that asked it, so this is
   * derived straight off `cockpit.blocked` rather than tracked separately:
   * the moment a session clears its queue, the strip that named it is gone
   * too.
   *
   * Deliberately unalarming. `ActivityDot` already carries the one warning
   * tint the fleet uses for "needs you"; the rest of the strip reads like any
   * other row in the app, so a reader with six sessions waiting on them can
   * scan this calmly instead of bracing for six red banners.
   */
  import {
    cockpit,
    resolvePermission,
    permissionAnswer,
    type BlockedRequest,
    type PermissionAnswer,
  } from './client.svelte';
  import { permissionSummary } from './permission-summary';
  import { questionsOf } from './question';
  import { isTyping } from '$lib/utils/typing';
  import ActivityDot from './ActivityDot.svelte';
  import { Button } from '$lib/components/ui/button';
  import { fly, slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  const blocked = $derived(cockpit.blocked);

  /** A request only ever belongs to one session, but the pair is the honest key. */
  const rowKey = (item: BlockedRequest): string => `${item.instanceId}:${item.request.requestId}`;

  function answer(item: BlockedRequest, kind: PermissionAnswer): void {
    resolvePermission(
      item.instanceId,
      item.machineId,
      item.request.requestId,
      permissionAnswer(item.request, kind)
    );
  }

  /**
   * The same two-letter pairs the permission card answers to (`y`/`a` allow,
   * `n`/`d` deny), while the strip beneath them has focus. A question has no
   * one-key answer — it wants an actual choice made in the session — so it
   * never gets a shortcut here, and neither does a strip while the reader is
   * typing somewhere else.
   */
  function onKeydown(event: KeyboardEvent, item: BlockedRequest, isQuestion: boolean): void {
    if (isQuestion || isTyping()) return;
    const key = event.key.toLowerCase();
    if (key === 'y' || key === 'a') {
      event.preventDefault();
      answer(item, 'allow');
    } else if (key === 'n' || key === 'd') {
      event.preventDefault();
      answer(item, 'deny');
    }
  }
</script>

{#if blocked.length > 0}
  <section
    class="flex flex-col overflow-hidden rounded-xl bg-card shadow-md"
    aria-labelledby="attention-queue-heading"
  >
    <header class="flex items-center gap-2 px-4 pt-4 pb-2">
      <h2 id="attention-queue-heading" class="text-body font-medium text-foreground">Needs you</h2>
      <span
        class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning/15 px-1.5
               text-micro font-medium text-warning tabular-nums"
        aria-label="{blocked.length} {blocked.length === 1 ? 'session needs' : 'sessions need'} you"
      >
        {blocked.length}
      </span>
    </header>

    <ul class="flex flex-col">
      {#each blocked as item (rowKey(item))}
        {@const isQuestion = Boolean(questionsOf(item.request.toolName, item.request.input))}
        {@const summary = isQuestion
          ? 'asked a question'
          : permissionSummary(item.request.toolName, item.request.input)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          tabindex="0"
          aria-label="{item.hostname}: {summary}"
          class="flex items-start gap-3 border-t border-border/60 px-4 py-3 first:border-t-0
                 transition-colors duration-150 ease-out hover:bg-accent/40 focus-visible:bg-accent/50"
          onkeydown={(event) => onKeydown(event, item, isQuestion)}
          in:fly={{ y: -8, duration: 240, easing: quintOut }}
          out:slide={{ duration: 160, easing: quintOut }}
        >
          <span class="mt-1 shrink-0">
            <ActivityDot activity="blocked" />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <a
                href="/session/{item.instanceId}"
                class="text-body truncate font-medium text-foreground transition-colors hover:text-primary"
              >
                {item.hostname}
              </a>
              {#if item.cwd}
                <!-- The path is what tells two blocked sessions on the same
                     machine apart — TX-02, like every other path in the app. -->
                <span class="text-caption truncate font-mono">{item.cwd}</span>
              {/if}
            </div>
            <p class="text-body truncate text-muted-foreground">{summary}</p>
          </div>

          {#if !isQuestion}
            <div class="flex shrink-0 items-center gap-1.5 pt-0.5">
              <Button size="sm" onclick={() => answer(item, 'allow')}>Allow</Button>
              <Button size="sm" variant="ghost" onclick={() => answer(item, 'deny')}>Deny</Button>
              <Button size="sm" variant="ghost" href="/session/{item.instanceId}">Open</Button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

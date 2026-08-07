<script lang="ts">
  /**
   * Everything one session is parked on, as one card deep enough to see past.
   * A queue of permissions rendered in full pushes the transcript off screen and
   * asks the reader to decide four things at once — so the oldest is the card,
   * the rest are slivers behind it, and the whole list is one hover away.
   *
   * "Everything" includes the requests that are questions rather than
   * permissions: one place holds what is waiting on the reader, whichever of the
   * two it is.
   */
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';
  import type { PermissionResult } from '@cockpit/core';
  import type { PendingPermission } from './client.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import { questionsOf } from './question';

  interface Props {
    requests: PendingPermission[];
    onResolve: (requestId: string, result: PermissionResult) => void;
  }

  let { requests, onResolve }: Props = $props();

  let hovered = $state(false);
  let focused = $state(false);
  let clicked = $state(false);
  const expanded = $derived(hovered || focused || clicked);

  /** How far behind the top card each sliver sits. Two deep; the chip counts the rest. */
  const DEPTH = [
    { offset: 6, scale: 0.97, opacity: 0.7 },
    { offset: 12, scale: 0.94, opacity: 0.5 },
  ];

  /** The oldest request: the card the shortcuts answer, and the only one always shown. */
  const top = $derived(requests[0]);
  const rest = $derived(requests.slice(1));
  const slivers = $derived(DEPTH.slice(0, rest.length));

  const duration = (ms: number): number => (prefersReducedMotion.current ? 0 : ms);
</script>

{#snippet card(request: PendingPermission, shortcuts: boolean)}
  {@const questions = questionsOf(request.toolName, request.input)}
  {#if questions}
    <!-- Keyed, so the next question gets a card of its own. The selections live
         in the card's own state, sized from the questions it opened with: reuse
         it for a different request and the reader's choices carry over into a
         question that never offered them. -->
    {#key request.requestId}
      <QuestionCard {request} {questions} {shortcuts} {onResolve} />
    {/key}
  {:else}
    <PermissionCard {request} {shortcuts} {onResolve} />
  {/if}
{/snippet}

<div
  role="group"
  aria-label="Permissions waiting on you"
  tabindex="0"
  onclick={() => (clicked = !clicked)}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clicked = !clicked;
    }
  }}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    // Moving between the stack's own buttons is not leaving it.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focused = false;
  }}
>
  {#if top}
    <!-- The band the slivers peek into is held open expanded too, or the top card
         would jump up by it the moment the pointer arrives. -->
    <div class="relative {rest.length ? 'pt-4' : ''}">
      {#if !expanded}
        {#each slivers as depth, level (level)}
          <div
            class="pointer-events-none absolute inset-x-0 top-4 bottom-0 origin-top bg-card rounded-xl shadow-sm"
            style="transform: translateY(-{depth.offset}px) scale({depth.scale}); opacity: {depth.opacity};"
          ></div>
        {/each}
        {#if rest.length}
          <span
            class="pointer-events-none absolute top-0 right-2 rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground"
          >
            +{rest.length} more
          </span>
        {/if}
      {/if}

      {@render card(top, true)}
    </div>

    {#if expanded}
      {#each rest as request (request.requestId)}
        <div
          class="border-t border-border"
          in:slide={{ duration: duration(250), easing: quintOut }}
          out:slide={{ duration: duration(180), easing: quintOut }}
        >
          {@render card(request, false)}
        </div>
      {/each}
    {/if}
  {/if}
</div>

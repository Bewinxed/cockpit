<script lang="ts">
  /**
   * A reasoning trace on the rail — truncated, italic, muted, with a blinking
   * caret while the block is still being generated. Ported from the mock's
   * `.think`.
   *
   * "Truncated" was a promise the styling never kept: a long trace ran its full
   * length and drowned the ledger. Settled traces clamp to four lines behind a
   * quiet toggle; a live one stays open so its tail keeps arriving in view.
   */
  import { IconChevronRight } from "$lib/icons";

  let { text, live = false }: { text: string; live?: boolean } = $props();

  let expanded = $state(false);
  let bodyEl = $state<HTMLElement | null>(null);
  let overflows = $state(false);

  const clamped = $derived(!(live || expanded));

  /* Only a trace that is actually cut off earns a toggle — measured, because
     four lines of wrapped prose is not a character count. */
  $effect(() => {
    // Read, not used: these three are this effect's reactive dependencies —
    // any of them changing means the clamp may have changed and overflow must
    // be re-measured. Dropping the reads would drop the re-run.
    // biome-ignore lint/complexity/noVoid: see comment above — a bare reference would look unused and get "cleaned up".
    void text;
    // biome-ignore lint/complexity/noVoid: see comment above — a bare reference would look unused and get "cleaned up".
    void expanded;
    // biome-ignore lint/complexity/noVoid: see comment above — a bare reference would look unused and get "cleaned up".
    void live;
    const el = bodyEl;
    if (!el) {
      return;
    }
    overflows = expanded || el.scrollHeight - el.clientHeight > 1;
  });
</script>

<div class="think">
  <div class="body" bind:this={bodyEl} class:clamp={clamped}>
    {#if text}
      {text}
    {:else}
      Thinking…
    {/if}
    {#if live}
      <span class="caret"></span>
    {/if}
  </div>
  {#if !live && text && overflows}
    <button
      aria-expanded={expanded}
      class="more"
      onclick={() => {
        expanded = !expanded;
      }}
      type="button"
    >
      <span class="chev" class:open={expanded}><IconChevronRight /></span>
      {expanded ? 'Collapse' : 'Show all reasoning'}
    </button>
  {/if}
</div>

<style>
  .think {
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
    background: var(--rail) left top / 2px 100% no-repeat;
    font-style: italic;
    color: var(--ink-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    max-width: 70ch;
  }
  .body {
    white-space: pre-wrap;
  }
  .clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
    background: none;
    border: 0;
    padding: 0;
    font-family: inherit;
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--ink-muted);
    cursor: pointer;
  }
  .more:hover {
    color: var(--ink-body);
  }
  .more:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-mark);
  }
  .chev {
    display: grid;
    place-items: center;
    transition: transform var(--c-100) var(--e-in);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .chev :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }
  .caret {
    display: inline-block;
    width: 2px;
    height: 11px;
    background: var(--ink-muted);
    vertical-align: -1px;
    margin-left: 2px;
    animation: blink var(--c-500, 500ms) var(--e-in) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
    .chev {
      transition: none;
    }
  }
  @media (pointer: coarse) {
    .more {
      min-height: 44px;
    }
  }
  @media (max-width: 900px) {
    .think {
      margin-left: 0;
    }
  }
</style>

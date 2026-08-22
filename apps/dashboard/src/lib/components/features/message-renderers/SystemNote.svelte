<script lang="ts">
  /**
   * System note — a harness-injected ambient note, the quietest thing in the
   * transcript. Rail-led and collapsed by default: a single letter-spaced
   * small-caps trigger row the eye can skip, revealing the note on the rail
   * only when opened.
   */
  import type { Snippet } from 'svelte';
  import type { Message } from '$lib/cockpit/types';
  import * as Collapsible from '$lib/components/ui/collapsible';

  let {
    message,
    expanded = $bindable(false),
    body,
  }: { message: Message; expanded?: boolean; body?: Snippet } = $props();
</script>

<Collapsible.Root bind:open={expanded} class="note">
  <Collapsible.Trigger class="trigger">
    <svg
      class="chevron"
      class:open={expanded}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" stroke-width="1.6" />
    </svg>
    <span class="label">System note</span>
  </Collapsible.Trigger>
  <Collapsible.Content class="body">
    {@render body?.()}
  </Collapsible.Content>
</Collapsible.Root>

<style>
  :global(.note) {
    background: var(--rail) left top / 2px 100% no-repeat;
    padding-left: 12px;
    margin-left: 7px;
  }
  :global(.trigger) {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding: 0;
    background: none;
    border: 0;
    cursor: pointer;
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .chevron {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    transition: transform 160ms;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  :global(.body) {
    margin-top: var(--space-2);
    color: var(--ink-body);
  }
</style>

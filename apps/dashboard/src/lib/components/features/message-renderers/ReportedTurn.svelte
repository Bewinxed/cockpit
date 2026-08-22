<script lang="ts">
  /**
   * Reported turn — content that originated in ANOTHER session (a delegate's
   * report or a hand-off). Rail-led and attributed: the source is recognized by
   * the peer's identity hue, and the words sit at --ink-body ("quoted, not
   * spoken here"), one notch below a spoken turn.
   */
  import type { Snippet } from 'svelte';
  import type { Message } from '$lib/cockpit/types';
  import { markHue } from '$lib/cockpit/mark';
  import { ItemMark, StatusPill } from '$lib/outpost';

  let { message, body }: { message: Message; body?: Snippet } = $props();

  const peerName = $derived(message.metadata?.peerName);
  const reportKind = $derived(message.metadata?.reportKind);
  const failed = $derived(reportKind === 'failed');
</script>

<div class="reported">
  <div class="attr">
    <ItemMark hue={markHue(peerName ?? '')} class="peer" title={peerName}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M20 12H9M13 8l-4 4 4 4" stroke-width="1.6" />
      </svg>
    </ItemMark>
    {#if failed}
      <StatusPill status="fail">Failed</StatusPill>
    {/if}
    <span class="who">
      {#if reportKind}
        Report from {peerName ?? 'a delegate'}
      {:else}
        Handed over by {peerName ?? 'another session'}
      {/if}
    </span>
  </div>
  <div class="quoted">
    {@render body?.()}
  </div>
</div>

<style>
  .reported {
    background: var(--rail) left top / 2px 100% no-repeat;
    padding-left: 12px;
    margin-left: 7px;
  }
  .attr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .attr :global(.peer) {
    --c-mark: 16px;
    --c-mark-glyph: 10px;
  }
  .who {
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .quoted {
    color: var(--ink-body);
  }
</style>

<script lang="ts">
  /**
   * Command output — a slash-command readout (/help, /model). A recessed
   * --surface-sunken well: same surface language as a stat well, signalling
   * "the system computed this," not a spoken bubble. The command rides a mono
   * chip; the readout sits below at --ink-body.
   */
  import type { Snippet } from 'svelte';
  import type { Message } from '$lib/cockpit/types';

  let { message, body }: { message: Message; body?: Snippet } = $props();

  const command = $derived(message.metadata?.command);
</script>

<div class="output">
  {#if command}
    <span class="chip">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M7 8l4 4-4 4M13 16h4" stroke-width="1.6" />
      </svg>
      <span class="cmd">{command}</span>
    </span>
  {/if}
  <div class="readout">
    {@render body?.()}
  </div>
</div>

<style>
  .output {
    background: var(--surface-sunken);
    border-radius: var(--radius-well);
    padding: var(--space-3);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px 8px;
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-body);
    margin-bottom: var(--space-2);
  }
  .chip svg {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    color: var(--ink-muted);
  }
  .readout {
    color: var(--ink-body);
  }
</style>

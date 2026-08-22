<script lang="ts">
  /**
   * Reported speech — a message another session sent, or a rule firing. Never
   * the reader's own words, so it rides the rail as a peer note with a mark that
   * says who, rather than a `.who` turn. Quiet Ledger reported-speech line.
   */
  import type { Message } from '../types';
  import { IconSubagent, IconRules, IconArrowRight } from '$lib/icons';
  import MessageBody from './MessageBody.svelte';

  let { message }: { message: Message } = $props();

  const meta = $derived(message.metadata ?? {});
  const isRule = $derived(!!meta.ruleName);
  const isReport = $derived(!!meta.reportKind);
  const failed = $derived(meta.reportKind === 'failed');

  const label = $derived(
    isRule
      ? (meta.ruleName ?? 'rule')
      : isReport
        ? failed
          ? 'report — failed'
          : 'report'
        : (meta.peerName ?? meta.peerFrom ?? 'peer')
  );
</script>

<div class="peer" class:err={failed}>
  <span class="tag">
    {#if isRule}<IconRules />{:else if isReport}<IconArrowRight />{:else}<IconSubagent />{/if}
    {label}
  </span>
  <div class="pmsg"><MessageBody source={message.content} /></div>
</div>

<style>
  .peer {
    margin: 6px 0 0 7px;
    padding-left: 12px;
    background: var(--rail) left top / 2px 100% no-repeat;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--accent-text);
    background: var(--accent-bg-subtle);
    border-radius: var(--radius-mark);
    padding: 2px 7px;
  }
  .peer.err .tag {
    color: var(--status-fail-ink);
    background: var(--status-fail-bg);
  }
  .tag :global(svg) {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }
  .pmsg {
    margin: 3px 0 0 4px;
  }
</style>

<script lang="ts">
  /**
   * Reported speech — a message another session sent, or a rule firing. Never
   * the reader's own words, so it rides the rail as a peer note with a mark that
   * says who, rather than a `.who` turn. Quiet Ledger reported-speech line.
   */
  import type { Message } from '../types';
  import { IconSubagent, IconRules, IconArrowRight } from '$lib/icons';
  import { whiffle } from '../client.svelte';
  import { resolveInstanceId } from '../links';
  import MessageBody from './MessageBody.svelte';

  let { message }: { message: Message } = $props();

  const meta = $derived(message.metadata ?? {});
  const isRule = $derived(!!meta.ruleName);
  const isReport = $derived(!!meta.reportKind);
  const failed = $derived(meta.reportKind === 'failed');
  /** The delegate a report came from, by name and — where the fleet still has its row — by link. */
  const sender = $derived(isReport ? (meta.peerName ?? '') : '');
  const senderId = $derived(isReport ? resolveInstanceId(meta.peerSession, whiffle.instances) : undefined);

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
  {#if sender}
    {#if senderId}
      <a class="from" href="/session/{senderId}">{sender}</a>
    {:else}
      <span class="from">{sender}</span>
    {/if}
  {/if}
  <div class="pmsg"><MessageBody source={message.content} /></div>
</div>

<style>
  .peer {
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
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
    padding: 2px var(--space-2);
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
  /* Who reported, beside the tag — mono, like the handle everywhere else. */
  .from {
    margin-left: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    vertical-align: middle;
  }
  a.from {
    text-decoration: none;
    transition: color var(--c-100) var(--e-in);
  }
  @media (hover: hover) and (pointer: fine) {
    a.from:hover {
      color: var(--accent-text);
    }
  }
  .pmsg {
    margin: 3px 0 0 4px;
  }
</style>

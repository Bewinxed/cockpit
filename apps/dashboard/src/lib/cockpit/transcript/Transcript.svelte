<script lang="ts">
  /**
   * The scrolling transcript: the folded rows, virtualized. The live tail rides
   * as rows of its own (see `buildRows`), so streaming text, an open reasoning
   * block and the tool in flight all scroll with the conversation. Announces
   * blocked-on-you through the log's live region.
   */
  import { tick } from 'svelte';
  import { Virtualizer } from 'virtua/svelte';
  import type { SessionState } from '../client.svelte';
  import { buildRows } from './rows';
  import { IconSpinner } from '$lib/icons';
  import MessageRow from './MessageRow.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import Subagent from './Subagent.svelte';
  import Thinking from './Thinking.svelte';
  import MessageBody from './MessageBody.svelte';
  import Who from './Who.svelte';

  let {
    session,
    agentName,
    active,
  }: { session: SessionState; agentName: string; active: boolean } = $props();

  const rows = $derived(buildRows(session));

  let scroller = $state<HTMLElement | undefined>();
  let atBottom = $state(true);

  function onscroll(): void {
    if (!scroller) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  }

  // Follow the tail while the reader is already at the bottom — a scroll up to
  // read history is never yanked back by the next frame.
  $effect(() => {
    void rows.length;
    void session.streaming;
    if (!active || !atBottom || !scroller) return;
    void tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });
</script>

<div class="tr" role="log" aria-live="polite" aria-label="Session transcript" bind:this={scroller} {onscroll}>
  {#if session.loading && rows.length === 0}
    <p class="empty">Loading transcript…</p>
  {:else if rows.length === 0}
    <p class="empty">No messages yet.</p>
  {/if}

  <Virtualizer data={rows} getKey={(r) => r.key} scrollRef={scroller}>
    {#snippet children(row)}
      {#if row.kind === 'single'}
        <MessageRow message={row.message} {agentName} />
      {:else if row.kind === 'tools'}
        <ToolGroup messages={row.messages} />
      {:else if row.kind === 'question'}
        <QuestionCard message={row.message} />
      {:else if row.kind === 'subagent'}
        <Subagent branch={row.branch} spawn={row.spawn} />
      {:else if row.kind === 'thinking'}
        <Thinking text={row.text} live={row.live} />
      {:else if row.kind === 'stream'}
        <section class="turn">
          <Who name={agentName} />
          <MessageBody source={row.text} streaming />
        </section>
      {:else if row.kind === 'livetool'}
        <div class="livetool">
          <span class="ic"><IconSpinner /></span>
          <span class="tk">{row.glance.name}</span>
          <span class="arg">{row.glance.glance}</span>
        </div>
      {/if}
    {/snippet}
  </Virtualizer>
</div>

<style>
  .tr {
    flex: 1 1 auto;
    overflow-y: auto;
    /* asymmetric content padding is the DESIGN.md ledger signature:
       left --space-7 (25), right --space-6 (21). */
    padding: 0 var(--space-6) calc(var(--space-8) * 3) var(--space-7);
    min-height: 0;
    position: relative;
  }
  .empty {
    font-size: var(--text-sm);
    color: var(--ink-muted);
    padding: var(--space-5) 0;
  }
  @media (max-width: 900px) {
    .tr {
      padding-left: var(--space-5);
      padding-right: var(--space-5);
    }
  }
  .turn {
    margin-top: var(--space-4);
  }
  .livetool {
    /* one rhythm value (--space-4) tops every row type; the rail indent is
       --space-2 margin + --space-3 padding, shared across every rail block. */
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
    background: var(--rail) left top / 2px 100% no-repeat;
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--ink-body);
  }
  .livetool .ic {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    color: var(--ink-muted);
  }
  .livetool .ic :global(svg) {
    width: 15px;
    height: 15px;
    animation: spin 1s linear infinite;
  }
  .livetool .tk {
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
    flex: 0 0 auto;
  }
  .livetool .arg {
    font-family: var(--font-mono);
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .livetool .ic :global(svg) {
      animation: none;
    }
  }
</style>

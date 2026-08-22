<script lang="ts">
  /**
   * The newest turns of a conversation, rendered flat.
   *
   * The real transcript is virtualized (virtua), and a virtualizer has nothing
   * to measure on a server — so a reload used to paint an empty column and fill
   * it in only once the bundle had hydrated and the stream had answered. This
   * is what the SERVER draws instead: the same rows, folded by the same
   * `foldMessages` core, rendered by the same row components, in plain DOM.
   *
   * It is a stand-in, not a second transcript. The moment the store has the
   * conversation, `SessionPane` swaps `Transcript` in over the top — and because
   * the server's tail is cut exactly where `streamHistory`'s first chunk is cut,
   * the rows on screen are the rows that arrive, so the swap moves nothing.
   */
  import type { SessionMessage } from '@cockpit/core';
  import { mapTranscript } from '../frames';
  import { foldMessages } from './rows';
  import { describeTool } from '$lib/components/features/tool-cards/descriptors';
  import MessageRow from './MessageRow.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import Subagent from './Subagent.svelte';
  import Thinking from './Thinking.svelte';
  import MessageBody from './MessageBody.svelte';
  import Who from './Who.svelte';

  let {
    viewId,
    messages,
    agentName,
  }: { viewId: string; messages: SessionMessage[]; agentName: string } = $props();

  const folded = $derived(mapTranscript(viewId, messages));
  const rows = $derived(foldMessages(folded.messages, folded.subagents));
</script>

<!-- Not `role="log"`: the live region belongs to the transcript that will
     announce into it. Two logs on one screen would double every announcement
     for the instant both exist. -->
<div class="tail">
<div class="tr" aria-label="Session transcript">
  {#if rows.length === 0}
    <p class="empty">Loading transcript…</p>
  {/if}
  <!-- The row switch is Transcript.svelte's, component for component, so the
       static tail and the virtualized transcript are the same picture. -->
  {#each rows as row (row.key)}
    <div class="renter">
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
        {@const d = describeTool(row.glance.name, undefined, undefined, 'pending')}
        {@const LiveIcon = d.icon}
        <div class="livetool">
          <span class="ic {d.color}"><LiveIcon /></span>
          <span class="tk">{row.glance.name}</span>
          <span class="arg">{row.glance.glance}</span>
        </div>
      {/if}
    </div>
  {/each}
</div>
</div>

<style>
  /**
   * Pinned to the bottom, not scrolled to it. A server cannot scroll, and the
   * reader lands on the LATEST message — so the tail is laid out from the
   * bottom edge up and whatever runs off the top is clipped. The transcript
   * that replaces this opens on the same row, so the swap does not jump.
   */
  .tail {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  /* Deliberately identical to Transcript.svelte's `.tr` — the scroller the
     virtualized transcript replaces this with, down to the asymmetric ledger
     padding, so the swap does not shift a single row. */
  .tr {
    padding: 0 var(--space-6) calc(var(--space-8) * 3) var(--space-7);
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
  }
  .livetool .ic :global(svg) {
    width: 15px;
    height: 15px;
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
  .renter {
    display: block;
  }
</style>

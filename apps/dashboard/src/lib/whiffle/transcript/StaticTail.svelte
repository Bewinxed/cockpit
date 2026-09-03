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
  import type { SessionMessage } from "@whiffle/core";
  import { describeTool } from "$lib/components/features/tool-cards/descriptors";
  import { mapTranscript } from "../frames";
  import MessageBody from "./MessageBody.svelte";
  import MessageRow from "./MessageRow.svelte";
  import QuestionCard from "./QuestionCard.svelte";
  import Queued from "./Queued.svelte";
  import { foldMessages } from "./rows";
  import Subagent from "./Subagent.svelte";
  import SystemLine from "./SystemLine.svelte";
  import Thinking from "./Thinking.svelte";
  import ToolGroup from "./ToolGroup.svelte";
  import Who from "./Who.svelte";

  let {
    viewId,
    messages,
    agentName,
  }: { viewId: string; messages: SessionMessage[]; agentName: string } =
    $props();

  const folded = $derived(mapTranscript(viewId, messages));
  const rows = $derived(foldMessages(folded.messages, folded.subagents));

  /**
   * Newest FIRST — the DOM order is the reverse of the reading order, and
   * `.tr`'s `column-reverse` puts it back. This is the whole progressive-parse
   * fix: the browser paints this HTML as it streams, so with the oldest row
   * first every newly parsed row pushed the already-painted ones up (1.27 of
   * CLS on one load). Emitted newest-first into a bottom-anchored reversed
   * column, the first row parsed lands at the foot and never moves; each older
   * row stacks ABOVE it into space that is clipped anyway.
   */
  const painted = $derived([...rows].reverse());
</script>

<!-- Not `role="log"`: the live region belongs to the transcript that will
     announce into it. Two logs on one screen would double every announcement
     for the instant both exist. -->
<div class="tail">
  <section aria-label="Session transcript" class="tr">
    {#if rows.length === 0}
      <p class="empty">Loading transcript…</p>
    {/if}
    <!-- The row switch is Transcript.svelte's, component for component, so the
       static tail and the virtualized transcript are the same picture. -->
    {#each painted as row (row.key)}
      <div class="renter">
        {#if row.kind === 'single'}
          <MessageRow {agentName} message={row.message} />
        {:else if row.kind === 'tools'}
          <ToolGroup messages={row.messages} />
        {:else if row.kind === 'question'}
          <QuestionCard message={row.message} />
        {:else if row.kind === 'harness'}
          <SystemLine harness={row.note} />
        {:else if row.kind === 'subagent'}
          <Subagent branch={row.branch} spawn={row.spawn} />
        {:else if row.kind === 'thinking'}
          <Thinking live={row.live} text={row.text} />
        {:else if row.kind === 'stream'}
          <section class="turn">
            <Who name={agentName} />
            <MessageBody source={row.text} streaming />
          </section>
        {:else if row.kind === 'queued'}
          <Queued queued={row.queued} />
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
  </section>
  <!-- The seal. It exists only once every row above it has parsed, which is the
     one thing the stylesheet can ask about and the parser can answer honestly.
     See `.tail > .tr` below. -->
  <i aria-hidden="true" class="sealed"></i>
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
     padding, so the swap does not shift a single row.
     `column-reverse` is the only departure, and it is invisible: the rows are
     emitted newest-first (see `painted`) and read back bottom-up, so the
     picture is identical while the DOM order is the one progressive parsing
     can paint without moving anything. Every row root carries margin-top and
     no margin-bottom, so flex losing margin-collapsing changes no gap. */
  .tr {
    padding: 0 var(--space-6) calc(var(--space-8) * 3) var(--space-7);
    position: relative;
    display: flex;
    flex-direction: column-reverse;
    /* Its own content height, always: a tail taller than the viewport must
       overflow the TOP (and be clipped), never be squeezed to fit. */
    flex: 0 0 auto;
  }
  /**
   * Nothing paints until the tail is whole.
   *
   * Reversing the ROWS (above) stops a newly parsed row from pushing the
   * painted ones up, and it does — the newest row's box holds still while the
   * other 23 stack above it into clipped space. What it cannot fix is growth
   * INSIDE a row: the newest turn here is a single 1,200px answer, its own
   * paragraphs parse top-down, and in a bottom-anchored box that walks its top
   * edge upward — dragging every line already on screen with it. Measured at
   * 535px of travel, which is most of a 1.06 CLS on its own.
   *
   * A box cannot be anchored at both ends, so the tail simply does not paint
   * half-parsed. `.sealed` is emitted after the last row, so its existence *is*
   * the statement that the markup is complete, and `:has()` re-evaluates as the
   * parser goes. The cost is the few ms between the first row arriving and the
   * last; the return is that every pixel this component ever paints is final.
   *
   * Guarded, because a browser without `:has()` would otherwise hide the tail
   * for good — there is no script here to rescue it.
   */
  @supports selector(:has(*)) {
    .tail > .tr {
      visibility: hidden;
    }
    .tail:has(> .sealed) > .tr {
      visibility: visible;
    }
  }
  .sealed {
    display: none;
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

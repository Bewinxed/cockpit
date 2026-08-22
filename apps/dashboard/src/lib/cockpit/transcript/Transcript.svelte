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
  import { describeTool } from '$lib/components/features/tool-cards/descriptors';
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
  /** virtua's imperative handle — `scrollToIndex` reaches the true last row even
      as rows are still being measured, which a one-shot scrollTop cannot. */
  let list = $state<{ scrollToIndex: (i: number, opts?: { align?: 'start' | 'center' | 'end' | 'nearest' }) => void } | undefined>();
  let atBottom = $state(true);
  // The transcript opens on the latest message, not the top. virtua fires an
  // onscroll on mount (scrollTop 0, tall content) which would flip `atBottom`
  // false before the tail-follow effect runs, leaving the reader at the top —
  // so the first landing is unconditional, and only then does `atBottom` govern.
  let landed = $state(false);

  function onscroll(): void {
    if (!scroller || !landed) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  }

  // Follow the tail while the reader is already at the bottom — a scroll up to
  // read history is never yanked back by the next frame.
  $effect(() => {
    void rows.length;
    void session.streaming;
    if (!active || rows.length === 0) return;
    if (!landed || atBottom) {
      void tick().then(() => {
        if (list) list.scrollToIndex(rows.length - 1, { align: 'end' });
        else if (scroller) scroller.scrollTop = scroller.scrollHeight;
        atBottom = true;
        landed = true;
      });
    }
  });

  // ── Enter motion ────────────────────────────────────────────────────────
  // A new tail turn fades in and rises 8px over ~150ms on MOUNT only — the one
  // live channel DESIGN.md §motion permits to move, never the structure.
  //
  // Coexisting with virtua is the whole trick: virtua mounts and unmounts rows
  // as they cross the viewport, so a naive `in:` transition would replay on
  // every scroll. The guard below fires the animation only when the row is a
  // GENUINELY new arrival — landed, at the tail, and its key never seen before.
  // The motion is opacity + `transform`, neither of which changes the measured
  // box, so virtua's ResizeObserver and scroll math are untouched.
  const seen = new Set<string>();
  const reduceMotionQuery =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  /**
   * Per-row enter action. A row animates only the first time its key is seen,
   * and only once the transcript has landed and the reader is at the tail — so
   * the initial history batch, a row virtua re-mounts on scroll, and older
   * chunks prepended above all stay still. `prefers-reduced-motion` → no motion.
   */
  function enterMotion(node: HTMLElement, key: string) {
    const fresh = landed && atBottom && !seen.has(key);
    seen.add(key);
    if (!fresh || reduceMotionQuery?.matches) return;
    const easing =
      getComputedStyle(node).getPropertyValue('--e-in').trim() ||
      'cubic-bezier(0.16, 1, 0.3, 1)';
    node.style.opacity = '0';
    const anim = node.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 150, easing, fill: 'both' }
    );
    anim.onfinish = () => {
      node.style.opacity = '';
      anim.cancel();
    };
  }

  // Seed every key already present before the transcript lands on its latest
  // message, so nothing that streamed in as history animates when scrolled to.
  $effect(() => {
    if (landed) return;
    for (const r of rows) seen.add(r.key);
  });

  // No separate "working"/status row: the live state is the streaming content
  // itself — the in-flight tool row (livetool), the thinking block, the streaming
  // turn, and the subagent branch each show their own progress inline. A second
  // row narrating "Thinking…/Running…" under the row already showing it is the
  // duplication no chat app ships. The send→stop button flip carries the bare
  // "heard you" gap before the first frame.
</script>

<div class="tr" role="log" aria-live="polite" aria-label="Session transcript" bind:this={scroller} {onscroll}>
  {#if session.loading && rows.length === 0}
    <p class="empty">Loading transcript…</p>
  {:else if rows.length === 0}
    <p class="empty">No messages yet.</p>
  {/if}

  <Virtualizer bind:this={list} data={rows} getKey={(r) => r.key} scrollRef={scroller}>
    {#snippet children(row)}
      <div class="renter" use:enterMotion={row.key}>
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
            <span class="ic breathe {d.color}"><LiveIcon /></span>
            <span class="tk">{row.glance.name}</span>
            <span class="arg">{row.glance.glance}</span>
          </div>
        {/if}
      </div>
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
    /* No `color` here: the tool family's `text-tool-*` tint governs the glyph;
       the generic case inherits --ink-body from .livetool. */
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

  /* Per-row enter wrapper: carries the mount-only fade+rise driven imperatively
     in `enterMotion`. No box of its own — the child's margin collapses through,
     so virtua measures the row's height exactly as before. */
  .renter {
    display: block;
  }

</style>

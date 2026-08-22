<script lang="ts">
  /**
   * The scrolling transcript: the folded rows, virtualized. The live tail rides
   * as rows of its own (see `buildRows`), so streaming text, an open reasoning
   * block and the tool in flight all scroll with the conversation. Announces
   * blocked-on-you through the log's live region.
   */
  import { tick, type Component } from 'svelte';
  import { Virtualizer } from 'virtua/svelte';
  import type { SessionState } from '../client.svelte';
  import { buildRows } from './rows';
  import {
    IconBoltDuo,
    IconGhostDuo,
    IconSubagentsDuo,
    IconToolWrite,
  } from '$lib/icons';
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

  // ── Working liveness ────────────────────────────────────────────────────
  // `session.busy` flips true on send — before the first frame — and false on
  // the turn's result, so it is the one signal that also covers the silent gap
  // between a send and the first token (session.streaming is still '' there).
  // Rather than a generic spinner, the cue names WHAT the agent is doing right
  // now, each state its own quiet duotone glyph + present-tense label. The glyph
  // breathes (restrained motion, the live channel); the label is the static cue.
  const delegating = $derived(
    Object.values(session.subagents).find(
      (b) => b.status === 'running' || b.status === 'starting'
    )
  );
  const runTool = $derived(
    session.currentTool
      ? describeTool(session.currentTool.name, undefined, undefined, 'pending')
      : undefined
  );
  type Activity = { icon: Component; tint: string; label: string };
  const activity = $derived.by((): Activity | null => {
    if (!session.busy) return null;
    // Most specific first: a named subagent, then a named tool, then the raw
    // main-loop phases, then the bare "heard you" gap right after a send.
    if (delegating)
      return {
        icon: IconSubagentsDuo,
        tint: 'text-tool-agent',
        label: `Delegating to ${delegating.description || delegating.subagentType || 'subagent'}…`,
      };
    if (session.currentTool && runTool)
      return {
        icon: runTool.icon,
        tint: runTool.color,
        label: `Running ${session.currentTool.name}…`,
      };
    if (session.openBlock === 'thinking')
      return { icon: IconBoltDuo, tint: 'text-tool-skill', label: 'Thinking…' };
    if (session.streaming)
      return { icon: IconToolWrite, tint: 'text-tool-write', label: 'Writing…' };
    return { icon: IconGhostDuo, tint: '', label: `${agentName} is working…` };
  });
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

  <!-- Persistent liveness: from the moment of send (busy flips before any frame
       arrives) until the turn's result, a restrained cue pins to the tail so the
       reader always knows the agent heard them — and names WHICH activity is in
       flight. The glyph breathes (the live channel); the label is the static cue
       that carries the meaning. Removes when the turn ends. -->
  {#if activity}
    {@const ActIcon = activity.icon}
    <div class="working">
      <span class="ic breathe {activity.tint}" aria-hidden="true"><ActIcon /></span>
      <span class="lbl">{activity.label}</span>
    </div>
  {/if}
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

  /* The pinned working cue — the one part of the ledger allowed to float. It
     rides the tail through scroll so the reader always sees it while a turn is
     live. Elevation via --shadow-tile (its 0.5px ring is the structural edge);
     a pill radius sized off the rhythm scale keeps it concentric with its pad. */
  .working {
    position: sticky;
    bottom: var(--space-4);
    z-index: 2;
    width: fit-content;
    margin: var(--space-4) 0 0 var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface);
    box-shadow: var(--shadow-tile);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    /* one-shot entrance, opacity only — never fights the sticky containing box */
    animation: cue-in var(--c-300) var(--e-in);
  }
  .working .ic {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
  }
  .working .ic :global(svg) {
    width: 15px;
    height: 15px;
  }
  .working .lbl {
    color: var(--ink-body);
    font-variant-numeric: tabular-nums;
  }

  /* Restrained ambient breath on the live glyph, transitioning opacity only —
     paired always with a static label (better-ui motion restraint). This is the
     sole continuous motion; every other cue here is a one-shot on mount. */
  .breathe :global(svg) {
    animation: breathe var(--breath) var(--e-toggle) infinite;
  }
  @keyframes breathe {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }
  @keyframes cue-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .breathe :global(svg) {
      animation: none;
      opacity: 1;
    }
    .working {
      animation: none;
    }
  }
</style>

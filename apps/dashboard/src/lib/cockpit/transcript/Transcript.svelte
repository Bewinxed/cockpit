<script lang="ts">
  /**
   * The scrolling transcript: the folded rows, virtualized. The live tail rides
   * as rows of its own (see `buildRows`), so streaming text, an open reasoning
   * block and the tool in flight all scroll with the conversation. Announces
   * genuine arrivals — and blocked-on-you — through a dedicated live region
   * beside the log, never through the virtualized container itself.
   */
  import { tick } from 'svelte';
  import { Virtualizer } from 'virtua/svelte';
  import type { SessionState } from '../client.svelte';
  import { buildRows, type Row } from './rows';
  import { describeTool } from '$lib/components/features/tool-cards/descriptors';
  import MessageRow from './MessageRow.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import Subagent from './Subagent.svelte';
  import Thinking from './Thinking.svelte';
  import Queued from './Queued.svelte';
  import MessageBody from './MessageBody.svelte';
  import SystemLine from './SystemLine.svelte';
  import Who from './Who.svelte';

  let {
    session,
    agentName,
    active,
    machineName = '',
    cwd = '',
    clearance = 0,
    onlanded,
  }: {
    session: SessionState;
    agentName: string;
    active: boolean;
    /** Where this session runs — named in the empty state, nowhere else. */
    machineName?: string;
    /** The folder it runs in — named in the empty state, nowhere else. */
    cwd?: string;
    /**
     * The measured height of the floating composer stack, in px. The bottom
     * padding is driven from `--composer-clearance` (set by the pane) — this is
     * the same measurement, taken as a prop only so the tail-follow can re-land
     * when a permission card grows the stack under the last row.
     */
    clearance?: number;
    /**
     * Fired once, the first time this transcript is actually settled on its
     * latest row — mounted, measured by virtua, and scrolled home. The pane
     * holds the server's static tail on screen until then, because virtua
     * needs several frames to measure its way down and a swap before that
     * shows a blank column for those frames.
     */
    onlanded?: () => void;
  } = $props();

  /**
   * The folded rows — frozen while this pane is off screen.
   *
   * The session layout keeps one pane per open tab and never unmounts it, so
   * the scroll offset and the half-typed message survive a switch. The cost of
   * that was paid on every streamed frame: a session streaming into a tab the
   * reader is NOT looking at rebuilt every row and re-parsed the streaming
   * turn's markdown, frame after frame, forever. Measured at 1.09s of script
   * and 513 layouts per 300 streamed frames — MORE than the same stream costs
   * in the pane actually on screen, because the background session was the
   * large one. With several tabs open and one session streaming, the reader
   * pays that for a picture nobody can see.
   *
   * So an inactive transcript stops reading the session at all. While `active`
   * is false the body below touches only `active` and the array it already
   * built, which means nothing the session writes can invalidate it — there is
   * no recompute to skip because there is no invalidation. virtua stays mounted
   * on the rows it already has, so the DOM, the heights it measured and the
   * scroll offset are all untouched and a frozen pane costs nothing per frame.
   *
   * `active` is tracked, so flipping it back on invalidates this once: the pane
   * catches up in a single recompute, and the tail-follow effect below re-lands
   * it if the reader was at the tail when they left.
   */
  let frozen: Row[] = [];
  /** Whether `frozen` holds a real build yet — the first one is unconditional. */
  let primed = false;
  const rows = $derived.by<Row[]>(() => {
    // A pane born off screen would otherwise hold an empty transcript until it
    // was first looked at, so the first build never consults `active`.
    if (!active && primed) return frozen;
    primed = true;
    const next = buildRows(session);
    // SETTLE CONTINUITY, decided before the DOM sees the rows (a post-render
    // effect would run after the enter action already fired): a rebuild in
    // which a live-tail row (`stream:*`) departed is the settle — its new rows
    // are the SAME content the reader just watched stream, wearing its final
    // keys. Pre-marking them seen is what stops a paragraph the reader has
    // already read from fading back in over itself.
    const prevKeys = new Set(frozen.map((row) => row.key));
    const hadLiveTail = frozen.some((row) => row.key.startsWith('stream:'));
    const hasLiveTail = next.some((row) => row.key.startsWith('stream:'));
    if (hadLiveTail && !hasLiveTail) {
      for (const row of next) if (!prevKeys.has(row.key)) seen.add(row.key);
    }
    frozen = next;
    return frozen;
  });

  /**
   * Compaction is a genuinely live process — the model is rewriting its own
   * context — and it says so with one sticky pill and a beating dot. It used to
   * warp the entire transcript through an SVG displacement filter; distorting
   * text the operator may be mid-sentence in, and repainting the whole scroll
   * surface every frame, is not a state indicator. The pill alone carries it.
   */
  const compacting = $derived(session.sdkStatus === 'compacting');

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

  /**
   * Put the last row fully in view, above the floating composer stack.
   *
   * `scrollToIndex(…, 'end')` seats the last row's foot on the VIEWPORT's foot,
   * which is behind the composer: the clearance is padding under the list, and
   * virtua's box math stops at the list. So the landing is two moves — virtua
   * measures its way to the true last row, then one more frame runs the scroller
   * to its own maximum, past the padding band, which is exactly the height of
   * the composer column. A tall permission card therefore never sits on top of
   * the message that raised it.
   */
  /** The doctrine's entry curve, solved numerically — Svelte/rAF tweens take a
   *  function, not a CSS keyword, and an approximation would be a second,
   *  slightly wrong vocabulary. cubic-bezier(0.16, 1, 0.3, 1) = --e-in. */
  function easeEntry(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton–Raphson on the bezier's x(t) to find the parameter for this time.
    const cx = (u: number) => 3 * u * (1 - u) * (1 - u) * 0.16 + 3 * u * u * (1 - u) * 0.3 + u ** 3;
    const cy = (u: number) => 3 * u * (1 - u) * (1 - u) * 1 + 3 * u * u * (1 - u) * 1 + u ** 3;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const x = cx(u) - t;
      const dx = 3 * (1 - u) * (1 - u) * 0.16 + 6 * u * (1 - u) * (0.3 - 0.16) + 3 * u * u * (1 - 0.3);
      if (Math.abs(dx) < 1e-6) break;
      u -= x / dx;
    }
    return cy(Math.min(1, Math.max(0, u)));
  }

  /** The one scroll tween in flight; a wheel, a new target or reduced motion kills it. */
  let glide: number | null = null;
  function cancelGlide(): void {
    if (glide !== null) cancelAnimationFrame(glide);
    glide = null;
  }

  /**
   * A NEW MESSAGE slides the transcript up rather than teleporting it: a
   * 300ms scroll tween on the entry curve, but only for a message-sized hop
   * (≤ two viewports). Landings, backlogs and anything farther stay instant —
   * animating a five-thousand-pixel jump is disorientation, not continuity —
   * and the reader's own wheel always wins (`onscroll` recomputes `atBottom`,
   * and a glide whose target stopped being the bottom is cancelled below).
   */
  function glideToBottom(): void {
    if (!scroller) return;
    const target = () => (scroller ? scroller.scrollHeight - scroller.clientHeight : 0);
    const from = scroller.scrollTop;
    const delta = target() - from;
    const short = delta > 0 && delta <= scroller.clientHeight * 2;
    if (!short || reduceMotionQuery?.matches) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    cancelGlide();
    const started = performance.now();
    const DURATION = 300; // var(--c-300), the layout-change tier
    const step = (now: number): void => {
      if (!scroller) return;
      const t = Math.min(1, (now - started) / DURATION);
      // Retarget live: streamed rows keep growing the height mid-glide.
      scroller.scrollTop = from + (target() - from) * easeEntry(t);
      if (t < 1 && atBottom) glide = requestAnimationFrame(step);
      else glide = null;
    };
    glide = requestAnimationFrame(step);
  }

  function land(): void {
    if (list) list.scrollToIndex(rows.length - 1, { align: 'end' });
    else if (scroller) scroller.scrollTop = scroller.scrollHeight;
    requestAnimationFrame(() => {
      if (!scroller) return;
      // The first landing teleports (the reader has no continuity to keep);
      // every follow after it glides.
      if (landed) glideToBottom();
      else scroller.scrollTop = scroller.scrollHeight;
      watchForPaint();
    });
    atBottom = true;
    landed = true;
  }

  /**
   * Say, exactly once, that this transcript is settled on its latest row.
   *
   * `streamHistory` clears `loading` on the FIRST chunk — the tail, cut where
   * the server's static tail is cut — so that is the moment this transcript
   * shows the same picture the static tail does. Older chunks prepend above it
   * afterwards and re-land it, which the reader never sees.
   */
  let settled = false;
  function settle(): void {
    if (settled || session.loading) return;
    settled = true;
    onlanded?.();
  }

  /** Whether a row is actually drawn where the reader is about to look. */
  function paintedInView(): boolean {
    if (!scroller) return false;
    const top = scroller.getBoundingClientRect().top;
    const bottom = top + scroller.clientHeight;
    for (const row of scroller.querySelectorAll('.renter')) {
      const box = row.getBoundingClientRect();
      if (box.height > 0 && box.bottom > top && box.top < bottom) return true;
    }
    return false;
  }

  /**
   * Wait for the landing to be VISIBLE, not merely done, then say so.
   *
   * Setting `scrollTop` does not re-render a virtualizer synchronously: virtua
   * learns where it is from the scroll event, recomputes its window, and Svelte
   * patches the rows a frame or two later. For those frames the scroller is at
   * the bottom of a 5,600px column with nothing rendered anywhere near it — an
   * empty box. Announcing the landing on the scroll alone therefore handed the
   * pane a transcript that was correct and blank, which is the white flash this
   * whole handshake exists to remove. So the honest signal is a row with height
   * inside the viewport; a dozen frames is the ceiling, after which the tail has
   * outstayed its usefulness whatever the virtualizer is doing.
   */
  let watching = false;
  function watchForPaint(): void {
    if (settled || watching) return;
    watching = true;
    let frames = 0;
    const check = (): void => {
      if (settled) {
        watching = false;
        return;
      }
      frames += 1;
      if (paintedInView() || frames > 12) {
        watching = false;
        settle();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  // A conversation with nothing in it never lands — `land` needs a row to
  // scroll to — so the handshake would never be answered and a pane waiting on
  // it would hold an invisible transcript for good. An empty read that has
  // finished IS settled; say so.
  $effect(() => {
    if (session.loading || rows.length > 0) return;
    landed = true;
    settle();
  });

  // Follow the tail while the reader is already at the bottom — a scroll up to
  // read history is never yanked back by the next frame. `clearance` is a
  // dependency too: when a permission card grows the composer column, the row
  // that was flush with the composer is now behind it, so the tail re-lands.
  //
  // `active` is read FIRST, before the tail it follows. Reading `session.streaming`
  // ahead of the guard re-ran this effect on every streamed frame of a pane
  // nobody was looking at — the same cost `rows` above stops paying, arriving
  // by the other door. Guarding first means an off-screen pane has no
  // dependency on the stream at all; and because `active` is itself tracked,
  // switching back re-runs this once, on rows that have just caught up.
  $effect(() => {
    if (!active) return;
    void rows.length;
    void session.streaming;
    void clearance;
    if (rows.length === 0) return;
    if (!landed || atBottom) void tick().then(land);
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
    return {
      destroy() {
        // The live tail's keys are CONSTANTS (`stream:text` / `stream:tool` /
        // `stream:thinking`), so `seen` remembering them meant only the very
        // first reply of a session's lifetime ever animated in — every later
        // one arrived stone still, which is the "new messages aren't animating"
        // defect. Forgetting the key when the live row leaves lets the next
        // turn's arrival animate again; ordinary rows keep their keys seen, so
        // scrolling history still replays nothing.
        if (key.startsWith('stream:')) seen.delete(key);
      },
    };
  }

  // Seed every key already present before the transcript lands on its latest
  // message, so nothing that streamed in as history animates when scrolled to.
  $effect(() => {
    if (landed) return;
    for (const r of rows) seen.add(r.key);
  });

  // ── The live region ─────────────────────────────────────────────────────
  // The scroll container is NOT the live region. virtua mounts and unmounts
  // rows as they cross the viewport, so `aria-live` on it re-reads history the
  // moment the operator scrolls, and re-reads the streaming turn on every token.
  // Instead: the same landed/seen-set guard the enter motion uses picks out
  // genuine arrivals, and says one coarse sentence about each.

  /**
   * What identifies a row for announcement purposes. The streaming rows are
   * deliberately unannounceable — their text arrives token by token, and a live
   * region fed from it is a stutter. The settled `single` row the turn becomes
   * is what says "replied". The in-flight tool is keyed by its call id rather
   * than its row key, which virtua reuses for every tool in turn.
   */
  function announceKeyOf(row: Row): string {
    if (row.kind === 'stream' || row.kind === 'thinking') return '';
    // A harness notification is plumbing the operator never asked for. It is
    // worth a line on the rail and nothing at all in the ear.
    if (row.kind === 'harness') return '';
    // Nor a queued message: the operator just sent it. Reading their own words
    // back to them, then again when the session starts on them, is noise.
    if (row.kind === 'queued') return '';
    if (row.kind === 'livetool') return `livetool:${row.glance.toolId}`;
    return row.key;
  }

  /**
   * The whole announceable vocabulary, and it is five phrases long. A row that
   * maps to nothing says nothing — a settled tool run, a prepended history
   * chunk and the operator's own message are all visible on a surface the
   * operator is looking at.
   */
  function phraseOf(row: Row): string {
    if (row.kind === 'single') {
      // The operator's own message needs no reading back to them.
      return row.message.type === 'user' ? '' : 'Agent replied';
    }
    if (row.kind === 'livetool') return `${row.glance.name} running`;
    return '';
  }

  /** What the polite region currently holds. Replaced, never appended to. */
  let announcement = $state('');
  const announced = new Set<string>();

  $effect(() => {
    // Before the transcript lands, everything on it is history, not an arrival.
    // A pane that is off screen is the same case twice over: it has no business
    // speaking about a surface the reader cannot see, and its rows are frozen
    // anyway. Both branches still SEED `announced`, so coming back to a tab
    // announces what arrived while it was away exactly once, rather than
    // re-reading the whole transcript.
    if (!landed || !active) {
      for (const r of rows) announced.add(announceKeyOf(r));
      return;
    }
    let phrase = '';
    for (const r of rows) {
      const key = announceKeyOf(r);
      if (!key || announced.has(key)) continue;
      announced.add(key);
      const said = phraseOf(r);
      if (said) phrase = said;
    }
    // A batch that lands in one frame says only its last line: three sentences
    // read back-to-back is the spam this region exists to stop.
    if (phrase) announcement = phrase;
  });

  // The end of a turn is a state change, not a row: the last thing the agent
  // said may have landed several frames before it stopped working. `busy`
  // falling is the only honest signal for it.
  // `busy` is still TRACKED off screen — it flips once a turn, not once a
  // frame, so it costs nothing — but only a pane on screen says so out loud.
  // Following it either way is what keeps `wasBusy` honest: dropping the
  // bookkeeping while hidden would make the next switch announce a turn that
  // finished minutes ago.
  let wasBusy = false;
  $effect(() => {
    const busy = session.busy;
    if (active && landed && wasBusy && !busy) announcement = 'Turn finished';
    wasBusy = busy;
  });

  /**
   * The blocked-on-you line, which interrupts: it is the one state where the
   * run has stopped and only the operator can restart it. Empty otherwise, so
   * clearing the block does not itself announce anything.
   */
  const blockedNote = $derived.by(() => {
    if (!landed) return '';
    if (session.pending.length > 0) return 'Agent needs your permission';
    if (rows[rows.length - 1]?.kind === 'question') return 'Question from the agent';
    return '';
  });

  // No separate "working"/status row: the live state is the streaming content
  // itself — the in-flight tool row (livetool), the thinking block, the streaming
  // turn, and the subagent branch each show their own progress inline. A second
  // row narrating "Thinking…/Running…" under the row already showing it is the
  // duplication no chat app ships. The send→stop button flip carries the bare
  // "heard you" gap before the first frame.
</script>

<!-- Off-screen, and the only thing on this surface that speaks. Two channels:
     what just arrived (polite, queued behind the reader), and what is blocking
     (assertive, because the run has stopped). -->
<p class="spoken" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
<p class="spoken" aria-live="assertive" aria-atomic="true">{blockedNote}</p>

<div
  class="tr"
  role="log"
  aria-label="Session transcript"
  bind:this={scroller}
  {onscroll}
>
  <!-- Pinned to the top of the transcript viewport (the foot is the composer's),
       first child so `position: sticky` actually holds. -->
  {#if compacting}
    <div class="compacting-note" role="status">
      <span class="beat" aria-hidden="true"></span>
      Compacting context…
    </div>
  {/if}
  {#if session.loading && rows.length === 0}
    <p class="empty">Loading transcript…</p>
  {:else if rows.length === 0}
    <!-- Not a shrug: where this session runs, then the two keys that do anything
         from the composer below. Left-aligned — this surface is a ledger. -->
    <div class="blank">
      <!-- Both halves or neither: the identity line is `machine : folder`, and
           half of it is a dangling colon. -->
      {#if machineName && cwd}
        <p class="b-where">{machineName} : {cwd}</p>
      {/if}
      <h2 class="b-lead">No messages yet.</h2>
      <p class="b-hint">
        Send the first instruction below — / lists this session's commands, @ names a machine or
        session.
      </p>
    </div>
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
        {:else if row.kind === 'harness'}
          <SystemLine harness={row.note} />
        {:else if row.kind === 'subagent'}
          <Subagent branch={row.branch} spawn={row.spawn} />
        {:else if row.kind === 'thinking'}
          <Thinking text={row.text} live={row.live} />
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
            <span class="ic breathe {d.color}"><LiveIcon /></span>
            <!-- The same anatomy the settled ToolGroup row has: the descriptor's
                 verb, then the mono argument, the verb omitted where the object
                 is the whole sentence. Printing `glance.name` here and `d.label`
                 once it settled changed the call's vocabulary the instant it
                 completed. -->
            {#if d.label}<span class="tk">{d.label}</span>{/if}
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
    padding-top: 0;
    padding-right: var(--space-6);
    padding-left: var(--space-7);
    /* The foot clears the floating composer COLUMN, not the bare pill: a
       permission card stacks above the input inside it and can stand 400px
       tall, which used to bury the very message that raised it.
       `--composer-clearance` is that column's measured height plus its offsets,
       published by the pane; the old fixed reserve is the floor, so a bare
       composer looks exactly as it did. */
    padding-bottom: max(calc(var(--space-8) * 3), var(--composer-clearance, 0px));
    min-height: 0;
    position: relative;
  }
  .empty {
    font-size: var(--text-sm);
    color: var(--ink-muted);
    padding: var(--space-5) 0;
  }

  /* The empty transcript. Quiet by construction — no fill, no border, no
     illustration; it is a caption on the ledger, so it sits where every other
     row starts rather than in the middle of the pane. */
  .blank {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) 0;
    line-height: var(--leading-body);
  }
  .b-where {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .b-lead {
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .b-hint {
    max-width: 44ch;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }

  .compacting-note {
    position: sticky;
    top: var(--space-3);
    z-index: 3;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    box-shadow: var(--shadow-lifted);
    font-size: var(--text-sm);
    color: var(--ink-body);
  }
  .compacting-note .beat {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--status-live-ink);
    animation: beat var(--breath) var(--e-toggle) infinite;
  }
  @keyframes beat {
    50% {
      opacity: 0.3;
    }
  }

  /* The live region is read, never seen: off-screen rather than
     `display: none`, which assistive tech skips entirely. */
  .spoken {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    /* Compaction's only motion is the pill's dot; still it, and the state is
       carried by the pill's presence alone. */
    .compacting-note .beat {
      animation: none;
    }
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
  /* The in-flight tool's glyph breathes — the one live channel — so the running
     row reads as in-progress against the still, completed rows in ToolGroup.
     This IS the progress indicator on tool usage; done rows hold their glyph. */
  .livetool .ic.breathe :global(svg) {
    animation: breathe var(--breath) var(--e-toggle) infinite;
  }
  @keyframes breathe {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .livetool .ic.breathe :global(svg) {
      animation: none;
      opacity: 1;
    }
  }

  /* Per-row enter wrapper: carries the mount-only fade+rise driven imperatively
     in `enterMotion`. No box of its own — the child's margin collapses through,
     so virtua measures the row's height exactly as before. */
  .renter {
    display: block;
  }

</style>

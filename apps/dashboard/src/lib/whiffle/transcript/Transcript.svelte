<script lang="ts">
  /**
   * The scrolling transcript: the folded rows, virtualized. The live tail rides
   * as rows of its own (see `buildRows`), so streaming text, an open reasoning
   * block and the tool in flight all scroll with the conversation. Announces
   * genuine arrivals — and blocked-on-you — through a dedicated live region
   * beside the log, never through the virtualized container itself.
   */
  import { tick, untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { Virtualizer } from 'virtua/svelte';
  import type { SessionState } from '../client.svelte';
  import { rebuildScheduler } from '../workspace/scheduler.svelte';
  import { buildRowsFrom, type FoldMemo, type Row } from './rows';
  import CatchUp from './CatchUp.svelte';
  import { describeTool } from '$lib/components/features/tool-cards/descriptors';
  import MessageRow from './MessageRow.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import Subagent from './Subagent.svelte';
  import Delegate from './Delegate.svelte';
  import Thinking from './Thinking.svelte';
  import Queued from './Queued.svelte';
  import MessageBody from './MessageBody.svelte';
  import SystemLine from './SystemLine.svelte';
  import Who from './Who.svelte';

  let {
    session,
    visible,
    focused = undefined,
    agentName,
    machineName = '',
    cwd = '',
    onlanded,
  }: {
    session: SessionState;
    /**
     * Whether this transcript is on screen at all. Governs how OFTEN rows are
     * built: a pane nobody can see reads its session only at the scheduler's
     * slow tier, and never in the flush that brings it on screen.
     */
    visible: boolean;
    /**
     * Whether this is the transcript being worked in. Governs how EAGERLY
     * rows are rebuilt, and who gets to ride the tail and announce.
     *
     * Defaults to `visible`, so the single-pane case — one transcript, on
     * screen, being read — behaves exactly as it always has.
     */
    focused?: boolean;
    agentName: string;
    /** Where this session runs — named in the empty state, nowhere else. */
    machineName?: string;
    /** The folder it runs in — named in the empty state, nowhere else. */
    cwd?: string;
    /** Optional callback when the transcript first renders content. */
    onlanded?: () => void;
  } = $props();

  /** One transcript, on screen, being read: `focused` follows `visible`. */
  const isFocused = $derived(focused ?? visible);

  /**
   * The old single flag, kept as the name the rest of this file reads.
   *
   * Everything below that asks "am I the transcript the reader is at" —
   * riding the streaming tail, announcing turns, landing on reactivation —
   * means FOCUSED. Only the row-building freeze means VISIBLE, and it says
   * so where it happens.
   */
  const active = $derived(isFocused);

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
   * So an invisible transcript stops reading the session at all. While
   * `visible` is false the body below touches only `visible` and the array it
   * already built, which means nothing the session writes can invalidate it —
   * there is no recompute to skip because there is no invalidation. virtua
   * stays mounted on the rows it already has, so the DOM, the heights it
   * measured and the scroll offset are all untouched and a frozen pane costs
   * nothing per frame.
   *
   * Flipping `visible` or `focused` back on does NOT rebuild in that flush.
   * The switch used to fold every message and re-render every row inside the
   * same task as the tab change — the dock's `appendChild`, the scroll
   * restore and a 256ms fold, all before the first paint — which is the
   * delay the reader felt as the tab sticking. Now the switch paints the
   * frozen rows as they are (`held`), and the catch-up runs after that paint
   * as an APPEND: the fold restarts at the last turn before the old end, so
   * every row before it keeps its identity and the keyed each touches only
   * the rows that are actually new. The tail-follow effect below then rides
   * to the new tail if the reader was at the tail when they left.
   *
   * The grid adds a third state between those two. A pane that is visible but
   * NOT focused still has to show what its agent is saying, but rebuilding it
   * on every frame of its own stream is what makes four panes cost four times
   * one. So it reads the session under `untrack` and depends on nothing but a
   * counter the scheduler bumps when this pane's turn comes round. The session
   * can write as often as it likes; only the tick invalidates this. A hidden
   * pane takes the same turns at the scheduler's slow tier, so that by the
   * time it is switched to there is usually nothing left to fold.
   */
  let frozen: Row[] = [];
  /** What `frozen` was folded from — the incremental fold's memory. */
  let memo: FoldMemo | null = null;
  /** Whether `frozen` holds a real build yet — the first one is unconditional. */
  let primed = false;
  /** Bumped by the scheduler. The ONLY dependency of an unfocused rebuild. */
  let rebuildTick = $state(0);
  /**
   * The switch flush, and the frame it paints: while this holds, the rows
   * are the frozen ones whatever the session says. Set on the rising edge of
   * `visible` / `focused` when there is something to catch up on, cleared
   * once that flush has painted.
   */
  let held = $state(false);
  /**
   * From the switch until the append lands — what the tail indicator shows.
   * Distinct from `held` because the fold itself happens after the hold is
   * released, and the indicator should stay until it has.
   */
  let catching = $state(false);
  /**
   * What the session looked like when these rows were last built.
   *
   * Coming back to a conversation used to rebuild every row and re-render
   * them — markdown parsed, code highlighted — whether or not a single word
   * had arrived while it was away. Measured on a real switch: one 256ms task
   * with the main thread blocked for all of it, which is the delay a reader
   * feels as the tab "sticking".
   *
   * Nothing that has not changed needs rebuilding. When the print matches,
   * the SAME array is returned, so the keyed each sees identical rows, no
   * component re-renders, and the pane simply becomes visible again.
   */
  let builtPrint = '';
  const printOf = (): string =>
    `${session.messages.length}:${session.streaming.length}:` +
    `${session.thinkingStream.length}:${session.busy ? 1 : 0}:${session.pending.length}:` +
    `${session.openBlock ? 1 : 0}`;
  /** Dev-only: the gate that catches an accidentally tracked session read. */
  const countBuild = (): void => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const w = window as unknown as { __transcriptBuilds?: Record<string, number> };
    w.__transcriptBuilds ??= {};
    const key = session.instanceId;
    w.__transcriptBuilds[key] = (w.__transcriptBuilds[key] ?? 0) + 1;
  };
  const built = $derived.by<{ rows: Row[]; shifted: boolean }>(() => {
    // The switch flush paints what is already there; the catch-up comes
    // after the paint, through `held` clearing.
    if (held) return { rows: frozen, shifted: false };
    // A pane born off screen would otherwise hold an empty transcript until it
    // was first looked at, so the first build never consults the tier.
    if (!isFocused && primed) {
      void rebuildTick;
      return untrack(() => (printOf() === builtPrint ? { rows: frozen, shifted: false } : run()));
    }
    // Reading the print tracks exactly the handful of fields that mean "there
    // is something new to draw", so an unchanged session cannot invalidate
    // this at all — and a changed one still rebuilds on the very next frame.
    if (primed && printOf() === builtPrint) return { rows: frozen, shifted: false };
    return run();
  });

  /**
   * The switch itself, before the DOM updates: on the rising edge of
   * `visible` or `focused`, hold the rows for this flush and schedule the
   * catch-up behind its paint. `$effect.pre` because the hold has to be in
   * place before the Virtualizer reads `built` in the same flush.
   *
   * The delay is `requestAnimationFrame` THEN `setTimeout(0)`, not either
   * alone. A rAF callback runs at the top of the next frame, before that
   * frame paints, and Svelte flushes the state change it makes in a
   * microtask right behind it — still before the paint, which is exactly the
   * blocking this exists to avoid. `setTimeout(0)` alone is a macrotask the
   * browser may run within the same frame interval, ahead of its rendering
   * step. The pair pins the work to the far side of one real paint.
   *
   * Nothing is held when the print already matches: a pane whose rows are
   * current simply becomes visible, with no indicator to flash.
   */
  let wasVisible = false;
  let wasFocused = false;
  $effect.pre(() => {
    const nowVisible = visible;
    const nowFocused = isFocused;
    const rising = (nowVisible && !wasVisible) || (nowFocused && !wasFocused);
    wasVisible = nowVisible;
    wasFocused = nowFocused;
    if (!rising || !primed) return;
    untrack(() => {
      if (held || printOf() === builtPrint) return;
      held = true;
      catching = true;
      returning = true;
      requestAnimationFrame(() => {
        setTimeout(() => {
          held = false;
        }, 0);
      });
    });
  });

  function run(): { rows: Row[]; shifted: boolean } {
    countBuild();
    builtPrint = printOf();
    return build();
  }

  function build(): { rows: Row[]; shifted: boolean } {
    const folded = buildRowsFrom(session, memo);
    memo = folded.memo;
    const next = folded.rows;
    // PREPEND DETECTION for virtua's `shift` mode: an older history chunk
    // arriving puts new rows ABOVE everything on screen — without `shift`,
    // virtua keeps the scroll OFFSET and the content lurches toward the top
    // (the post-SSR "jumps to the top then back" flash). A prepend is exact:
    // the tail row is unchanged and the old first row now sits deeper.
    // Returned WITH the rows so the Virtualizer reads both in the same flush.
    const oldFirst = frozen[0]?.key;
    const oldLast = frozen[frozen.length - 1]?.key;
    const shifted =
      frozen.length > 0 &&
      next.length > frozen.length &&
      next[next.length - 1]?.key === oldLast &&
      oldFirst !== undefined &&
      next.findIndex((row) => row.key === oldFirst) > 0;
    return { rows: next, shifted };
  }

  /**
   * Take a turn in the rotation while unfocused — the visible tier beside the
   * pane being read, the slow tier when hidden behind it — and give it back
   * on focus. The fingerprint is every cheap O(1) reading that means "there
   * is something new to draw" — deliberately not a deep comparison, because
   * the point is to skip the expensive build, not to do an expensive check
   * first.
   */
  $effect(() => {
    if (isFocused) return;
    return rebuildScheduler.join(
      session.instanceId,
      () =>
        `${session.messages.length}:${session.streaming.length}:` +
        `${session.thinkingStream.length}:${session.busy ? 1 : 0}:${session.pending.length}`,
      () => {
        rebuildTick += 1;
      },
      visible ? 'visible' : 'hidden'
    );
  });

  // Side effects that the derived CANNOT carry (Svelte forbids writes inside
  // $derived). An $effect runs after the derived is read but before the DOM
  // renders, so the bookkeeping stays in sync with what the Virtualizer sees.
  $effect(() => {
    const { rows: next } = built;
    // SETTLE CONTINUITY: a rebuild where the live tail (`stream:*`) departs
    // means those new rows are the SAME content wearing their final keys.
    // Pre-marking them seen stops a paragraph the reader already watched
    // streaming from fading in over itself.
    const prevKeys = new Set(frozen.map((row) => row.key));
    const hadLiveTail = frozen.some((row) => row.key.startsWith('stream:'));
    const hasLiveTail = next.some((row) => row.key.startsWith('stream:'));
    if (hadLiveTail && !hasLiveTail) {
      for (const row of next) if (!prevKeys.has(row.key)) seen.add(row.key);
      // SETTLE RE-SNAP: virtua swaps the live-tail rows for their final
      // keyed versions, which may measure differently for a frame. That
      // reflow fires a native scroll event that `onscroll` reads as the
      // user scrolling up — `atBottom` flips false and the follow loop
      // disengages, stranding the viewport hundreds of pixels from the
      // bottom. The settle is NOT a user gesture; the reader was following
      // and should keep following. Re-assert `atBottom` so the tail-follow
      // effect re-engages on the next tick.
      if (atBottom || (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 400)) {
        atBottom = true;
      }
    }
    frozen = next;
    primed = true;
    // The append has landed: the rows on screen are the session's again, and
    // the indicator under them has nothing left to wait for.
    if (untrack(() => catching && !held)) catching = false;
  });
  const rows = $derived(built.rows);

  /**
   * How many rows the SERVER paints — and nothing the browser ever hears about.
   *
   * `ssrCount` is virtua's server-render escape hatch: without it the store has
   * no viewport and no scroll offset to reason from, so it renders the empty
   * range `[0, -1]` and the server's HTML carries a transcript with no rows in
   * it. Handing it the row count makes the server emit exactly that many, which
   * (with the `ListItem` patch that keeps them in normal flow until mount) is
   * what puts the conversation in the first response.
   *
   * The catch is that it is not a render hint — it is a LATCH. The store reads
   * it ONCE, at construction (`createVirtualStore(data.length, itemSize,
   * ssrCount, …)`), sets `isSSR = !!ssrCount`, and pins its range at
   * `[0, ssrCount - 1]`; `$getRange` then short-circuits to that frozen pair for
   * as long as `isSSR` holds. The only thing in the whole store that clears the
   * flag is `ACTION_SCROLL_OFFSET_CHANGE` — a genuine scroll event whose offset
   * actually differs from the one on file.
   *
   * So a hydrating client that is handed `ssrCount` inherits that latch, and a
   * transcript shorter than its viewport can never shed it: there is nothing to
   * scroll, so no scroll event, so the range stays pinned at the row count the
   * page happened to hydrate with. Rows built after that — the message the
   * operator just sent, every frame the agent streams back — were folded, keyed
   * and handed to the Virtualizer correctly and then dropped on the floor by a
   * range that had stopped moving. Only a reload (a new store, a new count)
   * showed them. That is the whole "transcript does not update live" defect.
   *
   * Gating on `browser` is therefore not a micro-optimisation but the contract:
   * the count belongs to the server render, and the client builds a store that
   * measures its viewport like any other. The hydrating render draws no rows for
   * the microtask before `onMount` wires virtua's ResizeObserver to the
   * scroller; ResizeObserver notifications are delivered in the rendering step
   * BEFORE paint, so the measured range lands in the same frame and the gap is
   * never seen.
   */
  const ssrCount = $derived(browser ? undefined : built.rows.length);

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
    // The follow loop tags every write it makes. A scroll event anywhere else
    // is the READER — wheel, scrollbar drag, keyboard, momentum, anything —
    // and it ends the follow before `atBottom` is computed honestly below.
    if (following !== null) {
      if (Math.abs(scroller.scrollTop - lastWrite) <= 1) return;
      stopFollow();
    }
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
  /** The follow loop's handle, and its own LAST WRITE — the tag that tells the
   *  loop's scroll events from the reader's without caring which input device
   *  made them (a scrollbar drag fires no wheel event; a tagged write needs no
   *  event taxonomy at all). */
  let following: number | null = null;
  let lastWrite = -1;
  function stopFollow(): void {
    if (following !== null) cancelAnimationFrame(following);
    following = null;
    lastWrite = -1;
  }

  /**
   * TELEPROMPTER FOLLOW. Streaming arrives in irregular bursts, and any scheme
   * that moves per-arrival — a tween, native smooth scroll, damped chasing —
   * inherits that jitter, because the impulse IS the burst. So the follow is
   * decoupled: one loop at a CONSTANT reading pace, and bursts merely
   * accumulate below the fold while the viewport advances steadily. Velocity,
   * not distance, is what the eye judges as smooth. The pace ramps only under
   * a real backlog (more than half a viewport behind); past two viewports it
   * is a teleport, not a ride; reduced motion always snaps; and the loop
   * yields to the reader two ways — `atBottom` going false ends it, and any
   * scroll event that is not its own tagged write ends it in `onscroll`.
   */
  const FOLLOW_SPEED = 360; // px/s — a calm reading pace
  function followBottom(): void {
    if (!scroller) return;
    const target = () => (scroller ? scroller.scrollHeight - scroller.clientHeight : 0);
    const gap = target() - scroller.scrollTop;
    if (gap <= 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || gap > scroller.clientHeight * 2) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    if (following !== null) return; // one loop; it reads the live target
    let last = performance.now();
    const step = (now: number): void => {
      if (!scroller || !atBottom) return stopFollow();
      const dt = Math.min(64, now - last);
      last = now;
      const remaining = target() - scroller.scrollTop;
      if (remaining <= 0.5) {
        if (remaining > 0) {
          scroller.scrollTop = target();
          lastWrite = scroller.scrollTop;
        }
        return stopFollow();
      }
      // Duration-bounded, not distance-bounded: any engagement finishes in
      // ≤400ms (remaining/0.4 px/s closes the whole gap in 0.4s, recomputed
      // per frame so it decelerates into place). Only a genuinely small hop —
      // one message's worth — rides at the reading pace. Without this bound
      // the loop trod water at 360px/s for the whole duration of a long
      // stream it was chasing: a five-second crawl nobody asked for.
      const speed = Math.max(FOLLOW_SPEED, remaining / 0.4);
      scroller.scrollTop += Math.min(remaining, (speed * dt) / 1000);
      lastWrite = scroller.scrollTop;
      following = requestAnimationFrame(step);
    };
    following = requestAnimationFrame(step);
  }

  function land(): void {
    // `scrollToIndex` is virtua's far-row measuring power — needed for the
    // first landing and for catching up from a real distance. For the
    // message-sized follow it was the hard jump per stream batch that read as
    // jitter, so a followable gap goes to the loop untouched.
    const gap = scroller
      ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
      : 0;
    const instant = !landed;
    // A tab-return whose catch-up has just appended: the reader left at the
    // tail, so the new turns ride in from where they were. A gap past the
    // followable bound is first closed to within it in one silent write, and
    // the loop rides the rest — the same arrival at any distance, rather than
    // a teleport for a long absence. virtua measures the rows the ride
    // crosses as they enter the viewport; the loop reads the live target
    // every frame, so an estimate that firms up mid-ride is absorbed.
    const riding = landed && returning && gap > 0;
    // Consumed by the land that has somewhere to go: the rising edge lands
    // once on the frozen rows (gap 0) before the append does.
    if (gap > 0) returning = false;
    const bound = (scroller?.clientHeight ?? 0) * 2;
    const followable = !instant && !!scroller && (gap <= bound || riding);
    if (!followable) {
      if (list) list.scrollToIndex(rows.length - 1, { align: 'end' });
      else if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
    requestAnimationFrame(() => {
      if (!scroller) return;
      // First landings teleport — there is no continuity to keep; the live
      // follow and the catch-up ride the loop. The closing write sits inside
      // the same frame as the loop's start, so the scroll event it raises
      // carries the loop's own tag and is not read as the reader scrolling.
      if (followable) {
        if (riding && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > bound) {
          // One pixel inside the bound: `followBottom` teleports past it,
          // and a scrollTop the browser rounds must not land on the far side.
          scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - bound + 1;
          lastWrite = scroller.scrollTop;
        }
        followBottom();
      } else {
        scroller.scrollTop = scroller.scrollHeight;
      }
      settle();
    });
    atBottom = true;
    landed = true;
  }

  /** Fire `onlanded` once, the first time the transcript has content. */
  let settled = false;
  function settle(): void {
    if (settled) return;
    settled = true;
    onlanded?.();
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
  /** Whether the CURRENT land follows a tab-return: the catch-up's append
   *  is what changed `rows`, and a reader who left at the tail rides to the
   *  new one rather than being teleported. Plain var: raised with the hold
   *  when a switch has something to catch up on, consumed by the land that
   *  follows the append, and dropped if the reader was scrolled up — they
   *  stay where they were. */
  let returning = false;
  $effect(() => {
    if (!active) return;
    void rows.length;
    void session.streaming;
    if (rows.length === 0) return;
    if (!landed || atBottom) void tick().then(land);
    else returning = false;
  });
  // Composer height changes are handled entirely by CSS: `--composer-clearance`
  // on the parent adjusts `.tr`'s `padding-bottom`, the browser updates
  // `scrollHeight`, and the existing follow loop (which watches `rows.length`
  // and `session.streaming`) catches any overshoot on the next frame. No JS
  // needed — a padding change is layout, not a scroll event.

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

  /**
   * Per-row enter action. The guard decides WHETHER to animate; CSS does the
   * actual motion. Adding `.entering` starts two CSS animations on the wrapper:
   *
   * 1. `row-open` — the wrapper grows from `max-height: 0` to a generous
   *    ceiling, clipped by `overflow: hidden`. This is the container scaling
   *    vertically — the content below does not jump.
   * 2. `row-slide` — the first child slides up from `translateY(20px)` with
   *    `opacity: 0`, arriving into the space the wrapper just opened. Because
   *    the wrapper clips, nothing overlaps above.
   *
   * The class is removed on `animationend` so the row returns to its normal
   * `display: block` flow and virtua's measurements are unaffected.
   */
  function enterMotion(node: HTMLElement, key: string) {
    const fresh = landed && atBottom && !seen.has(key);
    seen.add(key);
    if (!fresh) return;
    node.classList.add('entering');
    const done = () => {
      node.classList.remove('entering');
      node.removeEventListener('animationend', done);
    };
    node.addEventListener('animationend', done);
    return {
      destroy() {
        node.classList.remove('entering');
        node.removeEventListener('animationend', done);
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

  <Virtualizer bind:this={list} data={built.rows} getKey={(r) => r.key} scrollRef={scroller} shift={built.shifted} {ssrCount}>
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
        {:else if row.kind === 'delegate'}
          <Delegate message={row.message} />
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
  <!-- Under the last row, inside the scroller, from the switch until the
       catch-up has appended: the transcript the reader left is on screen
       already; this says the rest is on its way. -->
  {#if catching}
    <CatchUp />
  {/if}
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

  /* Motion is opt-in: the dot only beats when the reader hasn't asked for
     reduced motion. Without the query the pill's presence alone carries
     the state — the dot is still. */
  .compacting-note .beat {
    animation: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .compacting-note .beat {
      animation: beat var(--breath) var(--e-toggle) infinite;
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
  @keyframes breathe {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .livetool .ic.breathe :global(svg) {
      animation: breathe var(--breath) var(--e-toggle) infinite;
    }
  }

  /* Per-row enter wrapper. Virtua measures the row at its natural height
     BEFORE the animation starts, so `max-height` tricks fight the virtualizer.
     The animation plays on the wrapper itself: content slides up and fades in
     within the space virtua already allocated. The scroll follow moves the
     viewport down as the row appears, which is what "space opens then content
     arrives" looks like to the reader — the viewport shift IS the space
     opening; the slide IS the content arriving into it. */
  .renter {
    display: block;
  }
  @media (prefers-reduced-motion: no-preference) {
    .renter.entering {
      animation: row-enter var(--c-300, 220ms) var(--e-in, cubic-bezier(0.16, 1, 0.3, 1)) both;
    }
  }
  @keyframes row-enter {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

</style>

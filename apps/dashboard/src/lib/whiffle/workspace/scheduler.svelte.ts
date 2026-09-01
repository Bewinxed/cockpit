/**
 * The rebuild scheduler: how several transcripts share one screen.
 *
 * A transcript that nobody is looking at costs nothing, because it stops
 * reading its session entirely (the freeze in `Transcript.svelte`). A
 * transcript the reader IS looking at rebuilds its rows on every streamed
 * frame, which is what makes a live turn feel live. The grid introduces a
 * third case that had no answer before: a pane that is genuinely on screen
 * but is not the one being worked in.
 *
 * Rebuilding those the same way the focused pane is rebuilt does not scale.
 * The measured cost of one large transcript's rebuild is ~3.6ms — 1.09s of
 * script across 300 streamed frames, the number recorded in Transcript's own
 * freeze comment. Four visible panes reacting to their own streams would put
 * roughly 14ms of row-building inside single frames, which is a dropped frame
 * every time two of them are busy at once.
 *
 * So the unfocused ones take turns. One timer wakes on a fixed cadence and
 * bumps AT MOST ONE registrant, round-robin, and only if that pane's session
 * actually changed since it last built. The cost is therefore bounded by the
 * cadence rather than by how many panes are open or how fast their agents are
 * talking: one ~3.6ms rebuild per slot, whatever else is happening.
 *
 * What deliberately does NOT wait for a turn: anything the reader needs to
 * notice. A parked permission renders from `session.pending` outside the
 * frozen region, so an unfocused pane's "needs you" is never a quarter-second
 * late. This schedules the transcript, not the alarm.
 *
 * Why not requestAnimationFrame: rAF bounds WHEN work runs, not how much of
 * it. Four dirty panes in one frame is the same spike, merely aligned to it.
 * Why not requestIdleCallback: it starves under sustained streaming, which is
 * exactly the case that needs bounding. Why not a cheaper tail-only build for
 * unfocused panes: a second row builder has to agree with the real one about
 * keys, or settle-continuity and prepend detection break in ways that only
 * show up as a flicker much later.
 */

/**
 * How often a turn comes up. Our choice: 4Hz keeps a peripheral transcript
 * visibly alive while bounding the cost to one rebuild per slot — about 1.4%
 * of a core at the measured 3.6ms. The worst case a pane waits is this times
 * the number of unfocused panes (one second at four of them), which is fine
 * for a transcript nobody is reading and would not be for one they are.
 */
const CADENCE = 250;

interface Registrant {
  /** Cheap state summary; a rebuild is skipped unless this changed. */
  fingerprint: () => string;
  /** Invalidate this pane's rows, once. */
  bump: () => void;
  last: string;
}

const registry = new Map<string, Registrant>();
let timer: ReturnType<typeof setInterval> | null = null;
/** Where the round-robin got to, so one busy pane cannot starve the rest. */
let cursor = 0;

function tick(): void {
  const ids = [...registry.keys()];
  if (ids.length === 0) return;
  // One pass, one rebuild: walk from where we left off and stop at the first
  // pane with something new to show. Walking the whole ring would hand every
  // dirty pane a rebuild in the same tick, which is the spike this exists to
  // prevent.
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[(cursor + i) % ids.length];
    const entry = registry.get(id);
    if (!entry) continue;
    const now = entry.fingerprint();
    if (now === entry.last) continue;
    entry.last = now;
    cursor = (cursor + i + 1) % ids.length;
    entry.bump();
    return;
  }
  cursor = 0;
}

function start(): void {
  if (timer !== null || typeof window === 'undefined') return;
  timer = setInterval(tick, CADENCE);
}

function stop(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

export const rebuildScheduler = {
  /**
   * Take a turn in the rotation. Called by a transcript that is visible but
   * not focused; the returned function gives the turn back.
   *
   * The first fingerprint is recorded rather than acted on: the pane has just
   * built its rows to become visible, so it is up to date by definition and a
   * rebuild on the next tick would be work for an unchanged picture.
   */
  join(id: string, fingerprint: () => string, bump: () => void): () => void {
    registry.set(id, { fingerprint, bump, last: fingerprint() });
    start();
    return () => {
      registry.delete(id);
      if (registry.size === 0) stop();
    };
  },

  /** How many panes are currently taking turns. For tests and diagnostics. */
  get size(): number {
    return registry.size;
  },

  /** The cadence, so a test can reason about the bound rather than guess it. */
  get cadence(): number {
    return CADENCE;
  },
};

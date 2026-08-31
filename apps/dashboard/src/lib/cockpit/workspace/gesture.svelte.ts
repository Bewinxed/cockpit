/**
 * Swiping between conversations.
 *
 * The gesture is continuous: the finger drags the current pane off and the
 * neighbouring one on, both moving in lockstep, so the next conversation
 * reads as having been there all along rather than as something that
 * arrives. That only works because the panes are all mounted and the
 * workspace answers synchronously — a gesture cannot wait for a router.
 *
 * Three rules decide whether a horizontal drag belongs to the page, and all
 * three exist because of something that would otherwise break:
 *
 * - It must be mostly horizontal. A transcript scrolls vertically, and a
 *   thumb travelling down the screen must never take the page with it.
 * - It must not start on a control, in the composer, or inside something
 *   that scrolls sideways. Code blocks and tool output scroll horizontally;
 *   stealing that is worse than having no gesture at all.
 * - Ownership is settled at touchstart and never revisited. The browser
 *   cannot be told half way through a gesture that someone else wants it,
 *   so asking later would mean asking after the answer stopped mattering.
 */
import { workspace } from './workspace.svelte';

/** Travel before a drag is anything at all. */
const SLOP = 10;
/** Beyond this much vertical travel it is a scroll, whatever the horizontal is. */
const SLOPE = 0.7;
/** How far across the pane counts as "meant it", as a fraction of the width. */
const COMMIT = 0.3;
/** A flick: short but fast still counts, in px/ms. */
const FLICK = 0.3;
/** Settle durations. An arrival is allowed to take longer than a retreat. */
const SETTLE_COMMIT = 300;
const SETTLE_CANCEL = 250;
/** Release curve — a confident deceleration, matching the app's entry easing. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

type Phase = 'idle' | 'tracking' | 'decided' | 'releasing';

/**
 * Whether something under the finger wants this touch more than the page
 * does. Asked once, at the start, against the element the finger landed on.
 */
function fenced(target: EventTarget | null, fence: HTMLElement): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (!fence.contains(target)) return true;
  if (
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], ' +
        '[role="button"], [role="link"], [role="tab"], [role="slider"], .composer'
    )
  ) {
    return true;
  }
  // Anything between the finger and the pane that scrolls sideways owns its
  // own horizontal travel. `scrollWidth > clientWidth` is true of anything
  // merely clipping its overflow — including the transcript column — so the
  // computed style is what separates "this scrolls" from "this is cut off".
  let node: HTMLElement | null = target;
  while (node && node !== fence) {
    const overflowX = getComputedStyle(node).overflowX;
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      node.scrollWidth - node.clientWidth > 4
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * `leafOf` is a getter rather than a value: a group's identity is a prop,
 * and capturing it once would bind the gesture to whichever group this
 * component happened to render first.
 */
export function createSwipe(leafOf: () => string | undefined = () => undefined) {
  let phase = $state<Phase>('idle');
  let delta = $state(0);
  let width = $state(0);
  let targetId = $state<string | null>(null);
  let direction = $state<'left' | 'right' | null>(null);

  // Not reactive: read only inside handlers, and writing them per touchmove
  // would schedule a render for values nothing renders.
  let startX = 0;
  let startY = 0;
  let samples: Array<{ x: number; t: number }> = [];
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const reset = () => {
    phase = 'idle';
    delta = 0;
    targetId = null;
    direction = null;
  };

  function release(commit: boolean) {
    const settled = commit ? targetId : null;
    phase = 'releasing';
    delta = commit ? (direction === 'left' ? -width : width) : 0;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = reduced ? 0 : commit ? SETTLE_COMMIT : SETTLE_CANCEL;

    settleTimer = setTimeout(() => {
      settleTimer = null;
      // The conversation changes at the END of the flight, when the pane it
      // names is already where the eye expects it. Nothing animates as a
      // result — the transform is removed in the same breath that the pane
      // becomes the active one, so the two cancel.
      if (settled) workspace.activate(settled, leafOf());
      reset();
    }, wait);
  }

  return {
    get phase() {
      return phase;
    },
    get delta() {
      return delta;
    },
    get targetId() {
      return targetId;
    },
    get direction() {
      return direction;
    },
    /** How far across, 0 → 1. What the header morph rides. */
    get progress() {
      return width > 0 ? Math.min(Math.abs(delta) / width, 1) : 0;
    },
    /**
     * The conversation the header should be NAMING right now — the target
     * once the drag has passed the point it would commit at, the current one
     * before that. Crossing back drags the name back with it. The threshold
     * is deliberately the same one release uses, so the header is never
     * showing something the lift is about to contradict.
     */
    get previewId(): string | null {
      if (phase === 'idle' || !targetId) return null;
      const past = width > 0 && Math.abs(delta) / width > COMMIT;
      return past ? targetId : null;
    },
    /** The settle transition, or none while the finger is still down. */
    get transition() {
      return phase === 'releasing'
        ? `transform ${delta === 0 ? SETTLE_CANCEL : SETTLE_COMMIT}ms ${EASE}`
        : 'none';
    },

    /**
     * Where a pane sits, in px. The active pane rides the finger; the target
     * waits exactly one screen away in the direction travelled, so the two
     * are flush and the seam between them never shows.
     */
    offsetOf(paneId: string, isActive: boolean): number | null {
      if (phase === 'idle') return null;
      if (paneId === targetId) {
        return (direction === 'left' ? width : -width) + delta;
      }
      if (isActive) return delta;
      return null;
    },

    /**
     * Attaches the listeners. `touchmove` must be non-passive so the gesture
     * can claim the touch once it owns it.
     *
     * `enabled` is a parameter rather than a condition on the `use:` because
     * a directive cannot be applied conditionally — and detaching listeners
     * mid-gesture would strand the state machine part-way through a drag.
     */
    action(node: HTMLElement, enabled: boolean = true) {
      let live = enabled;

      const onStart = (event: TouchEvent) => {
        if (!live) return;
        if (phase !== 'idle' || event.touches.length !== 1) return;
        if (fenced(event.target, node)) return;
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        samples = [{ x: touch.clientX, t: performance.now() }];
        phase = 'tracking';
      };

      const onMove = (event: TouchEvent) => {
        if (phase !== 'tracking' && phase !== 'decided') return;
        const touch = event.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        samples.push({ x: touch.clientX, t: performance.now() });
        if (samples.length > 5) samples.shift();

        if (phase === 'tracking') {
          if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
          if (Math.abs(dy) > Math.abs(dx) * SLOPE) {
            // A scroll. Stand down for the rest of this touch.
            phase = 'idle';
            return;
          }
          const dir: 'left' | 'right' = dx < 0 ? 'left' : 'right';
          const leafId = leafOf();
          const from = leafId ? workspace.activeOf(leafId) : workspace.activeSessionId;
          const next = workspace.step(from, dir === 'left' ? 1 : -1, leafId);
          if (!next) {
            phase = 'idle';
            return;
          }
          direction = dir;
          targetId = next;
          width = node.clientWidth;
          phase = 'decided';
        }

        // Claimed: the page owns this gesture now, so the browser must not
        // also scroll with it.
        event.preventDefault();
        delta =
          direction === 'left'
            ? Math.max(Math.min(dx, 0), -width)
            : Math.min(Math.max(dx, 0), width);
      };

      const onEnd = () => {
        if (phase === 'tracking') {
          phase = 'idle';
          return;
        }
        if (phase !== 'decided') return;

        let velocity = 0;
        if (samples.length >= 2) {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dt = last.t - first.t;
          if (dt > 0) velocity = (last.x - first.x) / dt;
        }
        const far = width > 0 && Math.abs(delta) / width > COMMIT;
        const flicked = direction === 'left' ? velocity < -FLICK : velocity > FLICK;
        release(far || flicked);
      };

      const onCancel = () => {
        if (phase === 'decided') release(false);
        else phase = 'idle';
      };

      node.addEventListener('touchstart', onStart, { passive: true });
      node.addEventListener('touchmove', onMove, { passive: false });
      node.addEventListener('touchend', onEnd, { passive: true });
      node.addEventListener('touchcancel', onCancel, { passive: true });

      return {
        update(next: boolean) {
          live = next;
          if (!next && phase !== 'idle') reset();
        },
        destroy() {
          if (settleTimer) clearTimeout(settleTimer);
          node.removeEventListener('touchstart', onStart);
          node.removeEventListener('touchmove', onMove);
          node.removeEventListener('touchend', onEnd);
          node.removeEventListener('touchcancel', onCancel);
        },
      };
    },
  };
}

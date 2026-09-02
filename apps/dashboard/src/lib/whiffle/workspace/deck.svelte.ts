/**
 * Two fingers move between groups on the phone.
 *
 * A phone draws one group, so a split made at the desk was unreachable from
 * it. This is the way through: two fingers dragged up bring the next group
 * in from below, dragged down bring the previous one from above, in tree
 * order and without wrapping. The cards ride the fingers 1:1 and settle on
 * a spring, so the deck reads as a physical stack rather than a transition.
 *
 * Two fingers, never one. One finger already belongs to the transcript's
 * scroll and to the tab swipe in `gesture.svelte.ts`, and both must go on
 * working exactly as they do. Only a touch count of exactly two is ever
 * looked at here; the one-finger machine keeps its own guard against a
 * second finger landing mid-drag.
 */
import { workspace, type LeafNode } from './workspace.svelte';

/** Travel before the pair is taken to mean anything. */
const SLOP = 8;
/** Beyond this much horizontal travel it is something else, whatever the vertical is. */
const SLOPE = 0.7;
/** Breathing room between stacked cards, in px. */
export const GAP = 12;
/** How far the projected release must reach, as a fraction of the height. */
const COMMIT = 0.35;
/** A flick: short but fast still counts, in px/s. Sonner's 0.11 px/ms. */
const FLICK = 110;
/** How far ahead a release looks, in seconds of the release velocity. */
const LOOKAHEAD = 0.1;
/** How much of a drag past the end is shown, and the most it can show. */
const RESIST = 0.35;
const RESIST_MAX = 0.25;
/**
 * The settle, in Apple's terms: a perceptual duration and a bounce. No
 * bounce — a dashboard is crisp, and a card that wobbles into place keeps
 * moving after the reader has stopped. A flick can still carry it a hair
 * past and back, which is the finger's doing, not the spring's.
 */
const SETTLE = 0.4;
const BOUNCE = 0;
const MASS = 1;
const STIFFNESS = (2 * Math.PI / SETTLE) ** 2;
const DAMPING = (4 * Math.PI * (1 - BOUNCE)) / SETTLE;
/** A frame that took longer than this is integrated as if it had not. */
const MAX_DT = 1 / 30;
/** Velocity samples older than this say nothing about the release. */
const VELOCITY_WINDOW = 80;

type Phase = 'idle' | 'armed' | 'claimed';

export function createDeck(getLeaves: () => LeafNode[], getFocusedId: () => string) {
  let offset = $state(0);
  let lifted = $state(false);
  let dragging = $state(false);
  let height = $state(0);

  // Not reactive: read only inside handlers, and writing them per touchmove
  // would schedule a render for values nothing renders.
  let phase: Phase = 'idle';
  let startX = 0;
  let startY = 0;
  /** Where the focused card was when the fingers took hold — mid-spring, not 0. */
  let base = 0;
  let samples: Array<{ y: number; t: number }> = [];
  let frame: number | null = null;

  const reduced = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const midpoint = (touches: TouchList) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });

  const stopSpring = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  /** The neighbours of the focused group: above, itself, below. */
  const neighbours = () => {
    const leaves = getLeaves();
    const index = leaves.findIndex((leaf) => leaf.id === getFocusedId());
    return {
      above: index > 0 ? leaves[index - 1] : null,
      below: index >= 0 && index < leaves.length - 1 ? leaves[index + 1] : null,
    };
  };

  const resist = (d: number) =>
    Math.sign(d) * Math.min(Math.abs(d) * RESIST, height * RESIST_MAX);

  /** Release velocity in px/s, from the samples of the last few dozen ms. */
  const releaseVelocity = () => {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (const sample of samples) {
      if (last.t - sample.t <= VELOCITY_WINDOW) {
        first = sample;
        break;
      }
    }
    const dt = last.t - first.t;
    return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
  };

  function spring(velocity: number) {
    stopSpring();
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;
      const x = offset;
      const a = (-STIFFNESS * x - DAMPING * v) / MASS;
      v += a * dt;
      const next = x + v * dt;
      if (Math.abs(next) < 0.5 && Math.abs(v) < 20) {
        offset = 0;
        lifted = false;
        frame = null;
        return;
      }
      offset = next;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function release() {
    const velocity = releaseVelocity();
    const { above, below } = neighbours();
    const projected = offset + velocity * LOOKAHEAD;
    const far = Math.abs(projected) > height * COMMIT;
    const up = projected < 0;
    const target = up ? below : above;
    const flicked = up ? velocity < -FLICK : velocity > FLICK;

    dragging = false;
    if (target && (far || flicked)) {
      // Focus first, then compensate in the same synchronous step: every
      // card's resting place is derived from the focused index, so the flip
      // moves the outgoing card's base by a whole card and the correction
      // leaves the picture exactly where the finger left it.
      workspace.focus(target.id);
      offset += up ? height + GAP : -(height + GAP);
    }

    if (reduced()) {
      offset = 0;
      lifted = false;
      return;
    }
    spring(velocity);
  }

  return {
    get lifted() {
      return lifted;
    },
    get dragging() {
      return dragging;
    },

    /**
     * Where a card sits, in px. The focused card rides the fingers; the
     * neighbours wait one card away either side, and every other card stays
     * put away.
     */
    offsetOf(leafId: string): number | null {
      if (!lifted) return null;
      if (leafId === getFocusedId()) return offset;
      const { above, below } = neighbours();
      if (above && leafId === above.id) return offset - (height + GAP);
      if (below && leafId === below.id) return offset + (height + GAP);
      return null;
    },

    /**
     * Attaches the listeners. `touchmove` must be non-passive so the deck
     * can claim the pair once it owns it — which is also what stops iOS
     * scrolling the page, or pinching, with the same two fingers.
     */
    action(node: HTMLElement) {
      const onStart = (event: TouchEvent) => {
        if (event.touches.length !== 2) {
          // A third finger ends the drag rather than joining it: the pair
          // that was being tracked is gone, and the midpoint would jump.
          if (phase === 'claimed') release();
          phase = 'idle';
          return;
        }
        if (phase === 'claimed') return;
        const mid = midpoint(event.touches);
        startX = mid.x;
        startY = mid.y;
        samples = [{ y: mid.y, t: performance.now() }];
        phase = 'armed';
      };

      const onMove = (event: TouchEvent) => {
        if (phase === 'idle') return;
        if (event.touches.length !== 2) {
          if (phase === 'armed') phase = 'idle';
          return;
        }
        const mid = midpoint(event.touches);
        const dx = mid.x - startX;
        const dy = mid.y - startY;

        samples.push({ y: mid.y, t: performance.now() });
        if (samples.length > 5) samples.shift();

        if (phase === 'armed') {
          if (Math.abs(dy) <= SLOP || Math.abs(dy) <= Math.abs(dx) * SLOPE) return;
          // Taking hold mid-settle picks the card up where it is; the spring
          // is dropped, not rewound.
          stopSpring();
          base = offset;
          height = node.clientHeight;
          lifted = true;
          dragging = true;
          phase = 'claimed';
        }

        event.preventDefault();
        event.stopPropagation();

        const { above, below } = neighbours();
        const open = base + dy < 0 ? below : above;
        offset = open ? base + dy : base + resist(dy);
      };

      const onEnd = () => {
        if (phase === 'claimed') release();
        phase = 'idle';
      };

      node.addEventListener('touchstart', onStart, { passive: true });
      node.addEventListener('touchmove', onMove, { passive: false });
      node.addEventListener('touchend', onEnd, { passive: true });
      node.addEventListener('touchcancel', onEnd, { passive: true });

      return {
        destroy() {
          stopSpring();
          node.removeEventListener('touchstart', onStart);
          node.removeEventListener('touchmove', onMove);
          node.removeEventListener('touchend', onEnd);
          node.removeEventListener('touchcancel', onEnd);
        },
      };
    },
  };
}

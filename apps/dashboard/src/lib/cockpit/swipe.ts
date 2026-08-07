/**
 * Swiping between conversations, the way a phone expects to move between peers.
 *
 * Deliberately not a generic gesture library. Three rules decide whether a
 * horizontal drag is a page change, and all three exist because of something
 * that would otherwise break:
 *
 * - It must be mostly horizontal. A transcript scrolls vertically, and a thumb
 *   travelling down the screen must never take the page with it.
 * - It must start away from the composer and off any scrollable row. Code
 *   blocks and tool output scroll sideways; stealing that is worse than having
 *   no gesture at all.
 * - It must clear a distance *and* be quick, or be long. A slow 30px drift is
 *   somebody steadying their hand, not asking for the next conversation.
 */

/** How far a thumb travels before it counts, when it is not travelling fast. */
const DISTANCE = 80;
/** A flick: shorter than `DISTANCE` still counts if it happens this fast. */
const FLICK_MS = 300;
const FLICK_DISTANCE = 40;
/** Beyond this much vertical travel it is a scroll, whatever the horizontal is. */
const SLOPE = 0.6;

export interface SwipeOptions {
  onNext: () => void;
  onPrevious: () => void;
  /** Asked before a gesture starts; lets a page opt out while it is busy. */
  enabled?: () => boolean;
}

/**
 * Whether something under the finger wants this swipe more than the page does.
 *
 * Asked with the direction, not just the target, because "this element scrolls
 * sideways" is too blunt on its own: a transcript is full of code blocks, and
 * declining over every one of them leaves the gesture working almost nowhere.
 * An element only keeps the swipe if it can still travel the way the thumb is
 * going — a code block already scrolled to its right edge has nothing left to
 * give, so a further leftward swipe belongs to the page.
 */
const consumesSwipe = (target: EventTarget | null, dx: number): boolean => {
  let node = target as HTMLElement | null;
  while (node && node !== document.body) {
    // The composer owns its own horizontal gestures — selection, the caret.
    if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') return true;
    // `scrollWidth > clientWidth` is true of anything clipping overflow too —
    // including the transcript column, which hides it. Asking the computed
    // style is the only way to tell "this scrolls" from "this is cut off", and
    // getting it wrong declines the gesture on every part of the screen.
    const overflowX = getComputedStyle(node).overflowX;
    const scrollable = overflowX === 'auto' || overflowX === 'scroll';
    const slack = node.scrollWidth - node.clientWidth;
    if (scrollable && slack > 4) {
      const room =
        dx < 0
          ? node.scrollLeft < slack - 1 // more to reveal on the right
          : node.scrollLeft > 1; // more to reveal on the left
      if (room) return true;
    }
    node = node.parentElement;
  }
  return false;
};

export function swipeBetween(node: HTMLElement, options: SwipeOptions) {
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;
  /** Kept from the start, because the direction is only known at the end. */
  let startTarget: EventTarget | null = null;

  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    if (options.enabled && !options.enabled()) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTarget = event.target;
    startedAt = performance.now();
    tracking = true;
  };

  const end = (event: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    const touch = event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const elapsed = performance.now() - startedAt;

    if (Math.abs(dy) > Math.abs(dx) * SLOPE) return; // a scroll
    if (consumesSwipe(startTarget, dx)) return; // something under it wants this
    const far = Math.abs(dx) > DISTANCE;
    const flicked = elapsed < FLICK_MS && Math.abs(dx) > FLICK_DISTANCE;
    if (!far && !flicked) return;

    // Right-to-left reveals what is after it, the way pages advance.
    if (dx < 0) options.onNext();
    else options.onPrevious();
  };

  const cancel = () => (tracking = false);

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchend', end, { passive: true });
  node.addEventListener('touchcancel', cancel, { passive: true });

  return {
    destroy() {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
    },
  };
}

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
const scrollableAncestor = (target: EventTarget | null): HTMLElement | null => {
  let node = target as HTMLElement | null;
  while (node && node !== document.body) {
    const overflowX = getComputedStyle(node).overflowX;
    if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth - node.clientWidth > 4) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

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
  /**
   * The nearest sideways-scrolling ancestor and where it sat when the finger
   * landed. `consumesSwipe` asks whether that element still has room to travel,
   * but it was being asked at touchend — by which point the element had already
   * scrolled, so a code block swiped *to its edge* reported no room left and the
   * page took the gesture. Sampling here and comparing at the end asks the only
   * question that actually settles it: did something else already consume this?
   */
  let startScroller: HTMLElement | null = null;
  let startScrollLeft = 0;

  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    if (options.enabled && !options.enabled()) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTarget = event.target;
    startScroller = scrollableAncestor(event.target);
    startScrollLeft = startScroller ? startScroller.scrollLeft : 0;
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
    // Something under the finger already moved: the gesture was spent on it.
    if (startScroller && Math.abs(startScroller.scrollLeft - startScrollLeft) > 1) return;
    if (consumesSwipe(startTarget, dx)) return; // something under it wants this
    const far = Math.abs(dx) > DISTANCE;
    const flicked = elapsed < FLICK_MS && Math.abs(dx) > FLICK_DISTANCE;
    if (!far && !flicked) return;

    // Right-to-left reveals what is after it, the way pages advance.
    if (dx < 0) options.onNext();
    else options.onPrevious();
  };

  const cancel = () => {
    tracking = false;
    startScroller = null;
  };

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

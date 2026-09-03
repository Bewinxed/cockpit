/**
 * Conversations are mounted ONCE, by `PaneHost`, and docked into whichever
 * group holds them. A group never renders a `SessionPane`; it renders a slot
 * per tab and the host moves the pane's DOM into it.
 *
 * Every tree change used to remount. A split replaces the target leaf with
 * a branch, so both halves are new components; a move takes the conversation
 * out of one leaf's `mounted` and into another's; the phone-to-desk switch
 * swaps the whole grid. Each time the transcript rebuilt every row, virtua
 * re-measured from nothing, the scroll offset and the half-typed message were
 * gone, and for the length of that rebuild the pane was blank. Moving a DOM
 * node between parents keeps the component, its state and its measurements;
 * only the scroll offsets need carrying across, because a scrolling box is
 * destroyed with the layout box and comes back at zero.
 */
import { SvelteMap } from "svelte/reactivity";

export interface Slot {
  el: HTMLElement;
  /** Whether the group is showing this pane — on screen or mid-swipe. */
  shown: boolean;
}

export const slots = new SvelteMap<string, Slot>();

/** Which view each conversation is in. A session's, not a group's. */
export const paneViews = $state<Record<string, "chat" | "flow">>({});

/** A group's slot for one tab. Registered while the group keeps it mounted. */
export function slot(node: HTMLElement, param: { id: string; shown: boolean }) {
  let id = param.id;
  slots.set(id, { el: node, shown: param.shown });
  return {
    update(next: { id: string; shown: boolean }) {
      if (next.id !== id && slots.get(id)?.el === node) {
        slots.delete(id);
      }
      id = next.id;
      slots.set(id, { el: node, shown: next.shown });
    },
    destroy() {
      if (slots.get(id)?.el === node) {
        slots.delete(id);
      }
    },
  };
}

/** Within this of the end, a scrolling box is "at the bottom" — the transcript's own threshold. */
const TAIL = 120;

/**
 * The host's wrapper around one pane. Follows its slot wherever it goes.
 *
 * Scroll offsets and focus are recorded as they happen, not read at the
 * move: the old slot is torn out of the DOM before this effect runs, and a
 * detached box reports zero for everything. A box that was at its tail is
 * put back at the tail rather than at the same number, because the new
 * slot may be a different width.
 */
export function dock(node: HTMLElement, id: string) {
  const scrolled = new Map<
    HTMLElement,
    { top: number; left: number; tail: boolean }
  >();
  let focused: HTMLElement | null = null;

  const onscroll = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement)) {
      return;
    }
    scrolled.set(el, {
      top: el.scrollTop,
      left: el.scrollLeft,
      tail: el.scrollHeight - el.scrollTop - el.clientHeight < TAIL,
    });
  };
  const onfocusin = (event: FocusEvent) => {
    focused = event.target instanceof HTMLElement ? event.target : null;
  };
  const onfocusout = (event: FocusEvent) => {
    if (
      event.relatedTarget instanceof Node &&
      !node.contains(event.relatedTarget)
    ) {
      focused = null;
    }
  };
  node.addEventListener("scroll", onscroll, { capture: true, passive: true });
  node.addEventListener("focusin", onfocusin);
  node.addEventListener("focusout", onfocusout);

  $effect(() => {
    const into = slots.get(id)?.el;
    if (!into || into === node.parentElement) {
      return;
    }
    into.appendChild(node);
    for (const [el, at] of scrolled) {
      if (!el.isConnected) {
        scrolled.delete(el);
        continue;
      }
      el.scrollTop = at.tail ? el.scrollHeight : at.top;
      el.scrollLeft = at.left;
    }
    if (focused?.isConnected && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  });

  return {
    destroy() {
      node.removeEventListener("scroll", onscroll, true);
      node.removeEventListener("focusin", onfocusin);
      node.removeEventListener("focusout", onfocusout);
    },
  };
}

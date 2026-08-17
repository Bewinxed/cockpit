<script lang="ts">
  /**
   * The operator's way of handing the agent a passage.
   *
   * Select anything in the transcript and a dock comes up over the selection
   * with the two things worth doing to it: quoting it into the composer, which
   * is what "hand it to the agent" means here, and copying it. It answers only
   * to selections inside its own pane's transcript, so the four panes standing
   * behind this one stay quiet.
   */
  import IconQuote from '~icons/solar/reply-linear';
  import { IconCheck, IconClose, IconCopy } from '$lib/icons';
  import { MediaQuery } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { Button } from '$lib/components/ui/button';
  import { UseClipboard } from '$lib/hooks/use-clipboard.svelte';
  import { barPlacement, type Rect } from '$lib/cockpit/selection';

  interface Props {
    /** The transcript's scroller: what a selection has to be inside, and what
     *  scrolling out from under the bar dismisses it. */
    scroller: HTMLElement | null;
    /** Hands the raw selected text to the composer. */
    onQuote: (text: string) => void;
  }

  let { scroller, onQuote }: Props = $props();

  /** The selection's box in viewport coordinates — `null` when the bar is away. */
  let rect = $state<Rect | null>(null);
  let passage = $state('');
  let host = $state<HTMLDivElement | null>(null);
  let dock = $state<HTMLDivElement | null>(null);
  /** Measured from the dock itself: centring and clamping both need its box. */
  let size = $state({ width: 0, height: 0 });
  /** Where the transcript stood when the bar came up. */
  let shownAt = 0;

  const visible = $derived(rect !== null);

  /** A touch selection already carries the platform's own callout above it, so
   *  the bar goes under the passage rather than fighting for that strip. */
  const coarse = new MediaQuery('(pointer: coarse)');
  const stillness = new MediaQuery('prefers-reduced-motion: reduce');

  const clipboard = new UseClipboard({ delay: 900 });

  // The host is `inset-0` over the pane, so the pane's bounds are its own box
  // and the dock's offsets are the placement measured from its corner.
  const placement = $derived.by(() => {
    if (!rect || !host) return null;
    const pane = host.getBoundingClientRect();
    const at = barPlacement(rect, pane, size, coarse.current ? 'below' : 'above');
    return { left: at.x - pane.left, top: at.y - pane.top };
  });

  // Before the first paint, so the dock never lands at an estimated width and
  // then jumps: an effect flushes with the DOM change that mounted it.
  $effect(() => {
    if (!dock) return;
    const width = dock.offsetWidth;
    const height = dock.offsetHeight;
    if (width === size.width && height === size.height) return;
    size = { width, height };
  });

  /** How long the selection has to hold still before the bar answers it. On a
   *  phone this is also what lets the native handles settle first. */
  const SETTLE_MS = 150;
  /** How far the transcript may move under the bar before it is stale. */
  const SCROLL_SLACK = 24;

  let settle: ReturnType<typeof setTimeout>;
  /** A pointer is down: the range is still being drawn, and a bar under the
   *  cursor mid-drag is a bar the drag ends inside. */
  let dragging = false;
  /** A press that began on the bar owns it until it is released. The browser is
   *  free to collapse the selection under that pointer, and a bar that reads
   *  the collapse as "nothing is selected" goes away under the click. */
  let holding = false;

  function hide() {
    rect = null;
    passage = '';
  }

  function scheduleRead() {
    clearTimeout(settle);
    settle = setTimeout(read, SETTLE_MS);
  }

  /** Whether a node is inside this pane's own message column. */
  function inTranscript(node: Node | null): boolean {
    const content = scroller?.querySelector('[data-transcript-content]');
    return Boolean(node && content?.contains(node));
  }

  /**
   * What the selection is now, and whether the bar belongs over it. Both
   * endpoints have to be in the transcript: a drag that ends outside it — in
   * the composer, in the header, in another pane — is not a passage.
   */
  function read() {
    if (dragging || holding) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hide();
      return;
    }
    const range = selection.getRangeAt(0);
    // Selecting the bar's own labels is the reader reaching for it mid-click,
    // not a new passage — the classic way a floating bar kills itself.
    if (dock?.contains(range.commonAncestorContainer)) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
      hide();
      return;
    }
    if (!inTranscript(range.startContainer) || !inTranscript(range.endContainer)) {
      hide();
      return;
    }
    const said = selection.toString();
    if (!said.trim()) {
      hide();
      return;
    }
    // Only a bar that is coming up re-arms the scroll slack; one merely being
    // re-measured keeps the offset it was summoned at.
    if (!rect) shownAt = scroller?.scrollTop ?? 0;
    passage = said;
    rect = range.getBoundingClientRect();
  }

  $effect(() => {
    const onSelectionChange = () => scheduleRead();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (dock && target instanceof Node && dock.contains(target)) {
        holding = true;
        return;
      }
      dragging = true;
      hide();
    };
    const onPointerUp = () => {
      dragging = false;
      holding = false;
      scheduleRead();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      clearTimeout(settle);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  });

  // Riding the transcript rather than being animated after it: a bar that
  // glides to its new place reads as chasing the cursor, so it is re-placed on
  // the frame and snaps. Past a small scroll the passage is no longer where the
  // reader is looking, and the bar goes with it.
  $effect(() => {
    if (!visible || !scroller) return;
    const node = scroller;
    let frame = 0;
    const settleFrame = () => {
      frame = 0;
      if (Math.abs(node.scrollTop - shownAt) > SCROLL_SLACK) {
        hide();
        return;
      }
      read();
    };
    const reposition = () => {
      if (!frame) frame = requestAnimationFrame(settleFrame);
    };
    node.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  });

  // Mounted only while the bar is: Escape belongs to whatever else is on screen
  // the rest of the time.
  $effect(() => {
    if (!visible) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  function quote() {
    const said = passage;
    hide();
    // Quoting consumes the selection: left standing, the next click anywhere
    // would summon the bar back over a passage already in the composer.
    document.getSelection()?.removeAllRanges();
    onQuote(said);
  }

  /** Placed rather than dropped: a short rise with a touch of scale, the same
   *  arrival the composer's chips take. */
  function pop(_node: Element, { duration = 180, travel = 4 } = {}) {
    return {
      duration,
      easing: quintOut,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translateY(${u * travel}px) scale(${0.96 + 0.04 * t})`,
    };
  }
</script>

<div bind:this={host} class="pointer-events-none absolute inset-0 z-20">
  {#if placement}
    <div
      bind:this={dock}
      class="selection-dock pointer-events-auto absolute flex w-max items-center gap-1 rounded-4xl bg-card p-1 shadow-lg"
      style="left: {placement.left}px; top: {placement.top}px"
      role="toolbar"
      aria-label="Selected text"
      in:pop={{ duration: stillness.current ? 120 : 180, travel: stillness.current ? 0 : 4 }}
      out:fade={{ duration: stillness.current ? 120 : 140 }}
    >
      <!-- Secondary, not olive: quoting prepares the turn, it does not take it. -->
      <Button variant="secondary" size="sm" onclick={quote}>
        <IconQuote />
        Quote in reply
      </Button>
      <Button variant="ghost" size="sm" onclick={() => clipboard.copy(passage)}>
        <span class="icon-swap">
          <span data-active={clipboard.status === 'success'}><IconCheck /></span>
          <span data-active={clipboard.status === 'failure'}><IconClose /></span>
          <span data-active={clipboard.status === undefined}><IconCopy /></span>
        </span>
        Copy
      </Button>
    </div>
  {/if}
</div>

<style>
  /* The kit button carries its own `text-sm`, which outranks `text-caption` on
     the same element — and the utility repaints the label muted, which is not
     what a secondary verb wants. Measured in the browser, both times. */
  .selection-dock :global(button) {
    font-size: 0.8125rem;
  }
</style>

<script lang="ts">
  /**
   * The phone's groups, as a vertical stack of cards.
   *
   * Every group is mounted, so a split made at the desk is reachable here:
   * two fingers drag the stack and the neighbour comes into view under
   * them. Keeping the others mounted is cheap — a conversation is mounted
   * once by `PaneHost` and docked into its group's slot, so a card that is
   * put away holds nothing heavy of its own. Only the focused group takes
   * the one-finger tab swipe, and only it prewarms its neighbouring tabs;
   * the rest mount just their active tab.
   *
   * The two neighbours are painted at rest, parked a card away above and
   * below where the deck's overflow hides them. Painting them on the claim
   * frame instead was the stutter: a whole transcript's first paint landed
   * in the same frame as the lift, and both the transition and the first
   * few drag frames went with it.
   */
  import PaneLeaf from './PaneLeaf.svelte';
  import { workspace } from './workspace.svelte';
  import { createDeck, GAP } from './deck.svelte';

  const deck = createDeck(
    () => workspace.leaves,
    () => workspace.focusedLeafId
  );

  const focusedIndex = $derived(
    workspace.leaves.findIndex((leaf) => leaf.id === workspace.focusedLeafId)
  );

  /** A card's place in the stack: the fingers' travel on top of its parking spot. */
  const place = (delta: number, offset: number) =>
    delta === 0
      ? `translateY(${offset}px)`
      : `translateY(calc(${delta * 100}% + ${delta * GAP + offset}px))`;
</script>

<div class="deck" class:lifted={deck.lifted} use:deck.action>
  {#each workspace.leaves as leaf, index (leaf.id)}
    {@const delta = index - focusedIndex}
    {@const focused = delta === 0}
    <div
      class="card"
      class:card-hidden={Math.abs(delta) > 1}
      inert={!focused}
      style:transform={place(delta, deck.offset)}
    >
      <div class="lift">
        <div class="clip">
          <PaneLeaf {leaf} swipeable={focused} />
        </div>
      </div>
    </div>
  {/each}

  <!-- Graphite, never the accent: a page control is position, and the one
       loud colour in this product means a session is asking for something. -->
  {#if workspace.leaves.length > 1}
    <div class="dots" aria-hidden="true">
      {#each workspace.leaves as leaf (leaf.id)}
        <span class="dot" class:dot-on={leaf.id === workspace.focusedLeafId}></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The ground the lifted cards float over. */
  .deck {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--surface-sunken);
    /* Pinch belongs to nobody here; two fingers are the deck's. */
    touch-action: pan-x pan-y;
  }

  /* The shadow sits on a pseudo-element and fades rather than tweening
     `box-shadow`: the card is a whole transcript, and repainting one for a
     shadow every frame would cost frames in the middle of a gesture. The
     radius does tween, against the ledger's rule, and on purpose: the
     corners squaring off in one frame at landing was the snap the operator
     saw, and a scale already changing the outline makes the tween a repaint
     of what is repainting anyway. The clip is a child because
     `overflow: hidden` on the lift would cut the shadow off.

     Two elements carry the two transforms. The outer card takes the
     per-frame translate the fingers write inline; the inner lift owns the
     scale and its transition. On one element the inline transform would
     replace the scale outright every frame, and the lift would snap.

     Two timings, one each way. The pick-up rides the entry curve, quick
     and masked by the fingers already moving; the set-down is the eye's,
     so it takes the toggle curve at the base duration — symmetric, and
     long enough that the card is seen arriving. The set-down is declared on
     the base rule and the pick-up on the lifted one, which is how a single
     `transition` property gets a different value in each direction. */
  .card {
    position: absolute;
    inset: 0;
    display: flex;
    min-width: 0;
    min-height: 0;
    will-change: transform;
  }
  .lift {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    transform: scale(1);
    border-radius: 0;
    transition:
      transform var(--c-300) var(--ease-toggle),
      border-radius var(--c-300) var(--ease-toggle);
  }
  .lift::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: var(--shadow-overlay);
    opacity: 0;
    will-change: opacity;
    transition: opacity var(--c-300) var(--ease-toggle);
    pointer-events: none;
  }
  .clip {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    border-radius: inherit;
    overflow: hidden;
  }

  /* The pick-up: 180ms, derived from the base beat the way `--breath` is. */
  .deck.lifted .lift {
    transform: scale(0.96);
    border-radius: var(--radius-modal);
    transition:
      transform calc(var(--c-300) * 0.6) var(--ease-entry),
      border-radius calc(var(--c-300) * 0.6) var(--ease-entry);
  }
  .deck.lifted .lift::before {
    opacity: 1;
    transition: opacity calc(var(--c-300) * 0.6) var(--ease-entry);
  }

  /* `visibility`, never `display`, and only the hidden state is declared —
     see the note on `.pane-hidden` in PaneLeaf: a re-declared `visible`
     paints through a hidden ancestor. */
  .card-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  .dots {
    position: absolute;
    right: var(--space-3);
    top: 50%;
    translate: 0 -50%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    opacity: 0;
    transition: opacity 160ms var(--ease-entry);
    pointer-events: none;
    z-index: 5;
  }
  .deck.lifted .dots {
    opacity: 1;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--ink-muted);
    opacity: 0.5;
    transition:
      height 160ms var(--ease-entry),
      opacity 160ms var(--ease-entry);
  }
  .dot-on {
    height: 18px;
    opacity: 1;
    background: var(--ink-strong);
  }

  /* Fewer and gentler, not none: the fades stay, the movement goes. */
  @media (prefers-reduced-motion: reduce) {
    .lift,
    .lift::before,
    .deck.lifted .lift,
    .deck.lifted .lift::before {
      transition: none;
    }
    .dot {
      transition: opacity 160ms var(--ease-entry);
    }
    .deck.lifted .lift {
      transform: scale(1);
      border-radius: 0;
    }
  }
</style>

<script lang="ts">
  /**
   * The phone's groups, as a vertical stack of cards.
   *
   * Every group is mounted and only the focused one is visible, so a split
   * made at the desk is reachable here: two fingers drag the stack and the
   * neighbour comes into view under them. Keeping the others mounted is
   * cheap — a conversation is mounted once by `PaneHost` and docked into
   * its group's slot, so a card that is put away holds nothing heavy of its
   * own. Only the focused group takes the one-finger tab swipe, and only it
   * prewarms its neighbouring tabs; the rest mount just their active tab.
   */
  import PaneLeaf from './PaneLeaf.svelte';
  import { workspace } from './workspace.svelte';
  import { createDeck } from './deck.svelte';

  const deck = createDeck(
    () => workspace.leaves,
    () => workspace.focusedLeafId
  );
</script>

<div class="deck" class:lifted={deck.lifted} use:deck.action>
  {#each workspace.leaves as leaf (leaf.id)}
    {@const focused = leaf.id === workspace.focusedLeafId}
    {@const offset = deck.offsetOf(leaf.id)}
    {@const shown = focused || offset !== null}
    <div
      class="card"
      class:card-hidden={!shown}
      inert={!focused}
      style:transform={offset === null ? 'translateY(0)' : `translateY(${offset}px)`}
    >
      <div class="clip">
        <PaneLeaf {leaf} swipeable={focused} />
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
  }

  /* Only transform and opacity ever animate here: the card is a whole
     transcript, and repainting one for a shadow or a radius tween would
     cost frames in the middle of a gesture. So the shadow sits on a
     pseudo-element and fades, and the radius simply appears — under a
     scale already in motion it is not seen arriving. The clip is a child
     because `overflow: hidden` on the card would cut the shadow off. */
  .card {
    position: absolute;
    inset: 0;
    display: flex;
    min-width: 0;
    min-height: 0;
    will-change: transform;
    transition: scale 180ms var(--ease-entry);
  }
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: var(--shadow-overlay);
    opacity: 0;
    transition: opacity 180ms var(--ease-entry);
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

  /* The transition runs both ways, so the card sets down as the spring lands. */
  .deck.lifted .card {
    scale: 0.96;
    border-radius: var(--radius-modal);
  }
  .deck.lifted .card::before {
    opacity: 1;
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
    .card {
      transition: none;
    }
    .dot {
      transition: opacity 160ms var(--ease-entry);
    }
    .deck.lifted .card {
      scale: 1;
      border-radius: 0;
    }
  }
</style>

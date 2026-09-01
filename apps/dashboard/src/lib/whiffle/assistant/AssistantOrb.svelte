<script lang="ts">
  /**
   * The summon control — the SINGLE place `--accent-solid` appears as a solid
   * fill in the product (DESIGN.md L81). Fixed bottom-right 24px (our choice —
   * mocks only show the open state). Press/hover states match the rest of the
   * app's tactile vocabulary.
   */

  let {
    onclick,
    open = false,
    ref = $bindable(null),
  }: {
    onclick: () => void;
    open: boolean;
    ref?: HTMLButtonElement | null;
  } = $props();
</script>

<button
  bind:this={ref}
  type="button"
  class="orb"
  aria-label={open ? 'Close assistant' : 'Open assistant'}
  aria-expanded={open}
  {onclick}
>
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {#if open}
      <path d="M6.22 6.22a.75.75 0 0 1 1.06 0L12 10.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L13.06 12l4.72 4.72a.75.75 0 1 1-1.06 1.06L12 13.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L10.94 12 6.22 7.28a.75.75 0 0 1 0-1.06" />
    {:else}
      <path d="M3.845 3.845a2.883 2.883 0 0 0 0 4.077L5.432 9.51c.012-.014.555.503.568.49l4-4c.013-.013-.504-.556-.49-.568L7.922 3.845a2.883 2.883 0 0 0-4.077 0m1.288 11.462a.483.483 0 0 1 .9 0l.157.4a.48.48 0 0 0 .272.273l.398.157a.486.486 0 0 1 0 .903l-.398.158a.48.48 0 0 0-.272.273l-.157.4a.483.483 0 0 1-.9 0l-.157-.4a.48.48 0 0 0-.272-.273l-.398-.158a.486.486 0 0 1 0-.903l.398-.157a.48.48 0 0 0 .272-.274z" opacity=".5" />
      <path d="M19.967 9.13a.483.483 0 0 1 .9 0l.156.399c.05.125.148.224.273.273l.398.158a.486.486 0 0 1 0 .902l-.398.158a.5.5 0 0 0-.273.273l-.156.4a.483.483 0 0 1-.9 0l-.157-.4a.5.5 0 0 0-.272-.273l-.398-.158a.486.486 0 0 1 0-.902l.398-.158a.5.5 0 0 0 .272-.273z" opacity=".2" />
      <path d="M16.1 2.307a.483.483 0 0 1 .9 0l.43 1.095a.48.48 0 0 0 .272.274l1.091.432a.486.486 0 0 1 0 .903l-1.09.432a.5.5 0 0 0-.273.273L17 6.81a.483.483 0 0 1-.9 0l-.43-1.095a.5.5 0 0 0-.273-.273l-1.09-.432a.486.486 0 0 1 0-.903l1.09-.432a.5.5 0 0 0 .273-.274z" opacity=".7" />
      <path d="M10.568 6.49c-.012.014-.555-.503-.568-.49l-4 4c-.013.013.504.556.49.568l9.588 9.587a2.883 2.883 0 1 0 4.078-4.077z" />
    {/if}
  </svg>
</button>

<style>
  .orb {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 40;
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--accent-solid);
    color: var(--neutral-1);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: var(--shadow-lifted);
    transition:
      background var(--motion-fast) var(--ease-toggle),
      transform var(--motion-fast) var(--ease-toggle);
  }
  .orb svg {
    width: 20px;
    height: 20px;
  }
  @media (hover: hover) and (pointer: fine) {
    .orb:hover {
      background: var(--accent-solid-hover);
    }
  }
  .orb:active {
    transform: scale(0.92);
  }
  @media (prefers-reduced-motion: reduce) {
    .orb:active {
      transform: none;
    }
  }
  .orb:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    .orb {
      width: 52px;
      height: 52px;
    }
  }
</style>

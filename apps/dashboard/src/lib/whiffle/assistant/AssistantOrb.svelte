<script lang="ts">
  /**
   * The assistant's summon, living in the top bar with the rest of the
   * chrome — a floating FAB read as foreign in this quiet, rail-based UI
   * (operator verdict), so the control joined the toolbar. Still the SINGLE
   * place `--accent-solid` appears as a solid fill (DESIGN.md L81): the one
   * warm dot in an otherwise hueless bar is the summon's whole signature.
   */
  import { IconAssistant } from "$lib/icons";

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
  aria-expanded={open}
  aria-label={open ? 'Close assistant' : 'Open assistant'}
  class="orb"
  {onclick}
  title="Assistant"
  type="button"
  bind:this={ref}
>
  <IconAssistant />
</button>

<style>
  .orb {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--accent-solid);
    color: var(--on-brand);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      background var(--c-100) var(--e-toggle),
      transform var(--c-100) var(--e-toggle);
  }
  .orb :global(svg) {
    width: 16px;
    height: 16px;
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
      width: 36px;
      height: 36px;
    }
  }
</style>

<script lang="ts">
  /**
   * Filter select — a button-styled trigger with a trailing chevron. Presents a
   * value; wire the actual menu at the call site (bits-ui/DropdownMenu) via the
   * default onclick. Ported from mocks/v5-components.html (.sel).
   */
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    label,
    lead,
    class: klass = '',
    children,
    ...rest
  }: {
    /** the current value text */
    label?: string;
    lead?: Snippet;
    class?: string;
    children?: Snippet;
  } & HTMLButtonAttributes = $props();
</script>

<button type="button" class="sel {klass}" {...rest}>
  {#if lead}{@render lead()}{/if}
  <span class="lbl">{#if children}{@render children()}{:else}{label}{/if}</span>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9.5 12 15l6-5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</button>

<style>
  .sel {
    height: var(--c-btn-h);
    padding: 0 var(--c-btn-pad);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    display: inline-flex;
    align-items: center;
    gap: var(--c-btn-gap);
    min-width: 180px;
    text-align: left;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-family: var(--font-body);
    font-size: var(--c-btn-fs);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    cursor: pointer;
  }
  .sel > svg {
    width: 18px;
    height: 18px;
    color: var(--ink-muted);
    margin-left: auto;
    flex: 0 0 auto;
  }
  .sel :global(svg.lead) {
    color: var(--ink-muted);
    flex: 0 0 auto;
  }
  @media (hover: hover) and (pointer: fine) {
    .sel:hover {
      background-color: var(--surface-hover);
    }
    .sel:active {
      background-color: var(--surface-active);
    }
  }
  .sel:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .lbl {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    font-weight: var(--weight-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

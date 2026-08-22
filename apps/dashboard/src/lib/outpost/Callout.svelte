<script lang="ts">
  /**
   * Callout — a bordered tint band with a shadowed icon container. warning tint
   * by default, danger (red) variant. Ported from mocks/v5-components.html (.callout).
   */
  import type { Snippet } from 'svelte';

  let {
    danger = false,
    icon,
    class: klass = '',
    children,
  }: {
    danger?: boolean;
    /** the leading glyph, shown in a raised shadowed container */
    icon?: Snippet;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="callout {danger ? 'danger' : ''} {klass}">
  {#if icon}<span class="ico">{@render icon()}</span>{/if}
  <span class="body">{@render children?.()}</span>
</div>

<style>
  .callout {
    display: flex;
    align-items: flex-start;
    gap: var(--c-card-gap);
    padding: var(--space-3);
    border: 1px solid var(--warning-9);
    border-radius: var(--radius-control);
    background: var(--warning-3);
    color: var(--warning-11);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
  }
  .callout.danger {
    border-color: var(--error-9);
    background: var(--error-3);
    color: var(--error-11);
  }
  .ico {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--shadow-lifted);
  }
  .ico :global(svg) {
    width: 17px;
    height: 17px;
  }
  .body {
    min-width: 0;
    flex: 1 1 auto;
  }
</style>

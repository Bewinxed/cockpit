<script lang="ts">
  /**
   * Sheet — a mobile slide-over surface: overlay surface, panel radius, drawer
   * shadow, header with a title + bordered close, and a body. Presentational —
   * wire open/close at the call site. Ported from mocks/v5-components.html (.sheet).
   */
  import type { Snippet } from 'svelte';

  let {
    title = undefined,
    onclose = undefined,
    class: klass = '',
    children,
  }: {
    title?: string;
    onclose?: () => void;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="sheet {klass}" role="dialog" aria-label={title}>
  <div class="sh">
    {#if title}<b>{title}</b>{/if}
    <button class="x" type="button" aria-label="Close" onclick={onclose}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </button>
  </div>
  <div class="sb">{@render children?.()}</div>
</div>

<style>
  .sheet {
    width: min(var(--c-sheet-w), 100%);
    max-width: 100%;
    min-width: 0;
    background: var(--surface-overlay);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-drawer);
    border: 1px solid var(--border-hairline);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .sh {
    padding: calc(var(--c-card-pad) + 4px) var(--c-card-pad);
    border-bottom: 1px solid var(--border-hairline);
    display: flex;
    align-items: center;
    gap: var(--c-card-gap);
  }
  .sh b {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--ink-strong);
  }
  .x {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-body);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .x svg {
    width: 16px;
    height: 16px;
  }
  .sb {
    padding: var(--c-card-pad);
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    color: var(--ink-body);
    font-size: var(--text-md);
    line-height: var(--leading-body);
  }
</style>

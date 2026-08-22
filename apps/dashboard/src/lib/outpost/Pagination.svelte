<script lang="ts">
  /**
   * Pagination — filled active page (graphite gradient), bordered chevrons.
   * Ported from mocks/v5-components.html (.pager/.page).
   */
  let {
    page = $bindable(1),
    total = 1,
    onchange = undefined,
    class: klass = '',
  }: {
    page?: number;
    total?: number;
    onchange?: (page: number) => void;
    class?: string;
  } = $props();

  /** windowed page list with ellipses, e.g. 1 … 4 [5] 6 … 20 */
  const items = $derived.by<(number | '…')[]>(() => {
    const out: (number | '…')[] = [];
    const push = (n: number | '…') => out.push(n);
    const near = (n: number) => Math.abs(n - page) <= 1;
    for (let n = 1; n <= total; n++) {
      if (n === 1 || n === total || near(n)) push(n);
      else if (out[out.length - 1] !== '…') push('…');
    }
    return out;
  });

  function go(n: number) {
    const clamped = Math.min(total, Math.max(1, n));
    if (clamped === page) return;
    page = clamped;
    onchange?.(clamped);
  }
</script>

<nav class="pager {klass}" aria-label="Pagination">
  <button class="page b" type="button" aria-label="Previous page" disabled={page <= 1} onclick={() => go(page - 1)}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  {#each items as it, i (i)}
    {#if it === '…'}
      <span class="page ellipsis" aria-hidden="true">…</span>
    {:else}
      <button
        class="page {it === page ? 'on' : ''}"
        type="button"
        aria-current={it === page ? 'page' : undefined}
        onclick={() => go(it)}
      >{it}</button>
    {/if}
  {/each}
  <button class="page b" type="button" aria-label="Next page" disabled={page >= total} onclick={() => go(page + 1)}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
</nav>

<style>
  .pager {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .page {
    min-width: var(--c-page);
    height: var(--c-page);
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    color: var(--ink-body);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: 1;
    cursor: pointer;
  }
  .page > svg {
    width: 14px;
    height: 14px;
  }
  .page.b {
    border-color: var(--border-control);
    background: var(--surface-raised);
    color: var(--ink-muted);
  }
  .page.on {
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    font-weight: var(--weight-strong);
  }
  .page.ellipsis {
    color: var(--ink-muted);
    cursor: default;
  }
  .page[disabled] {
    opacity: 0.45;
    cursor: default;
  }
  @media (hover: hover) and (pointer: fine) {
    .page:not(.on):not(.ellipsis):not([disabled]):hover {
      background-color: var(--surface-hover);
    }
    .page:not([disabled]):active {
      background-color: var(--surface-active);
    }
  }
  .page:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>

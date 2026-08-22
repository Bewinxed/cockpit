<script lang="ts">
  /**
   * Nav item + count pill. Active = raised fill on the sunken rail; the count
   * pill carries status ink on a tint. Ported from mocks/v5-components.html (.nav-i).
   */
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  let {
    href = undefined,
    active = false,
    count = undefined,
    attn = false,
    icon,
    class: klass = '',
    children,
    ...rest
  }: {
    href?: string;
    active?: boolean;
    /** trailing count; hidden when undefined/null */
    count?: number | string;
    /** count pill carries the attention tint rather than the live tint */
    attn?: boolean;
    icon?: Snippet;
    class?: string;
    children?: Snippet;
  } & HTMLAnchorAttributes = $props();

  const showCount = $derived(count !== undefined && count !== null && count !== '');
</script>

<a
  {href}
  class="nav-i {active ? 'on' : ''} {klass}"
  aria-current={active ? 'page' : undefined}
  {...rest}
>
  {#if icon}<span class="ic">{@render icon()}</span>{/if}
  <span class="lbl">{@render children?.()}</span>
  {#if showCount}<span class="cnt {attn ? 'attn' : ''}">{count}</span>{/if}
</a>

<style>
  .nav-i {
    height: var(--c-nav-h);
    border-radius: var(--radius-control);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    font-size: var(--text-md);
    color: var(--ink-body);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }
  .ic {
    width: 18px;
    text-align: center;
    color: var(--ink-muted);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
  }
  .ic :global(svg) {
    width: 16px;
    height: 16px;
    display: block;
  }
  .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cnt {
    margin-left: auto;
    flex: 0 0 auto;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: 1;
    padding: 3px 7px;
    border-radius: var(--radius-pill);
    background: var(--status-live-bg);
    color: var(--status-live-ink);
  }
  .cnt.attn {
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .nav-i.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    box-shadow: var(--shadow-tile);
    font-weight: var(--weight-strong);
  }
  .nav-i.on .ic {
    color: var(--ink-body);
  }
  @media (hover: hover) and (pointer: fine) {
    .nav-i:hover {
      background: var(--surface-hover);
    }
    .nav-i.on:hover {
      background: var(--surface-raised);
    }
    .nav-i:active {
      background: var(--surface-active);
    }
  }
  .nav-i:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-control);
  }
</style>

<script lang="ts">
  /**
   * Stat card tile — label (k) / value (v) / unit (u) inside the raised-panel +
   * sunken-well signature. Tappable when `href`/`onclick` is given (a real
   * control around the panel). Ported from mocks/v5-components.html (.tile/.panel/.well).
   */
  import type { Snippet } from 'svelte';

  let {
    label,
    value,
    unit = undefined,
    href = undefined,
    onclick = undefined,
    disabled = false,
    class: klass = '',
    children,
  }: {
    label: string;
    value?: string | number;
    unit?: string;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    class?: string;
    /** custom well body; overrides label/value/unit rendering when provided */
    children?: Snippet;
  } = $props();

  const interactive = $derived(!!href || !!onclick);
</script>

{#snippet body()}
  <div class="panel">
    <div class="well">
      {#if children}
        {@render children()}
      {:else}
        <span class="k">{label}</span>
        {#if value !== undefined}<span class="v">{value}</span>{/if}
        {#if unit}<span class="u">{unit}</span>{/if}
      {/if}
    </div>
  </div>
{/snippet}

{#if interactive && href}
  <a class="tile {klass}" {href} aria-disabled={disabled}>{@render body()}</a>
{:else if interactive}
  <button class="tile {klass}" type="button" {onclick} {disabled}>{@render body()}</button>
{:else}
  <div class="tile static {klass}">{@render body()}</div>
{/if}

<style>
  .tile {
    display: inline-block;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-panel);
    font: inherit;
    text-align: left;
    text-decoration: none;
  }
  .tile.static {
    cursor: default;
  }
  .tile:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-panel);
  }
  @media (hover: hover) and (pointer: fine) {
    .tile:not(.static):hover .panel {
      filter: brightness(1.02);
    }
    .tile:not(.static):active .panel {
      filter: brightness(0.98);
    }
  }
  .tile[disabled] {
    cursor: default;
    opacity: 0.55;
  }
  .panel {
    background: var(--surface-raised);
    border-radius: var(--radius-panel);
    padding: var(--c-card-pad);
    box-shadow: var(--shadow-lifted);
    display: flex;
    flex-direction: column;
    transition: box-shadow var(--c-100) var(--e-toggle);
  }
  .well {
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-well);
    padding: var(--c-card-pad);
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    flex: 1 1 auto;
    min-height: 0;
    justify-content: center;
  }
  .k {
    color: var(--ink-label);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .v {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-numeric);
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .u {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
</style>

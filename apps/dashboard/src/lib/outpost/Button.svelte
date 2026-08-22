<script lang="ts">
  /**
   * Outpost button — the never-flat action.
   * primary: graphite gradient + inset bottom edge. secondary: ghost/outline.
   * destructive: red outline; destructive-solid: red fill (final-confirm only).
   * Ported verbatim from mocks/v5-components.html (.btn).
   */
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  type Variant = 'default' | 'primary' | 'destructive' | 'destructive-solid';
  type Size = 'default' | 'icon' | 'icon-sm';

  let {
    variant = 'default',
    size = 'default',
    href = undefined,
    type = 'button',
    class: klass = '',
    children,
    ...rest
  }: {
    variant?: Variant;
    size?: Size;
    href?: string;
    type?: HTMLButtonAttributes['type'];
    class?: string;
    children?: Snippet;
  } & Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'type'> = $props();

  const cls = $derived(
    [
      'btn',
      variant === 'primary' && 'pri',
      variant === 'destructive' && 'des',
      variant === 'destructive-solid' && 'des sol',
      size === 'icon' && 'ic',
      size === 'icon-sm' && 'ic sm',
      klass,
    ]
      .filter(Boolean)
      .join(' ')
  );
</script>

{#if href}
  <a {href} class={cls} {...rest as HTMLAnchorAttributes}>{@render children?.()}</a>
{:else}
  <button {type} class={cls} {...rest as HTMLButtonAttributes}>{@render children?.()}</button>
{/if}

<style>
  .btn {
    height: var(--c-btn-h);
    padding: 0 var(--c-btn-pad);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--c-btn-gap);
    font-family: var(--font-body);
    font-size: var(--c-btn-fs);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    letter-spacing: 0;
    background: var(--surface-raised);
    color: var(--ink-strong);
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
    transition:
      background-color var(--c-100) var(--e-toggle),
      filter var(--c-100) var(--e-toggle),
      box-shadow var(--c-100) var(--e-toggle);
  }
  .btn :global(svg) {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
  }
  .btn.ic {
    width: var(--c-btn-h);
    padding: 0;
  }
  .btn.ic.sm {
    width: var(--c-btn-h-s);
    height: var(--c-btn-h-s);
  }
  .btn.ic.sm :global(svg) {
    width: 16px;
    height: 16px;
  }
  .btn.pri {
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    border-color: transparent;
  }
  .btn.des {
    border-color: var(--error-9);
    color: var(--error-11);
  }
  .btn.des.sol {
    background: var(--error-9);
    color: var(--mark-glyph);
    border-color: transparent;
    box-shadow: var(--shadow-action);
  }
  @media (hover: hover) and (pointer: fine) {
    .btn:hover {
      background-color: var(--surface-hover);
    }
    .btn.pri:hover {
      filter: brightness(1.08);
    }
    .btn:active {
      filter: brightness(0.94);
      box-shadow: var(--shadow-inset-sel);
    }
    .btn.des:hover {
      background-color: var(--error-3);
    }
  }
  .btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-control);
  }
  .btn:disabled,
  .btn[aria-disabled='true'] {
    cursor: default;
    opacity: 0.45;
    box-shadow: none;
    background-image: none;
    border-color: var(--border-control);
    color: var(--ink-muted);
  }
</style>

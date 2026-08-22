<script lang="ts">
  /**
   * Modal / dialog — the priority component. A centered card on a dimmed scrim:
   * a top strip carrying the brand mark (left) and a bordered close (right), an
   * inset hairline body card with title / subtitle / content, and a footer that
   * sits back on the base surface with right-aligned actions. ~460px.
   * Ported from mocks/v5-components.html (.scrim/.modal/.mod-*).
   */
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    subtitle = undefined,
    onclose = undefined,
    brand,
    footer,
    children,
  }: {
    open?: boolean;
    title: string;
    subtitle?: string;
    onclose?: () => void;
    /** the brand glyph shown in the graphite header mark (defaults to a spark) */
    brand?: Snippet;
    /** right-aligned footer actions (e.g. Cancel + primary) */
    footer?: Snippet;
    children?: Snippet;
  } = $props();

  const titleId = 'op-modal-title';

  function close() {
    open = false;
    onclose?.();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scrim" onclick={close}>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="mod-hd">
        <span class="brand" aria-hidden="true">
          {#if brand}{@render brand()}{:else}
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          {/if}
        </span>
        <button class="close" type="button" aria-label="Close" onclick={close}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
      </div>

      <div class="mod-bd">
        <div class="ttl">
          <h3 id={titleId}>{title}</h3>
          {#if subtitle}<p>{subtitle}</p>{/if}
        </div>
        {@render children?.()}
      </div>

      {#if footer}
        <div class="mod-ft">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: grid;
    place-items: center;
    padding: 24px;
    z-index: 50;
  }
  .modal {
    width: min(var(--c-mod-w), 100%);
    max-width: 100%;
    min-width: 0;
    background: var(--surface-field);
    border: 1px solid var(--surface-raised);
    border-radius: var(--radius-shell);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }
  .mod-hd {
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--c-card-gap);
  }
  .brand {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-control);
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .brand :global(svg) {
    width: 16px;
    height: 16px;
  }
  .close {
    margin-left: auto;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    color: var(--ink-muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  @media (hover: hover) and (pointer: fine) {
    .close:hover {
      background: var(--surface-hover);
      color: var(--ink-body);
    }
  }
  .close:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .close svg {
    width: 16px;
    height: 16px;
  }
  .mod-bd {
    background: var(--surface-overlay);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-panel);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .ttl {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .ttl h3 {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
  }
  .ttl p {
    font-size: var(--text-lg);
    color: var(--ink-muted);
    line-height: var(--leading-body);
  }
  .mod-ft {
    display: flex;
    justify-content: flex-end;
    gap: var(--c-mod-gap);
    padding: var(--space-4);
    background: var(--surface-overlay);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-panel);
  }
</style>

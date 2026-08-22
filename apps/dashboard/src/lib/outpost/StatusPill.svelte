<script lang="ts">
  /**
   * Status pill — Flexoki accent light-tint bg + darker ink, glyph-led.
   * live / attn / done / fail carry a fill; idle carries NO fill (absence of a
   * chip IS the idle state). Ported from mocks/v5-components.html (.pill).
   */
  import type { Snippet } from 'svelte';

  type Status = 'live' | 'attn' | 'done' | 'fail' | 'idle';

  let {
    status = 'idle',
    icon,
    class: klass = '',
    children,
  }: {
    status?: Status;
    /** small 10px glyph, rendered left of the label */
    icon?: Snippet;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<span class="pill {status} {klass}">
  {#if icon && status !== 'idle'}{@render icon()}{/if}
  {@render children?.()}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--c-pill-gap);
    height: var(--c-pill-h);
    padding: 0 10px;
    border-radius: var(--radius-pill);
    font-size: var(--c-pill-fs);
    font-weight: var(--weight-strong);
    white-space: nowrap;
  }
  .pill :global(svg) {
    width: 10px;
    height: 10px;
    flex: 0 0 auto;
    display: block;
  }
  .pill.live {
    background: var(--status-live-bg);
    color: var(--status-live-ink);
  }
  .pill.attn {
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .pill.done {
    background: var(--status-done-bg);
    color: var(--status-done-ink);
  }
  .pill.fail {
    background: var(--status-fail-bg);
    color: var(--status-fail-ink);
  }
  .pill.idle {
    background: var(--status-idle-bg);
    color: var(--status-idle-ink);
    padding: 0;
    font-weight: var(--weight-medium);
  }
</style>

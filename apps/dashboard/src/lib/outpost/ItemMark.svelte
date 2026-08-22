<script lang="ts">
  /**
   * Item mark — identity HUE (8 Flexoki accent hues) + harness GLYPH.
   * A saturated solid with a white line-glyph and the top-light/bottom-shade
   * overlay read. Ported from mocks/v5-components.html (.mark).
   */
  import type { Snippet } from 'svelte';

  let {
    hue = 1,
    class: klass = '',
    title,
    children,
  }: {
    /** identity hue 1–8 (red, orange, yellow, green, cyan, blue, purple, magenta) */
    hue?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    class?: string;
    title?: string;
    /** the harness glyph — a line-icon svg */
    children?: Snippet;
  } = $props();
</script>

<span class="mark m{hue} {klass}" {title} aria-hidden={title ? undefined : 'true'}>
  {@render children?.()}
</span>

<style>
  .mark {
    width: var(--c-mark);
    height: var(--c-mark);
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .mark :global(svg) {
    width: var(--c-mark-glyph);
    height: var(--c-mark-glyph);
    display: block;
    stroke: var(--mark-glyph);
    color: var(--mark-glyph);
    opacity: 1;
    stroke-width: 1.6;
  }
  .mark.m2 { background-color: var(--mark-2); }
  .mark.m3 { background-color: var(--mark-3); }
  .mark.m4 { background-color: var(--mark-4); }
  .mark.m5 { background-color: var(--mark-5); }
  .mark.m6 { background-color: var(--mark-6); }
  .mark.m7 { background-color: var(--mark-7); }
  .mark.m8 { background-color: var(--mark-8); }
</style>

<script lang="ts">
  /**
   * A turn's words — plain running text at 74ch, no card, no bubble. Markdown
   * so a fenced block or a list reads as one, and the `.msg` frame carries the
   * mock's inline-code and measure.
   */
  import { Markdown } from '$lib/components/ui/markdown';

  let { source, streaming = false }: { source: string; streaming?: boolean } = $props();
</script>

<div class="msg">
  <Markdown {source} {streaming} />
</div>

<style>
  .msg {
    font-size: var(--text-base);
    line-height: var(--leading-body);
    color: var(--ink-strong);
    max-width: 74ch;
  }
  .msg :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--surface-sunken);
    padding: 1px 4px;
    border-radius: var(--radius-mark);
  }
</style>

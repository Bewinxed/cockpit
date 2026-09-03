<script lang="ts">
  /**
   * A turn's words — plain running text at 74ch, no card, no bubble. Markdown
   * so a fenced block or a list reads as one, and the `.msg` frame carries the
   * mock's inline-code and measure.
   *
   * The type and rhythm rules below are `:global` on purpose. Streamdown puts
   * the `prose prose-sm …` class (see `$lib/prose`) on its own root div, and
   * `prose-sm` declares its own font-size, line-height and per-element em
   * margins there — so anything set on `.msg` alone is inherited into that root
   * and then immediately overridden. The scale lives on the token sheet, not in
   * the typography plugin, so the root is restated here.
   */
  import { Markdown } from "$lib/components/ui/markdown";

  let { source, streaming = false }: { source: string; streaming?: boolean } =
    $props();
</script>

<div class="msg">
  <Markdown {source} {streaming} />
</div>

<style>
  .msg {
    font-size: var(--text-md);
    line-height: var(--leading-body);
    color: var(--ink-strong);
    max-width: 74ch;
  }
  .msg :global(.prose) {
    font-size: var(--text-md);
    line-height: var(--leading-body);
    color: var(--ink-strong);
  }

  /* ---- Block rhythm. The plugin's em-scaled margins are off the --space
     ladder; one gap between every pair of blocks puts them back on it, and
     `* + *` means a turn never opens or closes with dead space. */
  .msg :global(.prose > * + *) {
    margin-top: var(--space-3);
  }
  .msg :global(.prose > :first-child) {
    margin-top: 0;
  }
  .msg :global(.prose > :last-child) {
    margin-bottom: 0;
  }
  .msg :global(p),
  .msg :global(ul),
  .msg :global(ol),
  .msg :global(blockquote) {
    margin-block: 0;
  }
  /* Nested rhythm the top-level `> * + *` rule cannot reach. */
  .msg :global(p + p) {
    margin-top: var(--space-3);
  }
  .msg :global(li + li) {
    margin-top: var(--space-1);
  }
  .msg :global(li > ul),
  .msg :global(li > ol) {
    margin-top: var(--space-1);
  }
  .msg :global(ul),
  .msg :global(ol) {
    padding-left: var(--space-5);
  }

  /* A reply is not a document: its headings are emphasis, not a title page. */
  .msg :global(.prose h1),
  .msg :global(.prose h2),
  .msg :global(.prose h3),
  .msg :global(.prose h4),
  .msg :global(.prose h5),
  .msg :global(.prose h6) {
    font-size: var(--text-md);
    line-height: var(--leading-ui);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .msg :global(.prose > * + h1),
  .msg :global(.prose > * + h2),
  .msg :global(.prose > * + h3),
  .msg :global(.prose > * + h4),
  .msg :global(.prose > * + h5),
  .msg :global(.prose > * + h6) {
    margin-top: var(--space-5);
  }

  .msg :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--surface-sunken);
    padding: 1px 4px;
    border-radius: var(--radius-mark);
  }
  /* A fence renders through OutputBlock, which paints its own well inside a
     `.not-prose` wrapper; the direct-child selector is the fallback for any
     `pre` that reaches prose itself, and leaves OutputBlock's alone. */
  .msg :global(.prose > pre) {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    background: var(--surface-sunken);
    border-radius: var(--radius-well);
    padding: var(--space-3);
    overflow-x: auto;
  }
  .msg :global(.prose > pre code) {
    background: none;
    padding: 0;
    font-size: inherit;
  }
</style>

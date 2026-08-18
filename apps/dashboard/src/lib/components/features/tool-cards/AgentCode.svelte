<script lang="ts">
  /**
   * Code with its colours on: one span per Shiki token, each carrying the light
   * ink and the dark ink as CSS variables, so the two appearances are one paint
   * and switching theme costs no work at all.
   *
   * Text renders plain until its tokens arrive, and a block that is still
   * growing keeps the colours it already has (`paintableTokens`) — a running
   * command's output never flashes back to grey between two frames.
   */
  import { untrack } from 'svelte';
  import {
    cachedTokens,
    paintableTokens,
    tokenize,
    type AgentCodeLanguage,
    type AgentCodeTokens,
  } from './agent-code';

  interface Props {
    code: string;
    language: AgentCodeLanguage;
    /** A muted gutter, for a body whose lines a reader may want to cite. */
    lineNumbers?: boolean;
    /**
     * Bare `code` with no `pre` and no scrolling of its own, for code set into
     * a surface that already has both: the tokens take that surface's type,
     * wrapping and resting colour, and only the painted ones override it.
     */
    inline?: boolean;
  }

  let { code, language, lineNumbers = false, inline = false }: Props = $props();

  /** Cached tokens mount painted; the effect below keeps them in step after. */
  let painted = $state<AgentCodeTokens | null>(untrack(() => cachedTokens(code, language)));

  $effect(() => {
    const cached = cachedTokens(code, language);
    if (cached) {
      painted = cached;
      return;
    }
    let cancelled = false;
    void tokenize(code, language).then((tokens) => {
      if (!cancelled) painted = tokens;
    });
    return () => {
      cancelled = true;
    };
  });

  const tokens = $derived(paintableTokens(painted, code, language));

  /** Each line with the offset it starts at, which is its key across a stream. */
  const lines = $derived.by(() => {
    let offset = 0;
    return code.split('\n').map((content) => {
      const line = { content, offset };
      offset += content.length + 1;
      return line;
    });
  });

  const PRE = 'm-0 overflow-x-auto whitespace-pre font-mono text-micro leading-5 text-foreground/85';
  /**
   * The break between two lines, as a value: written into the markup it would
   * be indistinguishable from the indentation around it.
   */
  const NEWLINE = '\n';
</script>

<!-- `pre` renders the markup's own whitespace, so the blocks below run tight:
     a newline taken for indentation would be a newline on screen. -->
{#snippet paint(index: number, content: string)}{@const line = tokens?.[index]}{#if line}{#each line as token (token.offset)}<span style:--agent-code-light={token.light ?? 'currentColor'} style:--agent-code-dark={token.dark ?? token.light ?? 'currentColor'} class="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]">{token.content}</span>{/each}{:else}{content}{/if}{/snippet}

{#snippet flow()}{#each lines as line, index (line.offset)}{@render paint(index, line.content)}{#if index < lines.length - 1}{NEWLINE}{/if}{/each}{/snippet}

{#if inline}
  <code>{@render flow()}</code>
{:else if lineNumbers}
  <pre class="{PRE} min-w-max"><code>{#each lines as line, index (line.offset)}<span class="grid min-h-5 grid-cols-[2.75rem_minmax(0,1fr)]"><span class="pr-3 text-right tabular-nums text-faint select-none">{index + 1}</span><span class="pl-1">{@render paint(index, line.content)}</span></span>{/each}</code></pre>
{:else}
  <pre class={PRE}><code>{@render flow()}</code></pre>
{/if}

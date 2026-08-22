<script lang="ts">
  /**
   * The one code surface the console opens into — a tool result's output and a
   * markdown fence share it. Colour rides on the token as a light/dark pair and
   * CSS picks, so a theme switch repaints without tokenizing a line again; a
   * grammar the highlighter does not carry falls back to a plain mono well.
   */
  import {
    agentCodeLanguage,
    cachedTokens,
    paintableTokens,
    tokenize,
    type AgentCodeTokenLines,
    type AgentCodeTokens,
  } from './agent-code';

  let { text, language = undefined }: { text: string; language?: string | null } = $props();

  const lang = $derived(agentCodeLanguage(language));

  let painted = $state<AgentCodeTokens | null>(null);

  // The tokens that may paint right now: the ones in hand while a fresh batch is
  // pending, so a streaming block stays coloured between frames.
  const lines = $derived.by<AgentCodeTokenLines | null>(() => {
    if (!lang) return null;
    return paintableTokens(painted, text, lang) ?? cachedTokens(text, lang)?.lines ?? null;
  });

  $effect(() => {
    if (!lang) return;
    let live = true;
    void tokenize(text, lang).then((result) => {
      if (live) painted = result;
    });
    return () => {
      live = false;
    };
  });
</script>

<div class="well">
  {#if lines}
    <pre><code
        >{#each lines as line}<span class="ln"
            >{#each line as token}<span
                style="--l:{token.light ?? 'inherit'};--d:{token.dark ?? 'inherit'}"
                >{token.content}</span
              >{/each}{'\n'}</span
          >{/each}</code
      ></pre>
  {:else}
    <pre><code>{text}</code></pre>
  {/if}
</div>

<style>
  .well {
    background: var(--surface-sunken);
    border-radius: var(--radius-well);
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    color: var(--ink-strong);
  }
  pre {
    margin: 0;
    white-space: pre;
  }
  .ln span {
    color: light-dark(var(--l), var(--d));
  }
</style>

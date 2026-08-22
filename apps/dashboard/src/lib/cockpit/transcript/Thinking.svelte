<script lang="ts">
  /**
   * A reasoning trace on the rail — truncated, italic, muted, with a blinking
   * caret while the block is still being generated. Ported from the mock's
   * `.think`.
   */
  let { text, live = false }: { text: string; live?: boolean } = $props();
</script>

<div class="think">{#if text}{text}{:else}Thinking…{/if}{#if live}<span class="caret"></span>{/if}</div>

<style>
  .think {
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
    background: var(--rail) left top / 2px 100% no-repeat;
    font-style: italic;
    color: var(--ink-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    max-width: 70ch;
    white-space: pre-wrap;
  }
  .caret {
    display: inline-block;
    width: 2px;
    height: 11px;
    background: var(--ink-muted);
    vertical-align: -1px;
    margin-left: 2px;
    animation: blink var(--c-500, 500ms) var(--e-in) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
  }
  @media (max-width: 900px) {
    .think {
      margin-left: 0;
    }
  }
</style>

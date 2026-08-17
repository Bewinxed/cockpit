<script lang="ts">
  /**
   * The lab's mark for a model, as a passive glyph next to its name — in a
   * delegate's header or a picker row. The logos are brand-coloured (that is
   * the point of them), so a caller never tints them: it may only place them.
   * A model nobody here has a logo for renders nothing, and the caller keeps
   * whatever it had been showing instead.
   */
  import type { Component } from 'svelte';
  import { providerOf } from '$lib/cockpit/models.svelte';
  import IconClaude from '~icons/logos/claude-icon';
  import IconOpenai from '~icons/logos/openai-icon';
  import IconDeepseek from '~icons/logos/deepseek-icon';
  import IconGemini from '~icons/logos/google-gemini';
  import IconGrok from '~icons/logos/grok-icon';
  import IconQwen from '~icons/logos/qwen-icon';
  import IconMoonshot from '~icons/logos/moonshot-ai-icon';
  import IconMeta from '~icons/logos/meta-icon';
  import IconMistral from '~icons/logos/mistral-ai-icon';
  import IconNvidia from '~icons/logos/nvidia';
  import IconZhipu from '~icons/thesvg-color/zhipu';
  import IconMinimax from '~icons/thesvg-color/minimax';

  const LOGOS: Record<string, Component> = {
    anthropic: IconClaude,
    openai: IconOpenai,
    deepseek: IconDeepseek,
    google: IconGemini,
    xai: IconGrok,
    qwen: IconQwen,
    moonshot: IconMoonshot,
    zhipu: IconZhipu,
    meta: IconMeta,
    mistral: IconMistral,
    minimax: IconMinimax,
    nvidia: IconNvidia,
  };

  let {
    model,
    size = 16,
    class: className = '',
  }: {
    /** The model id as known on the wire; the provider is read off its name. */
    model: string;
    /** Edge of the square the mark sits in, in px. The mark keeps its own ratio. */
    size?: number;
    class?: string;
  } = $props();

  const Logo = $derived(LOGOS[providerOf(model) ?? '']);

  // A `Record` lookup returns the component or `undefined`; that is the signal
  // the caller's own glyph should keep standing. So the whole body is guarded.
</script>

{#if Logo}
  <Logo width={size} height={size} class={className} />
{/if}

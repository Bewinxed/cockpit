<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    interactive?: boolean;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    href?: string;
    children: Snippet;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  }

  let {
    interactive = false,
    padding = 'md',
    href,
    children,
    class: className = '',
    onclick,
    onkeydown,
  }: Props = $props();

  const paddingClasses = {
    none: '',
    sm: 'p-3',
    md: 'p-5',
    lg: 'p-6',
  };
</script>

{#if href}
  <a
    {href}
    class="card block {interactive ? 'card-interactive' : ''} {paddingClasses[padding]} {className}"
  >
    {@render children()}
  </a>
{:else if interactive}
  <div
    class="card card-interactive {paddingClasses[padding]} {className}"
    role="button"
    tabindex={0}
    {onclick}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onclick?.(e as any);
      }
      onkeydown?.(e);
    }}
  >
    {@render children()}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="card {paddingClasses[padding]} {className}"
    {onclick}
  >
    {@render children()}
  </div>
{/if}

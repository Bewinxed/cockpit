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
    {onkeydown}
  >
    {@render children()}
  </div>
{:else}
  <div
    class="card {paddingClasses[padding]} {className}"
    {onclick}
  >
    {@render children()}
  </div>
{/if}

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    interactive?: boolean;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    href?: string;
    children: Snippet;
  }

  let {
    interactive = false,
    padding = 'md',
    href,
    children,
    class: className = '',
    ...rest
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
    {...rest}
  >
    {@render children()}
  </a>
{:else if interactive}
  <div
    class="card card-interactive {paddingClasses[padding]} {className}"
    role="button"
    tabindex={0}
    {...rest}
  >
    {@render children()}
  </div>
{:else}
  <div
    class="card {paddingClasses[padding]} {className}"
    {...rest}
  >
    {@render children()}
  </div>
{/if}

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';
    size?: 'sm' | 'md';
    dot?: boolean;
    pulse?: boolean;
    children: Snippet;
    class?: string;
  }

  let {
    variant = 'default',
    size = 'md',
    dot = false,
    pulse = false,
    children,
    class: className = '',
  }: Props = $props();

  const variantClasses = {
    default: 'badge-default',
    primary: 'badge-primary',
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    info: 'badge-info',
  };

  const dotColors = {
    default: 'bg-text-muted',
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    info: 'bg-info',
  };

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: '',
  };
</script>

<span class="badge {variantClasses[variant]} {sizeClasses[size]} {className}">
  {#if dot}
    <span
      class="status-dot {dotColors[variant]} {pulse ? 'status-dot-pulse' : ''}"
    ></span>
  {/if}
  {@render children()}
</span>

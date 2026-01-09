<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'outline' | 'destructive';
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
    secondary: 'badge-secondary',
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    info: 'badge-info',
    outline: 'bg-transparent border border-border text-muted-foreground',
    destructive: 'badge-error',
  };

  const dotColors = {
    default: 'bg-text-muted',
    primary: 'bg-primary',
    secondary: 'bg-text-muted',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    info: 'bg-info',
    outline: 'bg-text-muted',
    destructive: 'bg-error',
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

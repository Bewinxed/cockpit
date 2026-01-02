<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { Loader2 } from 'lucide-svelte';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    icon?: Snippet;
    iconRight?: Snippet;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    icon,
    iconRight,
    children,
    class: className = '',
    ...rest
  }: Props = $props();

  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
    success: 'btn-success',
  };

  const sizeClasses = {
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg',
  };
</script>

<button
  class="btn {variantClasses[variant]} {sizeClasses[size]} {className}"
  disabled={disabled || loading}
  {...rest}
>
  {#if loading}
    <Loader2 class="w-4 h-4 animate-spin" />
  {:else if icon}
    <span class="w-4 h-4 flex items-center justify-center">
      {@render icon()}
    </span>
  {/if}

  {@render children()}

  {#if iconRight && !loading}
    <span class="w-4 h-4 flex items-center justify-center">
      {@render iconRight()}
    </span>
  {/if}
</button>

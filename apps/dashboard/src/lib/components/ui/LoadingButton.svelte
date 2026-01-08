<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Loader2 } from 'lucide-svelte';
  import { Button } from './index';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline' | 'destructive';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    disabled?: boolean;
    children: Snippet;
    class?: string;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    loading = false,
    disabled = false,
    children,
    ...rest
  }: Props = $props();
</script>

<Button disabled={disabled || loading} {...rest}>
  {#if loading}
    <Loader2 class="size-4 animate-spin" />
  {/if}
  {@render children()}
</Button>

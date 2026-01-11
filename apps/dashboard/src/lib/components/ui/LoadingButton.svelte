<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Loader2 } from 'lucide-svelte';
  import { Button } from './index';

  interface Props {
    variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';
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

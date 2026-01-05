<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Loader2 } from 'lucide-svelte';
  import { Button, type ButtonProps } from './button';

  interface Props extends ButtonProps {
    loading?: boolean;
    children: Snippet;
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

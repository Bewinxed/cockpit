<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    href,
    child,
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    child?: Snippet<[{ props: HTMLAnchorAttributes }]>;
  } = $props();

  const attrs = $derived({
    "data-slot": "breadcrumb-link",
    class: cn("transition-colors hover:text-foreground", className),
    href,
    ...restProps,
  });
</script>

{#if child}
  {@render child({ props: attrs })}
{:else}
  <!-- biome-ignore lint/a11y/useValidAnchor: href is spread in via attrs (the href prop); static analysis can't see it through the spread -->
  <a bind:this={ref} {...attrs}> {@render children?.()} </a>
{/if}

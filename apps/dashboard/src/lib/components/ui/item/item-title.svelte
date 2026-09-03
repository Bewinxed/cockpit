<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  class={cn("line-clamp-1 flex w-fit items-center gap-2 font-medium text-sm leading-snug underline-offset-4", className)}
  data-slot="item-title"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

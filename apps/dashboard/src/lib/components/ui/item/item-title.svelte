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
  class={cn("gap-2 text-sm leading-snug font-medium underline-offset-4 line-clamp-1 flex w-fit items-center", className)}
  data-slot="item-title"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

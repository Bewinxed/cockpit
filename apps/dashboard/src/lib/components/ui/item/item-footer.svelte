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
  class={cn("flex basis-full items-center justify-between gap-2", className)}
  data-slot="item-footer"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

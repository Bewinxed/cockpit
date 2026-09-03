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
  class={cn("gap-2 flex basis-full items-center justify-between", className)}
  data-slot="item-header"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

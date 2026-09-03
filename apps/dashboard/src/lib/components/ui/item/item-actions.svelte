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
  class={cn("gap-2 flex items-center", className)}
  data-slot="item-actions"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

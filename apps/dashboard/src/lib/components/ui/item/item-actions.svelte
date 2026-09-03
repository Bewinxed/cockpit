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
  class={cn("flex items-center gap-2", className)}
  data-slot="item-actions"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

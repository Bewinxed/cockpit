<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<div
  class={cn("gap-2 p-2 flex flex-col", className)}
  data-sidebar="header"
  data-slot="sidebar-header"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

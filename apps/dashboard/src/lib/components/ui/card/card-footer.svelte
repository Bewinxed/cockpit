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
  class={cn("rounded-b-[var(--radius-card)] px-(--card-spacing) [.border-t]:pt-(--card-spacing) flex items-center", className)}
  data-slot="card-footer"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

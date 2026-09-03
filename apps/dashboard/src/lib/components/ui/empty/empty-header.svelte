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
  class={cn("flex max-w-sm flex-col items-center gap-2", className)}
  data-slot="empty-header"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

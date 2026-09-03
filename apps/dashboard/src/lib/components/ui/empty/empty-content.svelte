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
  class={cn(
		"gap-4 text-sm flex w-full max-w-sm min-w-0 flex-col items-center text-balance",
		className
	)}
  data-slot="empty-content"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

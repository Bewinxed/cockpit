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
		"gap-4 rounded-[var(--radius-panel)] border-dashed p-12 flex w-full min-w-0 flex-1 flex-col items-center justify-center text-center text-balance",
		className
	)}
  data-slot="empty"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

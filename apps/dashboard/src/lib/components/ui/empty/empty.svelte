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
		"flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 text-balance rounded-[var(--radius-panel)] border-dashed p-12 text-center",
		className
	)}
  data-slot="empty"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

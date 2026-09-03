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

<kbd
  class={cn(
		"h-5 w-fit min-w-5 gap-1 rounded-[var(--radius-mark)] bg-muted px-1 font-sans text-xs font-medium text-muted-foreground in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3 pointer-events-none inline-flex items-center justify-center select-none",
		className
	)}
  data-slot="kbd"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</kbd>

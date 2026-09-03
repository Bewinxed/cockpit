<script lang="ts">
  import { ScrollArea as ScrollAreaPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    orientation = "vertical",
    children,
    ...restProps
  }: WithoutChild<ScrollAreaPrimitive.ScrollbarProps> = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
  class={cn(
		"flex touch-none select-none p-px transition-colors data-horizontal:h-2.5 data-vertical:h-full data-vertical:w-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:border-l data-vertical:border-l-transparent",
		className
	)}
  data-orientation={orientation}
  data-slot="scroll-area-scrollbar"
  {orientation}
  bind:ref
  {...restProps}
>
  {@render children?.()}
  <ScrollAreaPrimitive.Thumb
    class="rounded-full relative flex-1 bg-border"
    data-slot="scroll-area-thumb"
  />
</ScrollAreaPrimitive.Scrollbar>

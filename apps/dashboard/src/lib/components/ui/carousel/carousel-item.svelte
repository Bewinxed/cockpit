<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";
  import { getEmblaContext } from "./context.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();

  const emblaCtx = getEmblaContext("<Carousel.Item/>");
</script>

<div
  aria-roledescription="slide"
  class={cn(
		"min-w-0 shrink-0 grow-0 basis-full",
		emblaCtx.orientation === "horizontal" ? "ps-4" : "pt-4",
		className
	)}
  data-embla-slide=""
  data-slot="carousel-item"
  role="group"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>

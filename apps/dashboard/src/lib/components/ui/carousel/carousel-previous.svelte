<script lang="ts">
  import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { WithoutChildren } from "bits-ui";
  import { Button, type Props } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";
  import { getEmblaContext } from "./context.js";

  let {
    ref = $bindable(null),
    class: className,
    variant = "outline",
    size = "icon-sm",
    ...restProps
  }: WithoutChildren<Props> = $props();

  const emblaCtx = getEmblaContext("<Carousel.Previous/>");
</script>

<Button
  aria-disabled={!emblaCtx.canScrollPrev}
  class={cn(
		"absolute touch-manipulation rounded-full",
		emblaCtx.orientation === "horizontal"
			? "inset-y-0 -start-12 my-auto"
			: "start-1/2 -top-12 -translate-x-1/2 rotate-90",
		className
	)}
  data-slot="carousel-previous"
  disabled={!emblaCtx.canScrollPrev}
  onclick={emblaCtx.scrollPrev}
  onkeydown={emblaCtx.handleKeyDown}
  {size}
  {variant}
  {...restProps}
  bind:ref
>
  <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
  <span class="sr-only">Previous slide</span>
</Button>

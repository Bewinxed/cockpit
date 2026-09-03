<script lang="ts">
  import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
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

  const emblaCtx = getEmblaContext("<Carousel.Next/>");
</script>

<Button
  aria-disabled={!emblaCtx.canScrollNext}
  class={cn(
		"absolute touch-manipulation rounded-full",
		emblaCtx.orientation === "horizontal"
			? "inset-y-0 -end-12 my-auto"
			: "start-1/2 -bottom-12 -translate-x-1/2 rotate-90",
		className
	)}
  data-slot="carousel-next"
  disabled={!emblaCtx.canScrollNext}
  onclick={emblaCtx.scrollNext}
  onkeydown={emblaCtx.handleKeyDown}
  {size}
  {variant}
  bind:ref
  {...restProps}
>
  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
  <span class="sr-only">Next slide</span>
</Button>

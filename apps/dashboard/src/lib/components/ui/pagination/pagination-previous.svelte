<script lang="ts">
  import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Pagination as PaginationPrimitive } from "bits-ui";
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: PaginationPrimitive.PrevButtonProps = $props();
</script>

<PaginationPrimitive.PrevButton
  aria-label="Go to previous page"
  class={cn(
		buttonVariants({ variant: "ghost", size: "default" }),
		"pl-2!",
		className
	)}
  bind:ref
  {...restProps}
>
  <HugeiconsIcon
    data-icon="inline-start"
    icon={ArrowLeft01Icon}
    strokeWidth={2}
  />
  <span class="cn-pagination-previous-text hidden sm:block">Previous</span>
</PaginationPrimitive.PrevButton>

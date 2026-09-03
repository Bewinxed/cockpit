<script lang="ts">
  import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Pagination as PaginationPrimitive } from "bits-ui";
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: PaginationPrimitive.NextButtonProps = $props();
</script>

<PaginationPrimitive.NextButton
  aria-label="Go to next page"
  class={cn(buttonVariants({ variant: "ghost", size: "default" }), "pr-2!", className)}
  bind:ref
  {...restProps}
>
  <span class="cn-pagination-next-text hidden sm:block">Next</span>
  <HugeiconsIcon
    data-icon="inline-end"
    icon={ArrowRight01Icon}
    strokeWidth={2}
  />
</PaginationPrimitive.NextButton>

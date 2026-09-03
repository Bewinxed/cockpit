<script lang="ts">
  import { Pagination as PaginationPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    count = 0,
    perPage = 10,
    page = $bindable(1),
    siblingCount = 1,
    ...restProps
  }: PaginationPrimitive.RootProps = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: PaginationPrimitive.Root renders bits-ui's internal <div>, not a real DOM tag we control — role="navigation" is the correct substitute here -->
<PaginationPrimitive.Root
  aria-label="pagination"
  class={cn("cn-pagination mx-auto flex w-full justify-center", className)}
  {count}
  data-slot="pagination"
  {perPage}
  role="navigation"
  {siblingCount}
  bind:page
  bind:ref
  {...restProps}
/>

<script lang="ts">
  import { Pagination as PaginationPrimitive } from "bits-ui";
  import {
    type ButtonSize,
    buttonVariants,
  } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    size = "icon",
    isActive,
    page,
    children,
    ...restProps
  }: PaginationPrimitive.PageProps & {
    size?: ButtonSize;
    isActive: boolean;
  } = $props();
</script>

{#snippet Fallback()}
  {page.value}
{/snippet}

<PaginationPrimitive.Page
  aria-current={isActive ? "page" : undefined}
  class={cn(
		buttonVariants({ size, variant: isActive ? "outline" : "ghost" }),
		"cn-pagination-link",
		className
	)}
  data-active={isActive}
  data-size={size}
  data-slot="pagination-link"
  {page}
  bind:ref
  {...restProps}
>
  {#if children}
    {@render children?.()}
  {:else}
    {@render Fallback()}
  {/if}
</PaginationPrimitive.Page>

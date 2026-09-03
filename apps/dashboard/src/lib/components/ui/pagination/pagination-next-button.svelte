<script lang="ts">
  import { ArrowRightIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Pagination as PaginationPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { buttonVariants } from "../button/index.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: PaginationPrimitive.NextButtonProps = $props();
</script>

{#snippet Fallback()}
  <span>Next</span>
  <HugeiconsIcon
    class={cn("size-4", className)}
    icon={ArrowRightIcon}
    strokeWidth={2}
  />
{/snippet}

<PaginationPrimitive.NextButton
  aria-label="Go to next page"
  class={cn(buttonVariants({ variant: "ghost" }), "pr-2!", className)}
  bind:ref
  {...restProps}
>
  {#if children}
    {@render children?.()}
  {:else}
    {@render Fallback()}
  {/if}
</PaginationPrimitive.NextButton>

<script lang="ts">
  import { ArrowLeftIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Pagination as PaginationPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { buttonVariants } from "../button/index.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: PaginationPrimitive.PrevButtonProps = $props();
</script>

{#snippet Fallback()}
  <HugeiconsIcon
    class={cn("size-4", className)}
    icon={ArrowLeftIcon}
    strokeWidth={2}
  />
  <span>Previous</span>
{/snippet}

<PaginationPrimitive.PrevButton
  aria-label="Go to previous page"
  class={cn(buttonVariants({ variant: "ghost" }), "pl-2!", className)}
  bind:ref
  {...restProps}
>
  {#if children}
    {@render children?.()}
  {:else}
    {@render Fallback()}
  {/if}
</PaginationPrimitive.PrevButton>

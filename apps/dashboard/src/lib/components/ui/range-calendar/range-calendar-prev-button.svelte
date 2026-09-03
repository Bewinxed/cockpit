<script lang="ts">
  import { ArrowLeftIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
  import {
    type ButtonVariant,
    buttonVariants,
  } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    variant = "ghost",
    ...restProps
  }: RangeCalendarPrimitive.PrevButtonProps & {
    variant?: ButtonVariant;
  } = $props();
</script>

{#snippet Fallback()}
  <HugeiconsIcon
    class={cn("size-4", className)}
    icon={ArrowLeftIcon}
    strokeWidth={2}
  />
{/snippet}

<RangeCalendarPrimitive.PrevButton
  class={cn(
		buttonVariants({ variant }),
		"size-(--cell-size) select-none bg-transparent p-0 disabled:opacity-50 rtl:rotate-180",
		className
	)}
  bind:ref
  {...restProps}
>
  {#if children}
    {@render children?.()}
  {:else}
    {@render Fallback()}
  {/if}
</RangeCalendarPrimitive.PrevButton>

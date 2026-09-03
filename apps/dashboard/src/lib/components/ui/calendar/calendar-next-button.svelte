<script lang="ts">
  import { ArrowRightIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Calendar as CalendarPrimitive } from "bits-ui";
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
  }: CalendarPrimitive.NextButtonProps & {
    variant?: ButtonVariant;
  } = $props();
</script>

{#snippet Fallback()}
  <HugeiconsIcon
    class={cn("size-4", className)}
    icon={ArrowRightIcon}
    strokeWidth={2}
  />
{/snippet}

<CalendarPrimitive.NextButton
  class={cn(
		buttonVariants({ variant }),
		"size-(--cell-size) bg-transparent p-0 select-none disabled:opacity-50 rtl:rotate-180",
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
</CalendarPrimitive.NextButton>

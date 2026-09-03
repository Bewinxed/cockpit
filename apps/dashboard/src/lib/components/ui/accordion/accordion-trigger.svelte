<script lang="ts">
  import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    level = 3,
    children,
    ...restProps
  }: WithoutChild<AccordionPrimitive.TriggerProps> & {
    level?: AccordionPrimitive.HeaderProps["level"];
  } = $props();
</script>

<AccordionPrimitive.Header class="flex" {level}>
  <AccordionPrimitive.Trigger
    class={cn(
			"group/accordion-trigger relative flex flex-1 items-start justify-between gap-6 border border-transparent p-4 text-left font-medium text-sm outline-none transition-all hover:underline disabled:pointer-events-none disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
			className
		)}
    data-slot="accordion-trigger"
    bind:ref
    {...restProps}
  >
    {@render children?.()}
    <HugeiconsIcon
      class="cn-accordion-trigger-icon pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
      data-slot="accordion-trigger-icon"
      icon={ArrowDown01Icon}
      strokeWidth={2}
    />
    <HugeiconsIcon
      class="cn-accordion-trigger-icon pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
      data-slot="accordion-trigger-icon"
      icon={ArrowUp01Icon}
      strokeWidth={2}
    />
  </AccordionPrimitive.Trigger>
</AccordionPrimitive.Header>

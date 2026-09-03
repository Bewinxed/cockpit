<script lang="ts">
  import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    children,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.SubTriggerProps> & {
    inset?: boolean;
  } = $props();
</script>

<ContextMenuPrimitive.SubTrigger
  class={cn(
		"flex cursor-default select-none items-center rounded-[var(--radius-card)] px-3 py-2 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-inset:ps-8 data-inset:pl-9.5 data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
  data-inset={inset}
  data-slot="context-menu-sub-trigger"
  bind:ref
  {...restProps}
>
  {@render children?.()}
  <HugeiconsIcon class="ml-auto" icon={ArrowRight01Icon} strokeWidth={2} />
</ContextMenuPrimitive.SubTrigger>

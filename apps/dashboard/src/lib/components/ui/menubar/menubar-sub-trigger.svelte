<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { HugeiconsIcon } from "@hugeicons/svelte"
	import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		inset = undefined,
		children,
		...restProps
	}: WithoutChild<MenubarPrimitive.SubTriggerProps> & {
		inset?: boolean;
	} = $props();
</script>

<MenubarPrimitive.SubTrigger
	bind:ref
	data-slot="menubar-sub-trigger"
	data-inset={inset}
	class={cn(
		"gap-2 rounded-[var(--radius-card)] px-3 py-2 text-sm focus:bg-accent focus:text-accent-foreground data-inset:pl-9.5 data-open:bg-accent data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 flex cursor-default items-center outline-none select-none",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} class="cn-rtl-flip ml-auto size-4" />
</MenubarPrimitive.SubTrigger>

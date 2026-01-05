<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		"bg-paper text-text flex flex-col gap-6 rounded-lg py-6 border border-dotted border-border-dotted",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>

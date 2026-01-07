<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	type PaddingSize = 'none' | 'sm' | 'md' | 'lg' | 'xl';

	type Props = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		padding?: PaddingSize;
	};

	const paddingClasses: Record<PaddingSize, string> = {
		none: 'p-0',
		sm: 'p-3',
		md: 'p-4',
		lg: 'p-6',
		xl: 'p-8',
	};

	let {
		ref = $bindable(null),
		class: className,
		children,
		padding = 'md',
		...restProps
	}: Props = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		"bg-paper text-text flex flex-col gap-6 rounded-lg border border-dotted border-border-dotted",
		paddingClasses[padding],
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>

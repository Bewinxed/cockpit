<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { ChevronDown } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: SelectPrimitive.TriggerProps & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	class={cn(
		'group flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronDown
		size={14}
		class="shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-[state=open]:rotate-180"
	/>
</SelectPrimitive.Trigger>

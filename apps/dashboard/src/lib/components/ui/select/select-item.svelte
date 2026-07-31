<script lang="ts">
	import { IconCheck } from '$lib/icons';
	import { Select as SelectPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children: content,
		...restProps
	}: SelectPrimitive.ItemProps & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Item
	bind:ref
	data-slot="select-item"
	class={cn(
		'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm data-[highlighted]:bg-accent',
		className
	)}
	{...restProps}
>
	{#snippet children({ selected })}
		<!-- The tick keeps its slot when unselected so the rows do not shift. -->
		<span class="flex size-3.5 shrink-0 items-center justify-center">
			{#if selected}
				<IconCheck class="size-3.5" />
			{/if}
		</span>
		{@render content?.()}
	{/snippet}
</SelectPrimitive.Item>

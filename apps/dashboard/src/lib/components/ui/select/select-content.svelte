<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		children,
		...restProps
	}: SelectPrimitive.ContentProps & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Portal>
	<SelectPrimitive.Content
		bind:ref
		data-slot="select-content"
		forceMount={true}
		{sideOffset}
		{...restProps}
	>
		{#snippet child({ props, wrapperProps, open })}
			{#if open}
				<div {...wrapperProps}>
					<div
						{...props}
						class={cn(
							'min-w-[var(--bits-floating-anchor-width)] rounded-md border border-border bg-card p-1 shadow-lg',
							className
						)}
						in:scale={{ start: 0.97, duration: 150, easing: quintOut }}
						out:scale={{ start: 0.97, duration: 120, easing: quintOut }}
					>
						{@render children?.()}
					</div>
				</div>
			{/if}
		{/snippet}
	</SelectPrimitive.Content>
</SelectPrimitive.Portal>

<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: CollapsiblePrimitive.ContentProps & { children?: Snippet } = $props();
</script>

<CollapsiblePrimitive.Content
	bind:ref
	data-slot="collapsible-content"
	forceMount={true}
	{...restProps}
>
	{#snippet child({ props, open })}
		<div
			{...props}
			class="collapsible-content-outer"
			data-state={open ? 'open' : 'closed'}
		>
			<div class="collapsible-content-inner">
				{@render children?.()}
			</div>
		</div>
	{/snippet}
</CollapsiblePrimitive.Content>

<style>
	.collapsible-content-outer {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 150ms ease-out;
		overflow-anchor: none;
	}

	.collapsible-content-outer[data-state='open'] {
		grid-template-rows: 1fr;
	}

	.collapsible-content-inner {
		min-height: 0;
		overflow: hidden;
	}
</style>

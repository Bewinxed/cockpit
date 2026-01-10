<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		open = $bindable(false),
		children,
		...restProps
	}: CollapsiblePrimitive.RootProps & { children?: Snippet } = $props();
</script>

<CollapsiblePrimitive.Root bind:ref bind:open data-slot="collapsible" {...restProps}>
	{@render children?.()}
</CollapsiblePrimitive.Root>

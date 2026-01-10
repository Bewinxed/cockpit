<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: CollapsiblePrimitive.TriggerProps & { children?: Snippet } = $props();
</script>

<CollapsiblePrimitive.Trigger bind:ref data-slot="collapsible-trigger" {...restProps}>
	{@render children?.()}
</CollapsiblePrimitive.Trigger>

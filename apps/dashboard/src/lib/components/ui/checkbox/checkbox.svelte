<script lang="ts">
	import { IconCheck } from '$lib/icons';
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import { scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: CheckboxPrimitive.RootProps = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	bind:checked
	data-slot="checkbox"
	class={cn(
		'flex size-4 shrink-0 items-center justify-center rounded border border-border bg-card transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:ring-2 focus-visible:ring-ring',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked: isChecked })}
		{#if isChecked}
			<span in:scale={{ start: 0.25, duration: 200, easing: quintOut }}>
				<IconCheck class="size-3 text-primary-foreground" />
			</span>
		{/if}
	{/snippet}
</CheckboxPrimitive.Root>

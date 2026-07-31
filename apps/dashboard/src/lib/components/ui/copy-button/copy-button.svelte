<script lang="ts">
	import { IconCheck, IconCopy, IconClose } from '$lib/icons';
	import { Button } from '$lib/components/ui/button';
	import { UseClipboard } from '$lib/hooks/use-clipboard.svelte';
	import { cn } from '$lib/utils.js';
	import type { CopyButtonProps } from './types';

	let {
		ref = $bindable(null),
		text,
		icon,
		animationDuration = 300,
		variant = 'ghost',
		size: sizeProp = 'icon',
		onCopy,
		class: className,
		tabindex = 0,
		children,
		...rest
	}: CopyButtonProps = $props();

	// this way if the user passes text then the button will be the default size
	const size = $derived(sizeProp === 'icon' && children ? 'default' : sizeProp);

	const clipboard = new UseClipboard();

	const label = $derived(
		clipboard.status === 'success'
			? 'Copied'
			: clipboard.status === 'failure'
				? 'Failed to copy'
				: 'Copy'
	);
</script>

<Button
	{...rest}
	bind:ref
	{variant}
	{size}
	{tabindex}
	class={cn('flex items-center gap-2', className)}
	type="button"
	name="copy"
	onclick={async () => {
		const status = await clipboard.copy(text);

		onCopy?.(status);
	}}
>
	<span class="icon-swap" style="--icon-swap-dur: {animationDuration}ms">
		<span data-active={clipboard.status === 'success'}><IconCheck tabindex={-1} /></span>
		<span data-active={clipboard.status === 'failure'}><IconClose tabindex={-1} /></span>
		<span data-active={clipboard.status === undefined}>
			{#if icon}
				{@render icon()}
			{:else}
				<IconCopy tabindex={-1} />
			{/if}
		</span>
	</span>
	<span class="sr-only">{label}</span>
	{@render children?.()}
</Button>

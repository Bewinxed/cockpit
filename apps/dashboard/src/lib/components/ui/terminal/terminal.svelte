<script lang="ts">
	import { Window } from '$lib/components/ui/window';
	import { cn } from '$lib/utils.js';
	import { useTerminalRoot } from './terminal.svelte.js';
	import { onMount } from 'svelte';
	import type { TerminalRootProps } from './types.js';

	let {
		delay = 0,
		speed = 1,
		onComplete = () => {},
		children,
		class: className
	}: TerminalRootProps = $props();

	// Explicit capture to suppress state_referenced_locally warning
	// These are initial values that won't change
	// svelte-ignore state_referenced_locally
	const _delay = delay;
	// svelte-ignore state_referenced_locally
	const _speed = speed;
	// svelte-ignore state_referenced_locally
	const _onComplete = onComplete;

	const terminal = useTerminalRoot({ delay: _delay, speed: _speed, onComplete: _onComplete });

	onMount(() => {
		// we play here so that we don't play before it is visible (on the server)
		terminal.play();

		return () => {
			terminal.dispose();
		};
	});
</script>

<Window class={cn('font-mono text-sm font-light', className)}>
	{@render children?.()}
</Window>

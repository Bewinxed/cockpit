<script lang="ts">
	import { useTerminalLoop } from './terminal.svelte.js';
	import type { TerminalLoopProps } from './types';

	let { delay = 500, children }: TerminalLoopProps = $props();

	let loopIndex = $state(0);
	let loopDelayTimeout = $state<ReturnType<typeof setTimeout>>();

	const onComplete = () => {
		loopDelayTimeout = setTimeout(() => loopIndex++, delay);
	};

	useTerminalLoop({ onComplete });

	$effect(() => {
		return () => clearTimeout(loopDelayTimeout);
	});
</script>

{#key loopIndex}
	{@render children?.()}
{/key}

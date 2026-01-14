<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { useAnimation } from './terminal.svelte.js';
	import type { TerminalAnimationProps } from './types';
	import { typewriter } from '$lib/actions/typewriter.svelte';

	let { children, delay = 0, class: className }: TerminalAnimationProps = $props();

	// svelte-ignore state_referenced_locally
	const _delay = delay;

	let playAnimation = $state(false);
	let animationSpeed = $state(1);

	const play = (speed: number) => {
		playAnimation = true;
		animationSpeed = speed;
	};

	const animation = useAnimation({ delay: _delay, play });

	$effect(() => {
		return () => animation.dispose();
	});
</script>

{#if playAnimation}
	<span
		class={cn('block', className)}
		transition:typewriter={{
			speed: animationSpeed * 2,
			onComplete: () => animation.onComplete?.()
		}}
	>
		{@render children?.()}
	</span>
{/if}

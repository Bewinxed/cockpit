<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Children exist in the DOM only while the panel is open (or closing):
	 *  a transcript can hold hundreds of collapsed panels, and mounting their
	 *  pre blocks and diffs eagerly is what made route renders take seconds. */
	let { open, children }: { open: boolean; children?: Snippet } = $props();

	let rendered = $state(false);

	$effect.pre(() => {
		if (open) rendered = true;
	});

	// Keep content through the closing animation (180ms + slack), then drop it.
	$effect(() => {
		if (!open && rendered) {
			const timer = setTimeout(() => (rendered = false), 220);
			return () => clearTimeout(timer);
		}
	});
</script>

{#if rendered}{@render children?.()}{/if}

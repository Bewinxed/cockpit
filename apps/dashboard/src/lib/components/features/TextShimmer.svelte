<script lang="ts">
	/**
	 * Exact port of beui.dev's TextShimmer (loading-states / text-shimmer):
	 * the text itself is a 200%-wide gradient (muted → foreground → muted at
	 * 30/50/70% along 110deg) clipped to the glyphs, and the background slides
	 * one full period per pass. Linear on purpose — a shimmer is a loop, not
	 * an entrance, so it takes no easing personality.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		/** Seconds for one shimmer pass. beui: 2.5 default, 1.8 for "Thinking…". */
		duration?: number;
		class?: string;
		children: Snippet;
	}

	let { duration = 2.5, class: className = '', children }: Props = $props();
</script>

<span class="shimmer inline-block {className}" style="--shimmer-duration: {duration}s">
	{@render children()}
</span>

<style>
	.shimmer {
		background-image: linear-gradient(
			110deg,
			var(--muted-foreground) 30%,
			var(--foreground) 50%,
			var(--muted-foreground) 70%
		);
		background-size: 200% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: shimmer-pass var(--shimmer-duration, 2.5s) linear infinite;
	}

	@keyframes shimmer-pass {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}

	/* Stillness, not a swap: the static gradient stays readable. */
	@media (prefers-reduced-motion: reduce) {
		.shimmer {
			animation: none;
		}
	}
</style>

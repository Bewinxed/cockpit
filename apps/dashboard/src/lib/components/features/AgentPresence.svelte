<script lang="ts">
	/**
	 * Exact port of beui.dev's AgentProgress (agents / loading-states): a 3×3
	 * pixel grid whose cells breathe in a staggered loop, the verb the session is
	 * on, and how long it has been on it.
	 *
	 * The loop is CSS rather than a tween library: `motion`'s infinite
	 * `[0.28, 1, 0.28]` with a per-segment ease is a two-stop keyframe with the
	 * same curve, so this is the same animation with nothing to schedule.
	 *
	 * Muted, never amber — the Reserved Hue Rule keeps working-amber for
	 * `ActivityDot`, which is where a reader looks for session state.
	 */
	import TextShimmer from './TextShimmer.svelte';
	import { formatElapsed } from '$lib/cockpit/presence';

	/** Where each cell is in the wave, in seconds — beui's GRID_CELLS. */
	const CELL_DELAYS = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.98, 1.12];

	interface Props {
		/**
		 * What the session says it is on. Its absence is what shimmers — and what
		 * it shimmers is "Working", never "Thinking": this line is the one place
		 * with no evidence of what the model is doing, and a live thinking block
		 * renders as its own trace rather than as this.
		 */
		label?: string | null;
		/** When this turn started, epoch ms — so a tab opened mid-turn says the
		 *  true elapsed rather than starting the clock again at zero. */
		startedAt: number;
		class?: string;
	}

	let { label = null, startedAt, class: className = '' }: Props = $props();

	const said = $derived(label ?? 'Working…');

	// A tenth of a second is the smallest thing the format shows, so the clock is
	// read at twice that rate and nothing is computed between reads.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(timer);
	});
</script>

<span
	role="status"
	aria-label="{said}, in progress"
	class="inline-flex items-center gap-3 text-muted-foreground {className}"
>
	<span aria-hidden="true" class="grid size-5 shrink-0 grid-cols-3 gap-[2px]">
		{#each CELL_DELAYS as delay, index (index)}
			<span class="cell rounded-[1px] bg-current" style="animation-delay: {delay}s"></span>
		{/each}
	</span>
	<span class="text-caption font-medium">
		{#if label}
			{label}
		{:else}
			<TextShimmer duration={1.8}>Working…</TextShimmer>
		{/if}
	</span>
	<span aria-hidden="true" class="font-mono text-micro tabular-nums text-faint">
		{formatElapsed((now - startedAt) / 1000)}
	</span>
</span>

<style>
	.cell {
		/* beui's EASE_IN_OUT, per segment — which is how `motion` reads an ease
		   over a three-stop tween, and how CSS reads one between keyframes. */
		animation: presence-breathe 1.55s cubic-bezier(0.77, 0, 0.175, 1) infinite;
	}

	@keyframes presence-breathe {
		0%,
		100% {
			opacity: 0.28;
			transform: scale(0.72);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* Stillness, not removal: the grid keeps its wave and gives up the travel,
	   which is the calm variant the source ships. */
	@media (prefers-reduced-motion: reduce) {
		.cell {
			animation-name: presence-breathe-calm;
		}
	}

	@keyframes presence-breathe-calm {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 0.8;
		}
	}
</style>

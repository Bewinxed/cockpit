<script lang="ts">
	/**
	 * The session reasoning, as it reasons — the tail of a transcript whose
	 * partials have a thinking block open.
	 *
	 * Ported from beui's AgentActivity working state (agent-activity.tsx): the
	 * header carries the state and the trace stays quiet under it, clamped to a
	 * few lines with the top edge faded out, so a minute of reasoning reads as a
	 * live surface rather than as a wall that pushes the conversation off screen.
	 * The clamp is the whole scroll story — the transcript's own follow protocol
	 * keeps the tail pinned, and a second scroller in here would fight it.
	 *
	 * "Thinking" is a measured word here and nowhere else: it is said because a
	 * `content_block_start` said so, and it gives way to "Finishing thought…" on
	 * the SDK's own `signature_delta`.
	 */
	import { onMount } from 'svelte';
	import { quintOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import TextShimmer from './TextShimmer.svelte';

	interface Props {
		/** The reasoning so far. Empty for a redacted block, which streams none. */
		stream: string;
		/** The SDK signed the block: it is wrapping up rather than still going. */
		closing: boolean;
	}

	let { stream, closing }: Props = $props();

	// Don't animate a state label on first paint: a pane switched back to
	// mid-turn arrives with the state it is in, and has no change to announce.
	let painted = $state(false);
	onMount(() => void (painted = true));

	const stillness = new MediaQuery('prefers-reduced-motion: reduce');
	const swap = $derived(stillness.current ? 120 : 180);
	const away = $derived(stillness.current ? 120 : 140);

	/**
	 * beui's Dither loader (loader.tsx), exactly: a 4×4 grid whose cells flicker
	 * in ordered-Bayer threshold order, so the square shimmers like a dissolving
	 * halftone — reasoning's own glyph, deliberately unlike the working grid's
	 * diagonal breathe, in the same 20px box so the two states swap in place.
	 * Delay = (order / 16) · one period.
	 */
	const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<span role="status" class="inline-flex items-center gap-3 text-caption font-medium">
		<span class="dither grid size-5 shrink-0" aria-hidden="true">
			{#each BAYER_4 as order, idx (idx)}
				<span class="cell bg-current" style="--dither-delay: {(order / 16).toFixed(4)}s"></span>
			{/each}
		</span>
		<span class="inline-grid">
			{#key closing}
				<span
					class="col-start-1 row-start-1 whitespace-nowrap"
					in:fly={{ y: 5, duration: painted ? swap : 0, easing: quintOut }}
					out:fly={{ y: -5, duration: painted ? away : 0, easing: quintOut }}
				>
					<TextShimmer duration={1.8}>{closing ? 'Finishing thought…' : 'Thinking…'}</TextShimmer>
				</span>
			{/key}
		</span>
	</span>

	<!-- Quiet, and not read aloud: the header says the state, and a live region
	     reading every token of the reasoning out is the same minute of work
	     announced a hundred times. -->
	{#if stream}
		<div
			aria-hidden="true"
			class="trace max-w-[min(65ch,100%)] min-w-0 text-caption whitespace-pre-wrap text-muted-foreground"
		>
			<div>{stream}</div>
		</div>
	{/if}
</div>

<style>
	/* The last few lines only, growing from the bottom: `justify-content: flex-end`
	   overflows a clamped column at its *top*, which is the end of the trace kept
	   and the beginning of it clipped. The mask fades that cut edge over one line
	   so it reads as text passing out of view rather than as a crop. */
	.trace {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		max-height: calc(6 * 1.4em);
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent, black 1.4em);
		-webkit-mask-image: linear-gradient(to bottom, transparent, black 1.4em);
	}

	/* Source geometry at size 20: gap = max(1, 20·0.05) = 1px,
	   cell = (20 − 3·1px) / 4 = 4.25px. Squares, not dots — the halftone reads
	   through the hard edges. */
	.dither {
		grid-template-columns: repeat(4, 4.25px);
		grid-auto-rows: 4.25px;
		gap: 1px;
	}

	.cell {
		animation: dither-pass 1s cubic-bezier(0.77, 0, 0.175, 1) infinite;
		animation-delay: var(--dither-delay, 0s);
		opacity: 0.1;
	}

	@keyframes dither-pass {
		0%,
		100% {
			opacity: 0.1;
		}
		50% {
			opacity: 1;
		}
	}

	/* The source's own calm variant: the flicker stays, its floor rises. */
	@keyframes dither-calm {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cell {
			animation-name: dither-calm;
			opacity: 0.3;
		}
	}
</style>

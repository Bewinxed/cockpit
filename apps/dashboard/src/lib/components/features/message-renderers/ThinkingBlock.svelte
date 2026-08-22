<script lang="ts">
	/**
	 * A block of reasoning, and what it cost. While this block is the tail of a
	 * transcript that is still working it shimmers "Thinking…" (beui's
	 * ThinkingShimmer, one 1.8s pass); once the turn has moved past it, it says
	 * how long it stood — and says only "Thought" when nothing measured it,
	 * because an invented number is worse than no number.
	 *
	 * The disclosure is beui's AgentDisclosure (tool-result/agent-disclosure.tsx):
	 * height, wipe and fade together, 220ms open / 140ms closed on EASE_OUT.
	 */
	import { onMount } from 'svelte';
	import { quintOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { IconChevronRight, IconThinking } from '$lib/icons';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { cockpit } from '$lib/cockpit/client.svelte';
	import { thinkingDurationMs } from '$lib/cockpit/frames';
	import TextShimmer from '../TextShimmer.svelte';
	import type { MessageRendererProps } from './types';

	let { message, instanceId }: MessageRendererProps = $props();
	let expanded = $state(false);

	// Don't animate a state label on first paint: a restored transcript's blocks
	// arrive settled and have no change to announce.
	let painted = $state(false);
	onMount(() => void (painted = true));

	const thinking = $derived(message.metadata?.thinking || message.content || '');
	const isRedacted = $derived(message.metadata?.isRedactedThinking === true);

	const summary = $derived(
		isRedacted
			? 'Reasoning redacted'
			: thinking.length > 100
				? thinking.slice(0, 100) + '...'
				: thinking
	);

	// Which transcript this block sits in — a subagent's own branch when it has
	// one, the session's main list otherwise — and whether that transcript is
	// working. The renderer props say nothing about where the message landed, and
	// the tail of a working transcript is the only block that can still be
	// thinking.
	const trace = $derived.by(() => {
		const session = cockpit.session(instanceId);
		if (!session) return null;
		const parent = message.parentToolUseId;
		if (!parent) return { messages: session.messages, working: session.busy };
		const branch = session.subagents[parent];
		if (!branch) return null;
		return {
			messages: branch.messages,
			working: branch.status === 'running' || branch.status === 'starting'
		};
	});

	const live = $derived.by(() => {
		if (!trace?.working || !message.id) return false;
		return trace.messages[trace.messages.length - 1]?.id === message.id;
	});

	function measure(): number | null {
		// The client stamped the real span when the block settled — the one
		// measurement that survives "thinking then a tool call in one frame",
		// where adjacency reads two messages born on the same tick.
		const stamped = message.metadata?.thinkingDurationMs;
		if (typeof stamped === 'number') return stamped;
		const messages = trace?.messages;
		if (!messages) return null;
		// Searched from the end: a block still waiting on its successor is the
		// tail, so it finds itself in one step instead of walking the transcript.
		const index = messages.findLastIndex((each) => each.id === message.id);
		return index < 0 ? null : thinkingDurationMs(messages, index);
	}

	// Measured before the first paint, so a restored transcript never swaps its
	// own label, and again until it has an answer — which only the tail is ever
	// without, since a duration cannot change once the message after it exists.
	// `pre`, so the message that ends the wait sets the number in the same beat
	// it clears `live`: the header swaps once, not to "Thought" and then again.
	let durationMs = $state(measure());
	$effect.pre(() => {
		if (durationMs === null) durationMs = measure();
	});

	/** beui's `formatDuration`, keeping the tenth while a tenth still reads. */
	function formatThought(ms: number): string {
		const seconds = ms / 1000;
		if (seconds < 10) return `${seconds.toFixed(1)}s`;
		const whole = Math.round(seconds);
		if (whole < 60) return `${whole}s`;
		const rest = whole % 60;
		const minutes = Math.floor(whole / 60);
		return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
	}

	const elapsed = $derived(!live && durationMs !== null ? formatThought(durationMs) : null);
</script>

<div class="thinking" aria-busy={live}>
	<Collapsible.Root open={expanded} onOpenChange={() => (expanded = !expanded)}>
		<Collapsible.Trigger
			class="flex w-full items-center gap-1.5 text-left text-micro text-muted-foreground
				transition-colors duration-[160ms] ease-[var(--ease-out-expo)] hover:text-foreground"
		>
			<IconChevronRight
				class="size-3 shrink-0 transition-transform duration-[220ms] ease-[var(--ease-out-expo)]
					motion-reduce:duration-[120ms] {expanded ? 'rotate-90' : ''}"
			/>
			<IconThinking class="size-3 shrink-0" />
			<span class="inline-grid">
				{#key live ? 'live' : (elapsed ?? 'settled')}
					<span
						class="col-start-1 row-start-1 whitespace-nowrap"
						in:fly={{ y: 5, duration: painted ? 180 : 0, easing: quintOut }}
						out:fly={{ y: -5, duration: painted ? 140 : 0, easing: quintOut }}
					>
						{#if live}
							<TextShimmer duration={1.8}>Thinking…</TextShimmer>
						{:else if elapsed}
							Thought for <span
								class="font-mono text-micro tabular-nums text-muted-foreground">{elapsed}</span
							>
						{:else}
							Thought
						{/if}
					</span>
				{/key}
			</span>
			{#if !expanded}
				<span class="max-w-[300px] truncate opacity-60">{summary}</span>
			{/if}
		</Collapsible.Trigger>

		<Collapsible.Content class="thinking-content duration-[220ms] ease-[var(--ease-out-expo)]">
			<div
				class="reveal mt-2 ml-[7px] pl-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground
					{isRedacted ? 'italic' : ''} {expanded ? 'reveal-open' : ''}"
				style="background:var(--rail) left top/2px 100% no-repeat"
			>
				{#if isRedacted}
					<span class="text-faint"
						>The reasoning for this response has been redacted.</span
					>
				{:else}
					{thinking}
				{/if}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>

<style>
	/* The reveal itself: opacity, a 4px rise and an inset clip, so the reasoning
	   wipes down from the top edge as the height opens rather than sliding up
	   behind it. beui animates a spring-free `clipPath` + `y` on EASE_OUT
	   ([0.16, 1, 0.3, 1]), which is our --ease-out-expo. */
	.reveal {
		opacity: 0;
		transform: translateY(-4px);
		transform-origin: top;
		clip-path: inset(0 0 100% 0);
		transition:
			opacity 140ms var(--ease-out-expo),
			transform 140ms var(--ease-out-expo),
			clip-path 140ms var(--ease-out-expo);
	}

	.reveal-open {
		opacity: 1;
		transform: none;
		clip-path: inset(0 0 0 0);
		transition-duration: 220ms;
	}

	/* The kit's height keyframes take one duration for both directions, and the
	   utility on the element sets the opening one; closing is set here so the
	   panel still leaves faster than it arrives. */
	.thinking :global(.thinking-content[data-state='closed']) {
		--tw-duration: 140ms;
	}

	@media (prefers-reduced-motion: reduce) {
		.reveal,
		.reveal-open {
			transition-duration: 120ms;
		}

		.thinking :global(.thinking-content) {
			--tw-duration: 120ms;
		}
	}
</style>

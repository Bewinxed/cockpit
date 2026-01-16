<script lang="ts">
	import { instances, type StreamingState, type Message } from '$lib/stores';

	type GridActivity =
		| 'idle'
		| 'thinking'
		| 'streaming'
		| 'tool_use'
		| 'permission'
		| 'error'
		| 'success'
		| 'resuming'
		| 'starting'
		| 'subagent';

	interface Props {
		instanceId?: string;
		size?: 'sm' | 'md' | 'lg';
		/** Override the activity state manually */
		activity?: GridActivity;
		/** Session is being resumed */
		isResuming?: boolean;
		/** Instance is starting up */
		isStarting?: boolean;
		/** Number of active subagents running */
		activeSubagentCount?: number;
	}

	// Use props object to avoid state_referenced_locally warning
	const props: Props = $props();
	const size = $derived(props.size ?? 'md');
	const activity = $derived(props.activity);
	const instanceId = $derived(props.instanceId);
	const isResuming = $derived(props.isResuming ?? false);
	const isStarting = $derived(props.isStarting ?? false);
	const activeSubagentCount = $derived(props.activeSubagentCount ?? 0);

	// Derive current state from store
	const streamingState = $derived(instanceId ? instances.getStreamingState(instanceId) : null);
	const messages = $derived(instanceId ? instances.getMessages(instanceId) : []);
	const instance = $derived(instanceId ? instances.get(instanceId) : null);

	// Get the last message to determine activity type
	const lastMessage = $derived(messages && messages.length > 0 ? messages[messages.length - 1] : null);

	// Compute grid state based on activity
	function computeGridState(
		streaming: StreamingState | null,
		last: Message | null,
		instanceStatus: string | null,
		resuming: boolean,
		starting: boolean,
		subagentCount: number
	): { state: GridActivity; activeDots: number[]; pattern: 'ripple' | 'wave' | 'orbit' | 'pulse' | 'shake' | 'breathe' | 'sequential' | 'branch' } {
		// Error state takes priority
		if (instanceStatus === 'error') {
			return { state: 'error', activeDots: [0, 1, 2, 3, 4, 5, 6, 7, 8], pattern: 'shake' };
		}

		// Resuming state - slower breathing pattern
		if (resuming) {
			return { state: 'resuming', activeDots: [0, 1, 2, 3, 4, 5, 6, 7, 8], pattern: 'breathe' };
		}

		// Starting state - sequential activation
		if (starting || instanceStatus === 'starting') {
			return { state: 'starting', activeDots: [0, 1, 2, 3, 4, 5, 6, 7, 8], pattern: 'sequential' };
		}

		// Initializing state - SDK init received, Claude is about to respond
		if (streaming?.isInitializing) {
			return { state: 'thinking', activeDots: [0, 1, 2, 3, 4, 5, 6, 7, 8], pattern: 'ripple' };
		}

		// Check for tool use in progress
		if (last?.type === 'tool_use' && last?.metadata?.toolStatus === 'pending') {
			return { state: 'tool_use', activeDots: [0, 2, 4, 6, 8], pattern: 'orbit' };
		}

		// Streaming state - actively receiving response
		if (streaming?.isStreaming) {
			return { state: 'streaming', activeDots: [0, 1, 2, 3, 4, 5, 6, 7, 8], pattern: 'ripple' };
		}

		// Subagent activity - show when subagents are running (lower priority than direct streaming)
		if (subagentCount > 0) {
			return { state: 'subagent', activeDots: [0, 2, 4, 6, 8], pattern: 'branch' };
		}

		// Success flash after result
		if (last?.type === 'assistant' && !streaming?.isStreaming) {
			// Brief success state - will transition to idle
			return { state: 'idle', activeDots: [4], pattern: 'pulse' };
		}

		// Default idle - gentle breathing from center
		return { state: 'idle', activeDots: [4], pattern: 'pulse' };
	}

	const gridState = $derived.by(() => {
		const result = activity
			? { state: activity, activeDots: [0, 1, 2, 3, 4, 5, 6, 7, 8], pattern: 'ripple' as const }
			: computeGridState(streamingState, lastMessage, instance?.status || null, isResuming, isStarting, activeSubagentCount);

		console.log(`[ActivityGrid ${new Date().toISOString()}] state=${result.state} instanceStatus=${instance?.status} isResuming=${isResuming} isStarting=${isStarting} isInitializing=${streamingState?.isInitializing} isStreaming=${streamingState?.isStreaming}`);
		return result;
	});

	// Dot configuration for 3x3 grid with distance from center for ripple effect
	// Grid layout:
	// 0 1 2
	// 3 4 5
	// 6 7 8
	const dots = [
		{ index: 0, distance: 1.41 }, // top-left (diagonal)
		{ index: 1, distance: 1 },    // top-center
		{ index: 2, distance: 1.41 }, // top-right (diagonal)
		{ index: 3, distance: 1 },    // middle-left
		{ index: 4, distance: 0 },    // center
		{ index: 5, distance: 1 },    // middle-right
		{ index: 6, distance: 1.41 }, // bottom-left (diagonal)
		{ index: 7, distance: 1 },    // bottom-center
		{ index: 8, distance: 1.41 }, // bottom-right (diagonal)
	];

	// Size classes
	const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
		sm: 'w-[18px] h-[18px] gap-[2px]',
		md: 'w-[24px] h-[24px] gap-[3px]',
		lg: 'w-[32px] h-[32px] gap-[4px]',
	};

	const dotSizeClasses: Record<'sm' | 'md' | 'lg', string> = {
		sm: 'w-[4px] h-[4px]',
		md: 'w-[6px] h-[6px]',
		lg: 'w-[8px] h-[8px]',
	};
</script>

<div
	class="activity-grid grid grid-cols-3 {sizeClasses[size]}"
	data-state={gridState.state}
	data-pattern={gridState.pattern}
>
	{#each dots as dot (dot.index)}
		<span
			class="activity-dot rounded-full transition-all {dotSizeClasses[size]}"
			class:active={gridState.activeDots.includes(dot.index)}
			style="--delay: {dot.distance * 80}ms; --index: {dot.index};"
		></span>
	{/each}
</div>

<style>
	.activity-grid {
		--dot-color: var(--muted-foreground);
	}

	/* State-based colors */
	.activity-grid[data-state='idle'] {
		--dot-color: var(--muted-foreground);
	}
	.activity-grid[data-state='thinking'] {
		--dot-color: var(--primary);
	}
	.activity-grid[data-state='streaming'] {
		--dot-color: var(--chart-2);
	}
	.activity-grid[data-state='tool_use'] {
		--dot-color: var(--chart-4);
	}
	.activity-grid[data-state='permission'] {
		--dot-color: var(--chart-1);
	}
	.activity-grid[data-state='error'] {
		--dot-color: var(--destructive);
	}
	.activity-grid[data-state='success'] {
		--dot-color: var(--chart-2);
	}
	.activity-grid[data-state='resuming'] {
		--dot-color: var(--chart-3);
	}
	.activity-grid[data-state='starting'] {
		--dot-color: var(--primary);
	}
	.activity-grid[data-state='subagent'] {
		--dot-color: var(--chart-5);
	}

	/* Base dot styles */
	.activity-dot {
		background-color: var(--dot-color);
		opacity: 0.2;
		transform: scale(0.8);
	}

	.activity-dot.active {
		opacity: 1;
		transform: scale(1);
	}

	/* Idle - gentle breathing pulse */
	.activity-grid[data-state='idle'] .activity-dot.active {
		animation: activity-breathe 2s ease-in-out infinite;
	}

	/* Streaming - ripple wave from center */
	.activity-grid[data-state='streaming'] .activity-dot {
		animation: activity-ripple 1.2s ease-in-out infinite;
		animation-delay: calc(var(--delay));
	}

	/* Thinking - similar to streaming but different timing */
	.activity-grid[data-state='thinking'] .activity-dot {
		animation: activity-ripple 1s ease-in-out infinite;
		animation-delay: calc(var(--delay));
	}

	/* Tool use - orbital rotation pattern */
	.activity-grid[data-state='tool_use'] .activity-dot.active {
		animation: activity-orbit 0.8s ease-in-out infinite;
		animation-delay: calc(var(--index) * 100ms);
	}

	/* Permission - pulsing ring */
	.activity-grid[data-state='permission'] .activity-dot.active {
		animation: activity-pulse 1s ease-in-out infinite;
		animation-delay: calc(var(--index) * 80ms);
	}

	/* Error - shake briefly then settle (not infinite) */
	.activity-grid[data-state='error'] {
		animation: activity-shake 0.4s ease-in-out 3;
	}
	.activity-grid[data-state='error'] .activity-dot {
		opacity: 1;
		background-color: var(--destructive);
	}

	/* Success - quick flash */
	.activity-grid[data-state='success'] .activity-dot {
		animation: activity-success 0.6s ease-out forwards;
		animation-delay: calc(var(--delay) * 0.5);
	}

	/* Resuming - slow breathing pattern */
	.activity-grid[data-state='resuming'] .activity-dot {
		animation: activity-breathe-slow 2.5s ease-in-out infinite;
		animation-delay: calc(var(--delay) * 0.8);
	}

	/* Starting - sequential wave activation */
	.activity-grid[data-state='starting'] .activity-dot {
		animation: activity-sequential 1.5s ease-in-out infinite;
		animation-delay: calc(var(--index) * 150ms);
	}

	/* Subagent - branching/forking pattern for parallel work */
	.activity-grid[data-state='subagent'] .activity-dot.active {
		animation: activity-branch 1.2s ease-in-out infinite;
		animation-delay: calc(var(--index) * 120ms);
	}

	/* Keyframe animations */
	@keyframes activity-breathe {
		0%,
		100% {
			transform: scale(0.7);
			opacity: 0.4;
		}
		50% {
			transform: scale(1);
			opacity: 0.8;
		}
	}

	@keyframes activity-ripple {
		0% {
			transform: scale(0.5);
			opacity: 0.2;
		}
		50% {
			transform: scale(1.1);
			opacity: 1;
		}
		100% {
			transform: scale(0.7);
			opacity: 0.4;
		}
	}

	@keyframes activity-orbit {
		0% {
			transform: scale(1) translateY(0);
			opacity: 0.8;
		}
		25% {
			transform: scale(1.2) translateY(-1px);
			opacity: 1;
		}
		50% {
			transform: scale(1) translateY(0);
			opacity: 0.8;
		}
		75% {
			transform: scale(0.8) translateY(1px);
			opacity: 0.6;
		}
		100% {
			transform: scale(1) translateY(0);
			opacity: 0.8;
		}
	}

	@keyframes activity-pulse {
		0%,
		100% {
			transform: scale(0.9);
			opacity: 0.5;
		}
		50% {
			transform: scale(1.1);
			opacity: 1;
		}
	}

	@keyframes activity-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-1px);
		}
		40% {
			transform: translateX(1px);
		}
		60% {
			transform: translateX(-1px);
		}
		80% {
			transform: translateX(1px);
		}
	}

	@keyframes activity-success {
		0% {
			transform: scale(0.5);
			opacity: 0.2;
		}
		50% {
			transform: scale(1.3);
			opacity: 1;
		}
		100% {
			transform: scale(1);
			opacity: 0.8;
		}
	}

	@keyframes activity-breathe-slow {
		0%,
		100% {
			transform: scale(0.6);
			opacity: 0.3;
		}
		50% {
			transform: scale(1);
			opacity: 0.7;
		}
	}

	@keyframes activity-sequential {
		0% {
			transform: scale(0.5);
			opacity: 0.2;
		}
		30% {
			transform: scale(1.2);
			opacity: 1;
		}
		60% {
			transform: scale(0.8);
			opacity: 0.6;
		}
		100% {
			transform: scale(0.5);
			opacity: 0.2;
		}
	}

	@keyframes activity-branch {
		0% {
			transform: scale(0.6) translateY(0);
			opacity: 0.4;
		}
		25% {
			transform: scale(1.1) translateY(-1px);
			opacity: 1;
		}
		50% {
			transform: scale(0.9) translateY(0);
			opacity: 0.7;
		}
		75% {
			transform: scale(1.05) translateY(1px);
			opacity: 0.9;
		}
		100% {
			transform: scale(0.6) translateY(0);
			opacity: 0.4;
		}
	}
</style>

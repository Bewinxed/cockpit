<script lang="ts">
	import {
		TriangleAlert,
		DollarSign,
		RotateCcw,
		Settings,
		ChevronRight,
		CircleAlert
	} from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import type { MessageRendererProps } from './types';

	let { message }: MessageRendererProps = $props();
	let showDetails = $state(false);

	const detailsId = $props.id();

	type ErrorSubtype =
		| 'error_max_turns'
		| 'error_during_execution'
		| 'error_max_budget_usd'
		| 'error_max_structured_output_retries';

	const subtype = $derived((message.metadata?.resultSubtype as ErrorSubtype) || 'error_during_execution');
	const errors = $derived((message.metadata?.resultErrors as string[]) || []);
	const totalCost = $derived(message.metadata?.totalCost as number | undefined);
	const numTurns = $derived(message.metadata?.numTurns as number | undefined);

	const errorConfig: Record<ErrorSubtype, {
		icon: typeof TriangleAlert;
		iconColor: string;
		borderColor: string;
		bgColor: string;
		title: string;
		description: string;
		action: string;
	}> = {
		error_max_turns: {
			icon: RotateCcw,
			iconColor: 'text-warning',
			borderColor: 'border-warning/40',
			bgColor: 'bg-warning/5',
			title: 'Turn limit reached',
			description: 'The session reached its maximum number of turns.',
			action: 'Start a new session or increase the turn limit'
		},
		error_max_budget_usd: {
			icon: DollarSign,
			iconColor: 'text-error',
			borderColor: 'border-error/40',
			bgColor: 'bg-error/5',
			title: 'Budget exceeded',
			description: 'The session exceeded its cost budget.',
			action: 'Increase the budget in session settings'
		},
		error_during_execution: {
			icon: TriangleAlert,
			iconColor: 'text-error',
			borderColor: 'border-error/40',
			bgColor: 'bg-error/5',
			title: 'Execution error',
			description: 'An error occurred during tool execution.',
			action: 'Review the error details and try again'
		},
		error_max_structured_output_retries: {
			icon: Settings,
			iconColor: 'text-warning',
			borderColor: 'border-warning/40',
			bgColor: 'bg-warning/5',
			title: 'Output validation failed',
			description: 'Structured output could not be validated after multiple retries.',
			action: 'Check the output schema requirements'
		}
	};

	const config = $derived(errorConfig[subtype] || errorConfig.error_during_execution);
	const Icon = $derived(config.icon);
</script>

<div class="flex justify-start gap-3 group">
	<div class="flex flex-col gap-1 items-start w-full max-w-lg">
		<div
			class="result-error border {config.borderColor} {config.bgColor} rounded-lg p-4 w-full space-y-3"
		>
			<!-- Header with icon and title -->
			<div class="flex items-start gap-3">
				<div
					class="shrink-0 w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center"
				>
					<Icon class="size-4 {config.iconColor}" />
				</div>
				<div class="flex-1 min-w-0">
					<h4 class="font-semibold text-foreground text-sm">{config.title}</h4>
					<p class="text-sm text-muted-foreground mt-0.5">{config.description}</p>
				</div>
			</div>

			<!-- Stats if available -->
			{#if totalCost !== undefined || numTurns !== undefined}
				<div class="flex items-center gap-4 text-xs text-muted-foreground">
					{#if totalCost !== undefined}
						<span class="flex items-center gap-1">
							<DollarSign class="size-3" />
							<span>Cost: ${totalCost.toFixed(4)}</span>
						</span>
					{/if}
					{#if numTurns !== undefined}
						<span class="flex items-center gap-1">
							<RotateCcw class="size-3" />
							<span>Turns: {numTurns}</span>
						</span>
					{/if}
				</div>
			{/if}

			<!-- Action suggestion -->
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<CircleAlert class="size-3 shrink-0" />
				<span>{config.action}</span>
			</div>

			<!-- Error details (expandable) -->
			{#if errors.length > 0}
				<div class="border-t border-border/50 pt-3">
					<button
						type="button"
						class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
						aria-expanded={showDetails}
						aria-controls={detailsId}
						onclick={() => (showDetails = !showDetails)}
					>
						<ChevronRight
							class="size-3 shrink-0 transition-transform duration-200 {showDetails
								? 'rotate-90'
								: ''}"
						/>
						<span class="font-medium">Error details ({errors.length})</span>
					</button>

					{#if showDetails}
						<div
							id={detailsId}
							class="mt-2 space-y-2"
							transition:slide={{ duration: 200 }}
						>
							{#each errors as error, i (i)}
								<div class="text-xs font-mono text-muted-foreground bg-muted/50 rounded px-2 py-1.5 whitespace-pre-wrap">
									{error}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Original content if different from error details -->
			{#if message.content && !errors.includes(message.content)}
				<div class="text-xs text-muted-foreground/80 italic">
					{message.content}
				</div>
			{/if}
		</div>
	</div>
</div>

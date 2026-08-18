<script lang="ts">
	import { IconHelp, IconCheck, IconChecklist, IconChevronDown, IconChevronRight, IconPenLine, IconClose } from '$lib/icons';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import type { UserQuestionResult } from '@cockpit/core';
	import type { MessageRendererProps } from './types';

	let { message }: MessageRendererProps = $props();

	// The one source for how a question ended: the harness-normalised result the
	// folding layer wrote onto the tool message. Absent means the shape nobody
	// produced landed here — rendered as a visible fault below, never as a
	// friendly "Question answered" pill that hides it.
	let result = $derived(message.metadata?.toolUseResult);

	// A question still on screen has no outcome yet, which is not the same as an
	// outcome that went missing: the reader is looking at the card that will
	// produce it.
	let open = $derived(message.metadata?.toolStatus === 'pending');

	let isExpanded = $state(false);

	type Question = UserQuestionResult['questions'][number];

	// Answers are keyed by question text, and a value is `string | string[]`
	// that need not equal any option label — freeform "Other" text lands inside
	// `answers`. Splitting into labels that match an option and text that does
	// not is what lets the read-only card show both.
	let answered = $derived.by(() => {
		if (result?.outcome !== 'answered') return [];
		return result.questions.map((question) => {
			const raw = result.answers[question.question];
			const values: string[] = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
			const labels = question.options.map((option) => option.label);
			return {
				question,
				selected: values.filter((value) => labels.includes(value)),
				freeform: values.filter((value) => !labels.includes(value)),
			};
		});
	});

	// One pill per question for the collapsed summary.
	let summary = $derived(
		answered.map(({ question, selected, freeform }) => ({
			header: question.header,
			answer: selected.length > 0 ? selected.join(', ') : freeform.join(' '),
		}))
	);
</script>

{#snippet questionBlock(question: Question, selected: string[], freeform: string[])}
	<div>
		<div class="flex items-start gap-3 mb-2">
			<div
				class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"
			>
				{#if question.multiSelect}
					<IconChecklist class="w-4 h-4" />
				{:else}
					<IconHelp class="w-4 h-4" />
				{/if}
			</div>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2 mb-1">
					<span
						class="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wider"
					>
						{question.header}
					</span>
					{#if question.multiSelect}
						<span class="text-xs text-muted-foreground">Select multiple</span>
					{/if}
				</div>
				<p class="text-sm text-foreground font-medium leading-snug">
					{question.question}
				</p>
			</div>
		</div>

		<div class="space-y-2 ml-11">
			{#each question.options as option (option.label)}
				{@const chosen = selected.includes(option.label)}
				<div
					class="w-full text-left px-3 py-2.5 rounded-lg transition-[background-color,border-color] duration-150 ease-out flex items-start gap-3 border
						{chosen
						? 'bg-primary/10 text-primary border-primary/40'
						: 'bg-background/50 border-transparent'}"
				>
					<div
						class="shrink-0 w-5 h-5 mt-0.5 rounded-{question.multiSelect
							? 'sm'
							: 'full'} border-2 flex items-center justify-center
						{chosen
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-muted-foreground/30'}"
					>
						{#if chosen}
							<IconCheck class="w-3 h-3 text-primary-foreground" />
						{/if}
					</div>
					<div class="flex-1 min-w-0">
						<span class="font-medium text-sm text-foreground">{option.label}</span>
						{#if option.description}
							<p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
								{option.description}
							</p>
						{/if}
					</div>
				</div>
			{/each}

			{#if freeform.length > 0}
				<div
					class="flex items-start gap-3 px-3 py-2.5 rounded-lg border bg-primary/10 text-primary border-primary/40"
				>
					<div
						class="shrink-0 w-5 h-5 mt-0.5 rounded-{question.multiSelect
							? 'sm'
							: 'full'} border-2 border-primary bg-primary flex items-center justify-center"
					>
						<IconCheck class="w-3 h-3 text-primary-foreground" />
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-1">
							<IconPenLine class="w-3.5 h-3.5 text-muted-foreground" />
							<span class="text-xs text-muted-foreground">Custom answer</span>
						</div>
						<div class="text-sm text-foreground">{freeform.join(' ')}</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex justify-start gap-3 group w-full">
	<div class="flex flex-col gap-1 items-start w-full max-w-lg">
		{#if result?.outcome === 'answered'}
			<div class="w-full">
				<Collapsible.Root open={isExpanded} onOpenChange={() => (isExpanded = !isExpanded)}>
					<!-- Compact summary (clickable to expand) -->
					<div class="flex items-center gap-2 w-full">
						<Collapsible.Trigger class="flex items-center gap-2 flex-1 text-left">
							<div class="flex items-center gap-1 text-muted-foreground">
								{#if isExpanded}
									<IconChevronDown class="w-4 h-4" />
								{:else}
									<IconChevronRight class="w-4 h-4" />
								{/if}
							</div>
							<div class="flex flex-wrap gap-2 flex-1">
								{#each summary as row, idx (idx)}
									<div
										class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 text-foreground border border-border/50 rounded-full text-sm"
									>
										<span class="text-xs font-semibold text-primary uppercase">{row.header}</span>
										<span class="text-muted-foreground">→</span>
										<span class="text-foreground font-medium truncate max-w-[200px]">{row.answer || '—'}</span>
									</div>
								{/each}
							</div>
						</Collapsible.Trigger>
					</div>

					<!-- Expanded view: the questions, options, and the reader's choices -->
					<Collapsible.Content>
						<div class="mt-3 border border-border/50 rounded-xl bg-card/30 overflow-hidden">
							<div class="p-3 opacity-75 space-y-4">
								{#each answered as { question, selected, freeform } (question.question)}
									{@render questionBlock(question, selected, freeform)}
								{/each}
							</div>
						</div>
					</Collapsible.Content>
				</Collapsible.Root>
			</div>
		{:else if result?.outcome === 'dismissed'}
			<!-- Nothing went wrong here: the reader was asked and walked away, and
			     the transcript should say so plainly. Naming the headers keeps the
			     row worth reading without pretending an answer exists. -->
			<div
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-muted/50 text-muted-foreground border border-border/50 rounded-full text-sm"
			>
				<IconClose class="w-3.5 h-3.5" />
				<span>Dismissed without answering — {result.questions.map((q) => q.header).join(', ')}</span>
			</div>
		{:else if open}
			<!-- The question is live; its outcome is being decided on the permission
			     card right now. Saying "missing" here would cry fault at the one
			     moment the data is legitimately not written yet. -->
			<div
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 text-muted-foreground border border-border/50 rounded-full text-sm"
			>
				<IconHelp class="w-3.5 h-3.5" />
				<span>Waiting for your answer</span>
			</div>
		{:else}
			<!-- Deliberately not graceful: a message the renderer was asked to draw
			     but whose canonical data never arrived is a shape nobody handled,
			     so it is made loud for a developer to find and file rather than
			     reduced to a "Question answered" pill. -->
			<div
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-destructive/10 text-destructive border border-destructive/40 rounded-full text-sm"
			>
				<IconClose class="w-3.5 h-3.5" />
				<span>AskUserQuestion result missing (no `toolUseResult` on this message)</span>
			</div>
		{/if}
	</div>
</div>

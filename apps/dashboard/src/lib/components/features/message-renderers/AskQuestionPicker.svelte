<script lang="ts">
	import { CircleHelp, Check, ListChecks, Send, X, PenLine, ChevronDown, ChevronRight } from 'lucide-svelte';
	import type { MessageRendererProps } from './types';
	import type { Question } from '@cockpit/core/dashboard';

	let {
		message,
		isActive = false,
		onQuestionSubmit,
		onQuestionCancel,
		onDismissMessage
	}: MessageRendererProps = $props();

	// Extract questions from message metadata
	let questions = $derived<Question[]>((message.metadata?.questions as Question[]) || []);
	let requestId = $derived<string>((message.metadata?.questionRequestId as string) || '');

	// Selection state: Map<questionIndex, selectedLabels[]>
	let selections = $state<Map<number, string[]>>(new Map());
	// "Other" text inputs: Map<questionIndex, text>
	let otherTexts = $state<Map<number, string>>(new Map());
	// Whether "Other" is selected for each question
	let otherSelected = $state<Map<number, boolean>>(new Map());

	let isSubmitting = $state(false);
	let submitError = $state<string | null>(null);

	// Current tab index for multi-question display
	let activeTab = $state(0);

	// Expandable state for answered questions
	let isExpanded = $state(false);

	// Initialize selections when questions change
	$effect(() => {
		if (isActive && questions.length > 0 && selections.size === 0) {
			const newSelections = new Map<number, string[]>();
			questions.forEach((_, idx) => newSelections.set(idx, []));
			selections = newSelections;
		}
	});

	// Check if a specific question has been answered
	function isQuestionAnswered(qIdx: number): boolean {
		const hasSelection = (selections.get(qIdx)?.length || 0) > 0;
		const hasOther = otherSelected.get(qIdx) && (otherTexts.get(qIdx)?.trim().length || 0) > 0;
		return hasSelection || hasOther;
	}

	function toggleOption(questionIdx: number, label: string) {
		const question = questions[questionIdx];
		if (!question) return;

		const current = selections.get(questionIdx) || [];

		if (question.multiSelect) {
			// Toggle in array
			if (current.includes(label)) {
				selections.set(questionIdx, current.filter((l) => l !== label));
			} else {
				selections.set(questionIdx, [...current, label]);
			}
			// Deselect "Other" if selecting a regular option
			otherSelected.set(questionIdx, false);
		} else {
			// Single select - replace
			selections.set(questionIdx, [label]);
			otherSelected.set(questionIdx, false);
		}
		// Force reactivity
		selections = new Map(selections);
		otherSelected = new Map(otherSelected);
	}

	function selectOther(questionIdx: number) {
		const question = questions[questionIdx];
		if (!question) return;

		if (!question.multiSelect) {
			// Single select - clear regular selections
			selections.set(questionIdx, []);
		}
		otherSelected.set(questionIdx, true);
		otherSelected = new Map(otherSelected);
		selections = new Map(selections);
	}

	function isOptionSelected(questionIdx: number, label: string): boolean {
		return selections.get(questionIdx)?.includes(label) || false;
	}

	function getAnswerForQuestion(questionIdx: number): string {
		if (otherSelected.get(questionIdx)) {
			return otherTexts.get(questionIdx) || '';
		}
		return selections.get(questionIdx)?.join(', ') || '';
	}

	function canSubmit(): boolean {
		return questions.every((_, idx) => {
			const hasSelection = (selections.get(idx)?.length || 0) > 0;
			const hasOther = otherSelected.get(idx) && (otherTexts.get(idx)?.trim().length || 0) > 0;
			return hasSelection || hasOther;
		});
	}

	async function handleSubmit() {
		if (!canSubmit() || !onQuestionSubmit) return;

		isSubmitting = true;
		submitError = null;

		try {
			// Build answers object: { "0": "answer", "1": "answer", ... }
			const answers: Record<string, string> = {};
			questions.forEach((_, idx) => {
				answers[String(idx)] = getAnswerForQuestion(idx);
			});

			await onQuestionSubmit(requestId, answers);
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Failed to submit answer';
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isActive || isSubmitting) return;

		// Don't capture shortcuts when typing in an input
		const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

		// Tab to switch between question tabs (when multiple questions and not typing)
		if (e.key === 'Tab' && questions.length > 1 && !isTyping) {
			e.preventDefault();
			if (e.shiftKey) {
				// Previous tab
				activeTab = activeTab === 0 ? questions.length - 1 : activeTab - 1;
			} else {
				// Next tab
				activeTab = (activeTab + 1) % questions.length;
			}
			return;
		}

		// Let Tab work normally when typing or single question
		if (e.key === 'Tab') return;

		// Number keys 1-4 for quick selection (when not typing)
		if (!isTyping && e.key >= '1' && e.key <= '4') {
			e.preventDefault();
			const optionIdx = parseInt(e.key) - 1;
			const currentQ = questions.length > 1 ? activeTab : 0;
			const question = questions[currentQ];
			if (question && optionIdx < question.options.length) {
				toggleOption(currentQ, question.options[optionIdx].label);
			}
			return;
		}

		// 'O' for Other (when not typing)
		if (!isTyping && (e.key === 'o' || e.key === 'O')) {
			e.preventDefault();
			const currentQ = questions.length > 1 ? activeTab : 0;
			selectOther(currentQ);
			return;
		}

		// Left/Right arrow keys to switch tabs (when multiple questions and not typing)
		if (!isTyping && questions.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			e.preventDefault();
			if (e.key === 'ArrowLeft') {
				activeTab = activeTab === 0 ? questions.length - 1 : activeTab - 1;
			} else {
				activeTab = (activeTab + 1) % questions.length;
			}
			return;
		}

		// Enter to submit (works everywhere except in textarea)
		if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement) && canSubmit()) {
			e.preventDefault();
			handleSubmit();
			return;
		}

		// Escape to cancel
		if (e.key === 'Escape') {
			e.preventDefault();
			onQuestionCancel?.();
		}
	}

	// Get display info for answered questions (inactive state)
	let answeredSummary = $derived(() => {
		if (!message.metadata?.questionAnswers) return null;
		const answers = message.metadata.questionAnswers as Record<string, string>;
		return questions.map((q, idx) => ({
			header: q.header,
			answer: answers[String(idx)] || 'No answer'
		}));
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Single question content (reusable snippet) -->
{#snippet questionContent(question: Question, qIdx: number, showShortcuts: boolean)}
	<!-- Question header -->
	<div class="flex items-start gap-3 mb-3">
		<div
			class="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0"
		>
			{#if question.multiSelect}
				<ListChecks class="w-4 h-4 text-secondary" />
			{:else}
				<CircleHelp class="w-4 h-4 text-secondary" />
			{/if}
		</div>
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 mb-1">
				<span
					class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary/20 text-secondary uppercase tracking-wider"
				>
					{question.header}
				</span>
				{#if question.multiSelect}
					<span class="text-[10px] text-muted-foreground">Select multiple</span>
				{/if}
			</div>
			<p class="text-sm text-foreground font-medium leading-snug">
				{question.question}
			</p>
		</div>
	</div>

	<!-- Options grid -->
	<div class="space-y-2 ml-11">
		{#each question.options as option, optIdx (option.label)}
			<button
				type="button"
				class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-start gap-3 border
					{isOptionSelected(qIdx, option.label)
					? 'bg-secondary/10 border-secondary/40 shadow-sm'
					: 'bg-background/50 border-transparent hover:border-border hover:bg-accent/50'}"
				onclick={() => toggleOption(qIdx, option.label)}
			>
				<!-- Selection indicator -->
				<div
					class="shrink-0 w-5 h-5 mt-0.5 rounded-{question.multiSelect
						? 'sm'
						: 'full'} border-2 flex items-center justify-center transition-colors
					{isOptionSelected(qIdx, option.label)
						? 'border-secondary bg-secondary'
						: 'border-muted-foreground/30'}"
				>
					{#if isOptionSelected(qIdx, option.label)}
						<Check class="w-3 h-3 text-secondary-foreground" />
					{/if}
				</div>

				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<span class="font-medium text-sm text-foreground">{option.label}</span>
						{#if showShortcuts && optIdx < 4}
							<kbd
								class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
								>{optIdx + 1}</kbd
							>
						{/if}
					</div>
					{#if option.description}
						<p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
							{option.description}
						</p>
					{/if}
				</div>
			</button>
		{/each}

		<!-- Other option -->
		<div
			class="w-full text-left px-3 py-2.5 rounded-lg transition-all border
			{otherSelected.get(qIdx)
				? 'bg-secondary/10 border-secondary/40'
				: 'bg-background/50 border-transparent hover:border-border hover:bg-accent/50'}"
		>
			{#if otherSelected.get(qIdx)}
				<div class="flex items-start gap-3">
					<div
						class="shrink-0 w-5 h-5 mt-0.5 rounded-{question.multiSelect
							? 'sm'
							: 'full'} border-2 border-secondary bg-secondary flex items-center justify-center"
					>
						<Check class="w-3 h-3 text-secondary-foreground" />
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-2">
							<PenLine class="w-3.5 h-3.5 text-muted-foreground" />
							<span class="text-xs text-muted-foreground">Custom answer</span>
							<button
								type="button"
								class="ml-auto p-0.5 rounded hover:bg-accent"
								onclick={() => {
									otherSelected.set(qIdx, false);
									otherSelected = new Map(otherSelected);
								}}
							>
								<X class="w-3.5 h-3.5 text-muted-foreground" />
							</button>
						</div>
						<input
							type="text"
							class="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md
								focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary"
							placeholder="Type your answer..."
							value={otherTexts.get(qIdx) || ''}
							oninput={(e) => {
								otherTexts.set(qIdx, e.currentTarget.value);
								otherTexts = new Map(otherTexts);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' && canSubmit()) {
									e.preventDefault();
									handleSubmit();
								}
							}}
						/>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="flex items-center gap-3 w-full"
					onclick={() => selectOther(qIdx)}
				>
					<div
						class="shrink-0 w-5 h-5 rounded-{question.multiSelect
							? 'sm'
							: 'full'} border-2 border-dashed border-muted-foreground/30"
					></div>
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground">Other...</span>
						{#if showShortcuts}
							<kbd
								class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
								>O</kbd
							>
						{/if}
					</div>
				</button>
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex justify-start gap-3 group w-full">
	<div class="flex flex-col gap-1 items-start w-full max-w-lg">
		{#if isActive}
			<!-- Active: Show question picker form -->
			<div class="w-full">
				<div class="border border-border rounded-xl bg-card/50 backdrop-blur-sm overflow-hidden">
					{#if questions.length > 1}
						<!-- Multi-question: Tab navigation -->
						<div class="flex border-b border-border/50 bg-muted/20">
							{#each questions as question, qIdx (qIdx)}
								<button
									type="button"
									class="flex-1 px-3 py-2.5 text-sm font-medium transition-all relative
										{activeTab === qIdx
											? 'text-secondary bg-card/50'
											: 'text-muted-foreground hover:text-foreground hover:bg-accent/30'}"
									onclick={() => activeTab = qIdx}
								>
									<div class="flex items-center justify-center gap-2">
										<span class="truncate max-w-[100px]">{question.header}</span>
										{#if isQuestionAnswered(qIdx)}
											<Check class="w-3.5 h-3.5 text-green-500 shrink-0" />
										{/if}
									</div>
									{#if activeTab === qIdx}
										<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-secondary"></div>
									{/if}
								</button>
							{/each}
						</div>

						<!-- Tab content -->
						<div class="p-4">
							{@render questionContent(questions[activeTab], activeTab, true)}
						</div>
					{:else}
						<!-- Single question: Simple view -->
						<div class="p-4">
							{@render questionContent(questions[0], 0, true)}
						</div>
					{/if}

					<!-- Error -->
					{#if submitError}
						<div
							class="mx-4 mb-3 flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
						>
							<X class="w-4 h-4 shrink-0" />
							<span>{submitError}</span>
						</div>
					{/if}

					<!-- Actions footer -->
					<div
						class="flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 border-t border-border/50"
					>
						<p class="text-[10px] text-muted-foreground">
							{#if questions.length > 1}
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">Tab</kbd> switch •
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">1-4</kbd> select •
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">Enter</kbd> submit
							{:else}
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">1-4</kbd> select •
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">O</kbd> other •
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">Enter</kbd> submit
							{/if}
						</p>

						<div class="flex items-center gap-2">
							<button
								onclick={onQuestionCancel}
								disabled={isSubmitting}
								class="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								Skip
							</button>
							<button
								onclick={handleSubmit}
								disabled={!canSubmit() || isSubmitting}
								class="flex items-center gap-1.5 px-4 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm font-medium
									hover:bg-secondary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
							>
								{#if isSubmitting}
									<div
										class="w-3.5 h-3.5 border-2 border-secondary-foreground/30 border-t-secondary-foreground rounded-full animate-spin"
									></div>
									<span>Sending...</span>
								{:else}
									<Send class="w-3.5 h-3.5" />
									<span>Submit</span>
								{/if}
							</button>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<!-- Inactive: Expandable answered state -->
			<div class="w-full">
				{#if answeredSummary()}
					<!-- Compact summary (clickable to expand) -->
					<button
						type="button"
						class="flex items-center gap-2 w-full text-left"
						onclick={() => isExpanded = !isExpanded}
					>
						<div class="flex items-center gap-1 text-muted-foreground">
							{#if isExpanded}
								<ChevronDown class="w-4 h-4" />
							{:else}
								<ChevronRight class="w-4 h-4" />
							{/if}
						</div>
						<div class="flex flex-wrap gap-2 flex-1">
							{#each answeredSummary() || [] as { header, answer }}
								<div
									class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-border/50 rounded-full text-sm"
								>
									<span class="text-[10px] font-semibold text-secondary uppercase">{header}</span>
									<span class="text-muted-foreground">→</span>
									<span class="text-foreground font-medium truncate max-w-[200px]">{answer}</span>
								</div>
							{/each}
						</div>
						{#if onDismissMessage}
							<button
								onclick={(e) => { e.stopPropagation(); onDismissMessage?.(); }}
								class="p-1 rounded-full hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
								title="Dismiss"
							>
								<X class="w-3.5 h-3.5 text-muted-foreground" />
							</button>
						{/if}
					</button>

					<!-- Expanded view: Show full question UI (read-only) -->
					{#if isExpanded}
						<div class="mt-3 border border-border/50 rounded-xl bg-card/30 overflow-hidden">
							{#if questions.length > 1}
								<!-- Multi-question: Tab navigation (read-only) -->
								<div class="flex border-b border-border/50 bg-muted/10">
									{#each questions as question, qIdx (qIdx)}
										<button
											type="button"
											class="flex-1 px-3 py-2 text-xs font-medium transition-all relative
												{activeTab === qIdx
													? 'text-secondary bg-card/50'
													: 'text-muted-foreground hover:text-foreground'}"
											onclick={() => activeTab = qIdx}
										>
											<div class="flex items-center justify-center gap-1.5">
												<span class="truncate max-w-[80px]">{question.header}</span>
												<Check class="w-3 h-3 text-green-500 shrink-0" />
											</div>
											{#if activeTab === qIdx}
												<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-secondary/50"></div>
											{/if}
										</button>
									{/each}
								</div>
								<div class="p-3 opacity-75">
									{@render questionContent(questions[activeTab], activeTab, false)}
								</div>
							{:else}
								<div class="p-3 opacity-75">
									{@render questionContent(questions[0], 0, false)}
								</div>
							{/if}
						</div>
					{/if}
				{:else}
					<div class="flex items-center gap-2">
						<div
							class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-border/50 rounded-full text-sm"
						>
							<CircleHelp class="w-3.5 h-3.5 text-muted-foreground" />
							<span class="text-muted-foreground">Question answered</span>
						</div>
						{#if onDismissMessage}
							<button
								onclick={onDismissMessage}
								class="p-1 rounded-full hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
								title="Dismiss"
							>
								<X class="w-3.5 h-3.5 text-muted-foreground" />
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

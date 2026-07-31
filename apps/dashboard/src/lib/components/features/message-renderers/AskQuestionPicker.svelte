<script lang="ts">
	import { CircleHelp, Check, ListChecks, Send, X, PenLine, ChevronDown, ChevronRight } from '@lucide/svelte';
	import type { MessageMetadata } from '$lib/cockpit/types';
	import type { MessageRendererProps } from './types';

	type Question = NonNullable<MessageMetadata['questions']>[number];

	let {
		message,
		isActive = false,
		onQuestionSubmit,
		onQuestionCancel,
		onDismissMessage
	}: MessageRendererProps = $props();

	// Extract questions from message metadata
	// Supports both system messages (live) and tool.use/tool.result messages (from DB)
	let questions = $derived.by<Question[]>(() => {
		let rawQuestions: unknown[] = [];

		// System message format (live conversation)
		if (message.metadata?.questions && Array.isArray(message.metadata.questions)) {
			rawQuestions = message.metadata.questions;
		}
		// Tool use/result format (from DB after refresh)
		else {
			const toolInput = message.metadata?.toolInput as { questions?: unknown[] } | undefined;
			if (toolInput?.questions && Array.isArray(toolInput.questions)) {
				rawQuestions = toolInput.questions;
			}
		}

		// Normalize and filter valid questions
		return rawQuestions
			.filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
			.map(q => ({
				question: String(q.question || ''),
				header: String(q.header || 'Question'),
				options: Array.isArray(q.options)
					? q.options.filter((o): o is { label: string; description: string } =>
							o != null && typeof o === 'object' && 'label' in o
						).map(o => ({
							label: String(o.label || ''),
							description: String(o.description || ''),
						}))
					: [],
				multiSelect: Boolean(q.multiSelect),
			}));
	});

	let requestId = $derived.by<string>(() => {
		// System message format
		if (message.metadata?.questionRequestId) {
			return message.metadata.questionRequestId as string;
		}
		// Tool use format - use toolId or sdkUuid
		return (message.metadata?.toolId as string) || message.sdkUuid || '';
	});

	// For tool messages, extract the answers that were provided
	// Note: DB-loaded messages are type 'tool.use' but have toolResult in metadata
	let storedAnswers = $derived.by((): Record<string, string> | null => {
		// System message format (answers stored after submission in-memory)
		const questionAnswers = message.metadata?.questionAnswers;
		if (questionAnswers && typeof questionAnswers === 'object' && !Array.isArray(questionAnswers)) {
			return questionAnswers;
		}
		// PRIMARY: Check toolInput.answers (persisted to DB when question is answered)
		// This is the most robust source - answers are stored directly in toolInput
		const toolInput = message.metadata?.toolInput as { answers?: Record<string, string> } | undefined;
		if (toolInput?.answers && typeof toolInput.answers === 'object') {
			const keys = Object.keys(toolInput.answers);
			if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
				return toolInput.answers;
			}
		}
		// FALLBACK: Tool use/result format - check for toolResult in metadata
		// The SDK returns a human-readable string, parse it as last resort
		if (message.metadata?.toolResult) {
			const result = message.metadata.toolResult;
			// Skip if it's a string (SDK's human-readable format)
			if (typeof result === 'string') {
				// Try to parse answers from the string format: "0"="answer"
				// Note: This is fragile - if SDK format changes, this will break
				const parsed: Record<string, string> = {};
				const regex = /"(\d+)"="([^"]*)"/g;
				let match;
				while ((match = regex.exec(result)) !== null) {
					parsed[match[1]] = match[2];
				}
				if (Object.keys(parsed).length > 0) {
					return parsed;
				}
				return null;
			}
			// If it's an object, try to extract answers
			if (typeof result === 'object' && result !== null) {
				const obj = result as Record<string, unknown>;
				// Could be { answers: {...} } or directly {...}
				const answers = obj.answers;
				if (answers && typeof answers === 'object') {
					return answers as Record<string, string>;
				}
				// If it's a record with numeric keys, it's the answers directly
				const keys = Object.keys(obj);
				if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
					return obj as Record<string, string>;
				}
			}
		}
		return null;
	});

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
	const answeredId = $props.id();

	// Initialize selections when questions change (for active state)
	$effect(() => {
		if (isActive && questions.length > 0 && selections.size === 0) {
			const newSelections = new Map<number, string[]>();
			questions.forEach((_, idx) => newSelections.set(idx, []));
			selections = newSelections;
		}
	});

	// Initialize selections from storedAnswers for expanded view (answered questions)
	$effect(() => {
		if (!isActive && storedAnswers && questions.length > 0 && selections.size === 0) {
			const newSelections = new Map<number, string[]>();
			const newOtherTexts = new Map<number, string>();
			const newOtherSelected = new Map<number, boolean>();

			questions.forEach((question, idx) => {
				const answer = storedAnswers[String(idx)];
				if (!answer) {
					newSelections.set(idx, []);
					return;
				}

				// Check if answer matches any option label
				const matchingOption = question.options.find(opt => opt.label === answer);
				if (matchingOption) {
					newSelections.set(idx, [matchingOption.label]);
				} else if (question.multiSelect) {
					// For multiselect, try to match comma-separated values
					const parts = answer.split(', ').map(s => s.trim());
					const matched = parts.filter(p => question.options.some(opt => opt.label === p));
					if (matched.length > 0) {
						newSelections.set(idx, matched);
					} else {
						// Custom answer
						newSelections.set(idx, []);
						newOtherTexts.set(idx, answer);
						newOtherSelected.set(idx, true);
					}
				} else {
					// Custom "Other" answer
					newSelections.set(idx, []);
					newOtherTexts.set(idx, answer);
					newOtherSelected.set(idx, true);
				}
			});

			selections = newSelections;
			otherTexts = newOtherTexts;
			otherSelected = newOtherSelected;
		}
	});

	// Check if a specific question has been answered
	function isQuestionAnswered(qIdx: number): boolean {
		const hasSelection = (selections.get(qIdx)?.length || 0) > 0;
		const hasOther = !!otherSelected.get(qIdx) && (otherTexts.get(qIdx)?.trim().length || 0) > 0;
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

		// Enter to submit (inputs and textareas handle their own Enter)
		if (e.key === 'Enter' && !e.shiftKey && !isTyping && canSubmit()) {
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
	// Uses storedAnswers which handles both system message and tool.result formats
	let answeredSummary = $derived.by(() => {
		const answers = storedAnswers;
		if (!answers) return null;
		return questions.map((q, idx) => ({
			header: q.header,
			answer: answers[String(idx)] || 'No answer'
		}));
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Option row content (shared by the interactive and read-only variants) -->
{#snippet optionBody(
	question: Question,
	qIdx: number,
	option: Question['options'][number],
	optIdx: number,
	showShortcuts: boolean
)}
	<!-- Selection indicator -->
	<div
		class="shrink-0 w-5 h-5 mt-0.5 rounded-{question.multiSelect
			? 'sm'
			: 'full'} border-2 flex items-center justify-center transition-colors
		{isOptionSelected(qIdx, option.label)
			? 'border-primary bg-primary'
			: 'border-muted-foreground/30'}"
	>
		{#if isOptionSelected(qIdx, option.label)}
			<Check class="w-3 h-3 text-primary-foreground" />
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
{/snippet}

<!-- Single question content (reusable snippet) -->
{#snippet questionContent(question: Question, qIdx: number, showShortcuts: boolean, readOnly: boolean = false)}
	<!-- Question header -->
	<div class="flex items-start gap-3 mb-3">
		<div
			class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"
		>
			{#if question.multiSelect}
				<ListChecks class="w-4 h-4 text-primary" />
			{:else}
				<CircleHelp class="w-4 h-4 text-primary" />
			{/if}
		</div>
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 mb-1">
				<span
					class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wider"
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
	<div
		class="space-y-2 ml-11"
		role={question.multiSelect ? 'group' : 'radiogroup'}
		aria-label={question.question}
	>
		{#each question.options as option, optIdx (option.label)}
			{#if readOnly}
				<div
					class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-start gap-3 border
						{isOptionSelected(qIdx, option.label)
						? 'bg-primary/10 border-primary/40 shadow-sm'
						: 'bg-background/50 border-transparent'}"
				>
					{@render optionBody(question, qIdx, option, optIdx, showShortcuts)}
				</div>
			{:else}
				<button
					type="button"
					role={question.multiSelect ? 'checkbox' : 'radio'}
					aria-checked={isOptionSelected(qIdx, option.label)}
					class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-start gap-3 border cursor-pointer
						{isOptionSelected(qIdx, option.label)
						? 'bg-primary/10 border-primary/40 shadow-sm'
						: 'bg-background/50 border-transparent hover:border-border hover:bg-accent/50'}"
					onclick={() => toggleOption(qIdx, option.label)}
				>
					{@render optionBody(question, qIdx, option, optIdx, showShortcuts)}
				</button>
			{/if}
		{/each}

		<!-- Other option -->
		<div
			class="w-full text-left px-3 py-2.5 rounded-lg transition-all border
			{otherSelected.get(qIdx)
				? 'bg-primary/10 border-primary/40'
				: 'bg-background/50 border-transparent'}
			{!readOnly && !otherSelected.get(qIdx) ? 'hover:border-border hover:bg-accent/50' : ''}"
		>
			{#if otherSelected.get(qIdx)}
				<div class="flex items-start gap-3">
					<div
						class="shrink-0 w-5 h-5 mt-0.5 rounded-{question.multiSelect
							? 'sm'
							: 'full'} border-2 border-primary bg-primary flex items-center justify-center"
					>
						<Check class="w-3 h-3 text-primary-foreground" />
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-2">
							<PenLine class="w-3.5 h-3.5 text-muted-foreground" />
							<span class="text-xs text-muted-foreground">Custom answer</span>
							{#if !readOnly}
								<button
									type="button"
									class="ml-auto p-0.5 rounded hover:bg-accent"
										aria-label="Clear custom answer"
									onclick={() => {
										otherSelected.set(qIdx, false);
										otherSelected = new Map(otherSelected);
									}}
								>
									<X class="w-3.5 h-3.5 text-muted-foreground" />
								</button>
							{/if}
						</div>
						{#if readOnly}
							<div class="w-full px-2 py-1.5 text-sm text-foreground">
								{otherTexts.get(qIdx) || ''}
							</div>
						{:else}
							<input
								type="text"
								aria-label="Custom answer"
								class="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md
									focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
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
						{/if}
					</div>
				</div>
			{:else if !readOnly}
				<button
					type="button"
					class="flex items-center gap-3 w-full cursor-pointer"
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
			{:else}
				<!-- Read-only "Other" not selected - show nothing or empty state -->
				<div class="flex items-center gap-3">
					<div
						class="shrink-0 w-5 h-5 rounded-{question.multiSelect
							? 'sm'
							: 'full'} border-2 border-dashed border-muted-foreground/30"
					></div>
					<span class="text-sm text-muted-foreground">Other...</span>
				</div>
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
											? 'text-primary bg-card/50'
											: 'text-muted-foreground hover:text-foreground hover:bg-accent/30'}"
									onclick={() => activeTab = qIdx}
								>
									<div class="flex items-center justify-center gap-2">
										<span class="truncate max-w-[100px]">{question.header}</span>
										{#if isQuestionAnswered(qIdx)}
											<Check class="w-3.5 h-3.5 text-success shrink-0" />
										{/if}
									</div>
									{#if activeTab === qIdx}
										<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
									{/if}
								</button>
							{/each}
						</div>

						<!-- Tab content -->
						<div class="p-4">
							{@render questionContent(questions[activeTab], activeTab, true, false)}
						</div>
					{:else}
						<!-- Single question: Simple view -->
						<div class="p-4">
							{@render questionContent(questions[0], 0, true, false)}
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
								<kbd class="px-1 py-0.5 rounded bg-muted font-mono">←/→</kbd> switch •
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
								class="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium
									hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
							>
								{#if isSubmitting}
									<div
										class="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin"
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
				{#if answeredSummary}
					<!-- Compact summary (clickable to expand) -->
					<div class="flex items-center gap-2 w-full">
						<button
							type="button"
							class="flex items-center gap-2 flex-1 text-left"
							aria-expanded={isExpanded}
							aria-controls={answeredId}
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
								{#each answeredSummary || [] as { header, answer }, idx (idx)}
									<div
										class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-border/50 rounded-full text-sm"
									>
										<span class="text-[10px] font-semibold text-primary uppercase">{header}</span>
										<span class="text-muted-foreground">→</span>
										<span class="text-foreground font-medium truncate max-w-[200px]">{answer}</span>
									</div>
								{/each}
							</div>
						</button>
						{#if onDismissMessage}
							<button
								onclick={() => onDismissMessage?.()}
								class="p-1 rounded-full hover:bg-accent transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
								title="Dismiss"
								aria-label="Dismiss"
							>
								<X class="w-3.5 h-3.5 text-muted-foreground" />
							</button>
						{/if}
					</div>

					<!-- Expanded view: Show full question UI (read-only) -->
					{#if isExpanded}
						<div
							id={answeredId}
							class="mt-3 border border-border/50 rounded-xl bg-card/30 overflow-hidden"
						>
							{#if questions.length > 1}
								<!-- Multi-question: Tab navigation (read-only) -->
								<div class="flex border-b border-border/50 bg-muted/10">
									{#each questions as question, qIdx (qIdx)}
										<button
											type="button"
											class="flex-1 px-3 py-2 text-xs font-medium transition-all relative
												{activeTab === qIdx
													? 'text-primary bg-card/50'
													: 'text-muted-foreground hover:text-foreground'}"
											onclick={() => activeTab = qIdx}
										>
											<div class="flex items-center justify-center gap-1.5">
												<span class="truncate max-w-[80px]">{question.header}</span>
												<Check class="w-3 h-3 text-success shrink-0" />
											</div>
											{#if activeTab === qIdx}
												<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/50"></div>
											{/if}
										</button>
									{/each}
								</div>
								<div class="p-3 opacity-75">
									{@render questionContent(questions[activeTab], activeTab, false, true)}
								</div>
							{:else}
								<div class="p-3 opacity-75">
									{@render questionContent(questions[0], 0, false, true)}
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
								class="p-1 rounded-full hover:bg-accent transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
								title="Dismiss"
								aria-label="Dismiss"
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

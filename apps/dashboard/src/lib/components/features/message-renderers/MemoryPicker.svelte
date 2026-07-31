<script lang="ts">
	import {
		IconBook,
		IconFolderOpen,
		IconHome,
		IconArrowRight,
		IconAlert,
		IconSpinner,
		IconCheck,
		IconError
	} from '$lib/icons';
	import type { MessageRendererProps } from './types';

	let {
		message,
		isActive = false,
		onMemorySelect,
		onMemorySave,
		onMemoryCancel,
		onDismissMessage
	}: MessageRendererProps = $props();

	// Memory picker state
	let memoryContent = $state('');
	let memorySaving = $state(false);
	let selectedMemoryOption = $state<'project' | 'user' | null>(null);

	// Initialize memory content when it changes in metadata
	$effect(() => {
		if (isActive) {
			memoryContent = (message.metadata?.memoryContent as string) || '';
		}
	});

	// Derived state for memory phase to ensure reactivity
	const isMemoryEditing = $derived(message.metadata?.memoryPhase === 'editing');
	const isMemorySelecting = $derived(isActive && !isMemoryEditing);

	// Action to autofocus elements when they mount
	function autofocus(node: HTMLElement) {
		node.focus();
	}

	async function handleMemorySave() {
		if (!onMemorySave || memorySaving) return;
		memorySaving = true;
		try {
			await onMemorySave(memoryContent);
		} finally {
			memorySaving = false;
		}
	}

	// Handle keyboard in memory selection phase (not editing)
	function handleMemorySelectionKeydown(e: KeyboardEvent) {
		if (!isMemorySelecting) return;

		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			if (!selectedMemoryOption) {
				selectedMemoryOption = 'project';
			} else {
				selectedMemoryOption = selectedMemoryOption === 'project' ? 'user' : 'project';
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (selectedMemoryOption) {
				onMemorySelect?.(selectedMemoryOption);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onMemoryCancel?.();
		} else if (e.key === '1') {
			e.preventDefault();
			onMemorySelect?.('project');
		} else if (e.key === '2') {
			e.preventDefault();
			onMemorySelect?.('user');
		}
	}

	// Handle keyboard in memory editor (textarea) - Escape cancels, Ctrl+Enter saves
	// Plain Enter must work for newlines, so we stop propagation to prevent window handlers
	function handleMemoryEditorKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onMemoryCancel?.();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			handleMemorySave();
		} else if (e.key === 'Enter') {
			// Stop propagation so window handlers don't intercept plain Enter
			e.stopPropagation();
		}
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		// Don't intercept keys when typing in textarea/input
		if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
		handleMemorySelectionKeydown(e);
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="flex justify-start gap-3 group">
	<div class="flex flex-col gap-1 items-start w-full">
		{#if isActive}
			<!-- Active: Show memory picker or editor -->
			<div class="w-full max-w-lg">
				<div class="border border-dotted border-border rounded-lg p-5 bg-card space-y-4">
					<!-- Header -->
					<div class="flex items-start gap-3">
						<div
							class="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center shrink-0"
						>
							<IconBook class="w-5 h-5 text-warning" />
						</div>
						<div class="flex-1">
							<h3 class="font-sans font-semibold text-foreground text-lg leading-tight">
								Edit memory
							</h3>
							<p class="text-sm text-muted-foreground mt-0.5">
								{#if isMemoryEditing}
									Editing {message.metadata?.selectedMemoryType === 'project' ? 'project' : 'user'} memory
								{:else}
									Select memory to edit
								{/if}
							</p>
						</div>
					</div>

					{#if message.metadata?.loading}
						<!-- Loading state -->
						<div class="flex items-center justify-center py-6">
							<IconSpinner class="w-5 h-5 animate-spin text-muted-foreground" />
							<span class="ml-2 text-sm text-muted-foreground">Loading memory...</span>
						</div>
					{:else if message.metadata?.error}
						<!-- Error state -->
						<div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
							<IconAlert class="w-4 h-4 shrink-0" />
							<span>{message.metadata.error}</span>
						</div>
					{:else if isMemoryEditing}
						<!-- Editor phase -->
						<div class="space-y-3" role="group" aria-label="Memory editor">
							<div class="flex items-center gap-2 text-xs text-muted-foreground">
								{#if message.metadata?.selectedMemoryType === 'project'}
									<IconFolderOpen class="w-3.5 h-3.5" />
									<code class="font-mono bg-muted px-1.5 py-0.5 rounded"
										>{message.metadata?.memoryPath || './CLAUDE.md'}</code
									>
								{:else}
									<IconHome class="w-3.5 h-3.5" />
									<code class="font-mono bg-muted px-1.5 py-0.5 rounded">~/.claude/CLAUDE.md</code>
								{/if}
							</div>
							<textarea
								use:autofocus
								aria-label="Memory content"
								class="w-full h-64 px-3 py-2 bg-background border border-border rounded-lg font-mono text-sm
                       placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring
                       focus-visible:ring-2 focus-visible:ring-ring/30 resize-y transition-colors"
								placeholder="# Memory instructions for Claude..."
								value={message.metadata?.memoryContent || ''}
								oninput={(e: Event & { currentTarget: EventTarget & HTMLTextAreaElement }) => {
									memoryContent = e.currentTarget.value;
								}}
								onkeydown={handleMemoryEditorKeydown}
							></textarea>
							<p class="text-xs text-muted-foreground">
								Markdown format. Changes will be saved to the file on the agent.
							</p>
						</div>

						<!-- Editor Actions -->
						<div class="flex items-center gap-3 pt-1">
							<button
								onclick={handleMemorySave}
								disabled={memorySaving}
								class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium
                       hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,opacity] duration-150 ease-out group"
							>
								{#if memorySaving}
									<IconSpinner class="w-4 h-4 animate-spin" />
									<span>Saving...</span>
								{:else}
									<IconCheck class="w-4 h-4" />
									<span>Save</span>
								{/if}
							</button>
							<button
								onclick={onMemoryCancel}
								disabled={memorySaving}
								class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
							>
								Cancel
							</button>
						</div>
					{:else}
						<!-- Selection phase -->
						<div
							class="space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
							tabindex="-1"
							use:autofocus
							role="group"
							aria-label="Memory location"
						>
							<button
								type="button"
								class="w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-start gap-3 group
                  {selectedMemoryOption === 'project'
									? 'border-warning/50 bg-warning/10'
									: 'border-border hover:border-warning/50 hover:bg-warning/5'}"
								onclick={() => onMemorySelect?.('project')}
								onmouseenter={() => (selectedMemoryOption = 'project')}
								onfocus={() => (selectedMemoryOption = 'project')}
							>
								<div
									class="shrink-0 w-6 h-6 rounded bg-warning/10 flex items-center justify-center mt-0.5"
								>
									<IconFolderOpen class="w-3.5 h-3.5 text-warning" />
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium text-foreground text-sm">Project memory</span>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground"
											>1</span
										>
									</div>
									<p class="text-xs text-muted-foreground mt-0.5">
										Checked in at <code class="px-1 py-0.5 bg-muted rounded">./CLAUDE.md</code>
									</p>
								</div>
								<IconArrowRight
									class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1"
								/>
							</button>

							<button
								type="button"
								class="w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-start gap-3 group
                  {selectedMemoryOption === 'user'
									? 'border-warning/50 bg-warning/10'
									: 'border-border hover:border-warning/50 hover:bg-warning/5'}"
								onclick={() => onMemorySelect?.('user')}
								onmouseenter={() => (selectedMemoryOption = 'user')}
								onfocus={() => (selectedMemoryOption = 'user')}
							>
								<div
									class="shrink-0 w-6 h-6 rounded bg-warning/10 flex items-center justify-center mt-0.5"
								>
									<IconHome class="w-3.5 h-3.5 text-warning" />
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium text-foreground text-sm">User memory</span>
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground"
											>2</span
										>
									</div>
									<p class="text-xs text-muted-foreground mt-0.5">
										Saved in <code class="px-1 py-0.5 bg-muted rounded">~/.claude/CLAUDE.md</code>
									</p>
								</div>
								<IconArrowRight
									class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1"
								/>
							</button>
						</div>

						<!-- Cancel button for selection phase -->
						<div class="flex justify-end pt-1">
							<button
								onclick={onMemoryCancel}
								class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
							>
								Cancel
							</button>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<!-- Inactive: Show compact version -->
			<div
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-dotted border-border rounded-lg text-sm group"
			>
				<IconBook class="w-3.5 h-3.5 text-muted-foreground" />
				<span class="text-muted-foreground">Memory</span>
				{#if message.metadata?.selectedMemoryType}
					<span class="text-muted-foreground text-xs capitalize"
						>{message.metadata.selectedMemoryType}</span
					>
				{/if}
				{#if onDismissMessage}
					<button
						onclick={onDismissMessage}
						class="ml-1 p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
						title="Dismiss"
						aria-label="Dismiss"
					>
						<IconError class="w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground" />
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

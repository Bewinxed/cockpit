<script lang="ts">
	import { Cpu, Check, ArrowRight, AlertCircle, Loader2, XCircle } from 'lucide-svelte';
	import type { MessageRendererProps } from './types';

	interface ModelInfo {
		value: string;
		displayName: string;
		description: string;
	}

	let {
		message,
		isActive = false,
		onModelSelect,
		onModelCancel,
		onDismissMessage
	}: MessageRendererProps = $props();

	// Model picker state
	let models = $derived<ModelInfo[]>((message.metadata?.models as ModelInfo[]) || []);
	let currentModel = $derived<string | undefined>(message.metadata?.currentModel as string | undefined);
	let selectedModel = $state<string | undefined>(undefined);
	let modelLoading = $state(false);
	let modelError = $state<string | null>(null);

	// Initialize selected model when models change
	$effect(() => {
		if (isActive && models.length > 0 && !selectedModel) {
			selectedModel = currentModel || models[0]?.value;
		}
	});

	async function handleModelSubmit() {
		if (!selectedModel || !onModelSelect) return;
		modelLoading = true;
		modelError = null;
		try {
			await onModelSelect(selectedModel);
		} catch (err) {
			modelError = err instanceof Error ? err.message : 'Failed to set model';
		} finally {
			modelLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isActive) return;
		const currentIndex = models.findIndex((m) => m.value === selectedModel);

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			const newIndex = currentIndex > 0 ? currentIndex - 1 : models.length - 1;
			selectedModel = models[newIndex]?.value;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			const newIndex = currentIndex < models.length - 1 ? currentIndex + 1 : 0;
			selectedModel = models[newIndex]?.value;
		} else if (e.key === 'Enter' && !modelLoading) {
			e.preventDefault();
			handleModelSubmit();
		} else if (e.key === 'Escape') {
			onModelCancel?.();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex justify-start gap-3 group">
	<div class="flex flex-col gap-1 items-start w-full">
		{#if isActive}
			<!-- Active: Show model picker form -->
			<div class="w-full max-w-md">
				<div class="border border-dotted border-border rounded-lg p-5 bg-card space-y-4">
					<!-- Header -->
					<div class="flex items-start gap-3">
						<div
							class="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center flex-shrink-0"
						>
							<Cpu class="w-5 h-5 text-secondary" />
						</div>
						<div>
							<h3 class="font-sans font-semibold text-foreground text-lg leading-tight">
								Switch Model
							</h3>
							<p class="text-sm text-muted-foreground mt-0.5">Select a model for this session</p>
						</div>
					</div>

					<!-- Model list -->
					{#if message.metadata?.loading}
						<div class="flex items-center justify-center py-6">
							<Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
							<span class="ml-2 text-sm text-muted-foreground">Loading models...</span>
						</div>
					{:else if message.metadata?.error}
						<div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
							<AlertCircle class="w-4 h-4 flex-shrink-0" />
							<span>{message.metadata.error}</span>
						</div>
					{:else if models.length === 0}
						<div class="text-center py-6 text-sm text-muted-foreground">No models available</div>
					{:else}
						<div class="space-y-1 max-h-64 overflow-y-auto">
							{#each models as model (model.value)}
								<button
									type="button"
									class="w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-3
                    {selectedModel === model.value
										? 'bg-secondary/10 border border-secondary/30'
										: 'hover:bg-accent border border-transparent'}"
									onclick={() => (selectedModel = model.value)}
								>
									<div class="flex-shrink-0 w-5 h-5 mt-0.5">
										{#if selectedModel === model.value}
											<Check class="w-5 h-5 text-secondary" />
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<span class="font-medium text-foreground text-sm">{model.displayName}</span>
											{#if currentModel === model.value}
												<span
													class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary uppercase tracking-wide"
													>current</span
												>
											{/if}
										</div>
										<p class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
											{model.description}
										</p>
									</div>
								</button>
							{/each}
						</div>
						<p class="text-xs text-muted-foreground text-center">
							Use ↑↓ to navigate, Enter to select
						</p>
					{/if}

					<!-- Error -->
					{#if modelError}
						<div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
							<AlertCircle class="w-4 h-4 flex-shrink-0" />
							<span>{modelError}</span>
						</div>
					{/if}

					<!-- Actions -->
					<div class="flex items-center gap-3 pt-1">
						<button
							onclick={handleModelSubmit}
							disabled={!selectedModel || selectedModel === currentModel || modelLoading}
							class="flex items-center gap-2 px-4 py-2 bg-[#37352f] text-white rounded-md text-sm font-medium
                     hover:bg-[#2f2d29] disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
						>
							{#if modelLoading}
								<Loader2 class="w-4 h-4 animate-spin" />
								<span>Applying...</span>
							{:else}
								<span>Apply</span>
								<ArrowRight
									class="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform"
								/>
							{/if}
						</button>
						<button
							onclick={onModelCancel}
							disabled={modelLoading}
							class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Inactive: Show compact version -->
			<div
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-dotted border-border rounded-lg text-sm group"
			>
				<Cpu class="w-3.5 h-3.5 text-muted-foreground" />
				<span class="text-muted-foreground">Model selection</span>
				{#if message.metadata?.selectedModel}
					<span class="text-muted-foreground text-xs">{message.metadata.selectedModel}</span>
				{/if}
				{#if onDismissMessage}
					<button
						onclick={onDismissMessage}
						class="ml-1 p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
						title="Dismiss"
					>
						<XCircle class="w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground" />
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

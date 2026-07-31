<script lang="ts">
	import { IconChevronRight, IconSpinner, IconSuccess, IconError, IconDocument, IconTerminal, IconCode, IconSearch, IconFolderOpen, IconPen, IconGlobe, IconTools } from '$lib/icons';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import type { Message } from '$lib/cockpit/types';
	import DiffView from './DiffView.svelte';
	import DiffModal from './DiffModal.svelte';
	import { getToolGlance, getResultGlimpse } from '$lib/utils/tool-display';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	interface Props {
		tools: Message[];
	}

	let { tools }: Props = $props();

	// Track which tools are expanded
	let expandedTools = new SvelteSet<string>();

	// Check if all tools are complete
	const hasErrors = $derived(tools.some(t => t.metadata?.toolStatus === 'error'));
	const pendingCount = $derived(tools.filter(t => t.metadata?.toolStatus === 'pending').length);

	// A group read back from a stored transcript arrives already finished — only a
	// run that lands while you are watching earns the completion pop.
	const startedPending = untrack(() => tools.some(t => t.metadata?.toolStatus === 'pending'));

	// Get icon for tool type
	function getToolIcon(toolName: string | undefined) {
		if (!toolName) return IconTools;
		const name = toolName.toLowerCase();
		if (name.includes('read') || name.includes('file')) return IconDocument;
		if (name.includes('edit') || name.includes('write')) return IconPen;
		if (name.includes('bash') || name.includes('terminal') || name.includes('shell')) return IconTerminal;
		if (name.includes('glob') || name.includes('find')) return IconFolderOpen;
		if (name.includes('grep') || name.includes('search')) return IconSearch;
		if (name.includes('web') || name.includes('fetch')) return IconGlobe;
		if (name.includes('code')) return IconCode;
		return IconTools;
	}

	// Check if tool is a file diff tool
	function isFileDiffTool(toolName: string | undefined): boolean {
		if (!toolName) return false;
		const name = toolName.toLowerCase();
		return name === 'edit' || name === 'write' || name.includes('edit') || name.includes('write');
	}

	// Get diff info for Edit/Write tools
	function getDiffInfo(input: Record<string, unknown> | undefined, toolName: string | undefined) {
		if (!input || !isFileDiffTool(toolName)) return null;
		const filePath = input.file_path as string | undefined;
		const oldString = input.old_string as string | undefined;
		const newString = input.new_string as string | undefined;
		const content = input.content as string | undefined;

		if (filePath && oldString !== undefined && newString !== undefined) {
			return { filePath, oldContent: oldString, newContent: newString };
		}
		if (filePath && content !== undefined) {
			return { filePath, oldContent: '', newContent: content };
		}
		return null;
	}

	function toggleTool(toolId: string) {
		if (expandedTools.has(toolId)) {
			expandedTools.delete(toolId);
		} else {
			expandedTools.add(toolId);
		}
	}

	// Diff modal state
	let diffModalOpen = $state(false);
	let diffModalData = $state<{ id: string; filePath: string; oldContent: string; newContent: string } | null>(null);

	function openDiffModal(id: string, filePath: string, oldContent: string, newContent: string) {
		diffModalData = { id, filePath, oldContent, newContent };
		diffModalOpen = true;
	}
</script>

<div class="tool-group w-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
	<!-- Group Header -->
	<div class="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
		<span class="text-sm font-medium text-foreground">
			{tools.length} Tool{tools.length > 1 ? 's' : ''}
		</span>
		<div class="ml-auto flex items-center gap-1.5">
			{#if pendingCount > 0}
				<IconSpinner class="w-4 h-4 text-warning animate-spin" />
				<span class="text-xs text-muted-foreground">{pendingCount} running</span>
			{:else if hasErrors}
				<IconError class="w-4 h-4 text-destructive" />
				<span class="text-xs text-destructive">Error</span>
			{:else}
				<span in:scale={{ duration: startedPending ? 260 : 0, start: 0.25, easing: quintOut }}>
					<IconSuccess class="w-4 h-4 text-success" />
				</span>
				<span class="text-xs text-success">Complete</span>
			{/if}
		</div>
	</div>

	<!-- Tool List -->
	<div class="divide-y divide-border">
		{#each tools as tool, i (tool.id)}
			{@const toolId = tool.id || `tool-${i}`}
			{@const isOpen = expandedTools.has(toolId)}
			{@const toolName = tool.metadata?.toolName || 'Tool'}
			{@const input = tool.metadata?.toolInput as Record<string, unknown> | undefined}
			{@const glance = getToolGlance(input)}
			{@const resultGlance = getResultGlimpse(tool.metadata?.toolResult)}
			{@const status = tool.metadata?.toolStatus}
			{@const ToolIcon = getToolIcon(toolName)}
			{@const result = tool.metadata?.toolResult}
			{@const diffInfo = getDiffInfo(input, toolName)}

			<Collapsible.Root open={isOpen} onOpenChange={() => toggleTool(toolId)}>
				<Collapsible.Trigger class="w-full text-left">
					<div class="px-3 py-2.5 hover:bg-muted/30 transition-colors flex items-start gap-2 group cursor-pointer">
						<!-- Expand chevron -->
						<IconChevronRight class="w-4 h-4 text-muted-foreground mt-0.5 shrink-0 transition-transform duration-200 {isOpen ? 'rotate-90' : ''}" />

						<!-- Tool icon -->
						<div class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center
							{status === 'pending' ? 'bg-warning/10' : status === 'error' ? 'bg-destructive/10' : 'bg-success/10'}">
							<ToolIcon class="w-3.5 h-3.5 {status === 'pending' ? 'text-warning' : status === 'error' ? 'text-destructive' : 'text-success'}" />
						</div>

						<!-- Tool info -->
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium text-foreground">{toolName}</span>
								{#if glance}
									<span class="text-xs text-muted-foreground truncate font-mono">{glance}</span>
								{/if}
							</div>

							<!-- Result glance (preview when collapsed) -->
							{#if !isOpen && resultGlance}
								<div class="mt-1 text-xs text-muted-foreground/70 font-mono truncate">
									{resultGlance}
								</div>
							{/if}
						</div>

						<!-- Status badge -->
						<div class="shrink-0">
							{#if status === 'pending'}
								<IconSpinner class="w-4 h-4 text-warning animate-spin" />
							{:else if status === 'error'}
								<IconError class="w-4 h-4 text-destructive" />
							{:else}
								<IconSuccess class="w-4 h-4 text-success" />
							{/if}
						</div>
					</div>
				</Collapsible.Trigger>

				<Collapsible.Content>
					<div class="px-3 pb-3 border-l-2 border-border/50 ml-[22px]">
						<div class="pl-4 space-y-3 pt-2">
							<!-- Input section -->
							{#if isFileDiffTool(toolName) && diffInfo}
								<div class="rounded-lg overflow-hidden border border-border">
									<div class="max-h-[300px] overflow-auto">
										<DiffView
											filePath={diffInfo.filePath}
											oldContent={diffInfo.oldContent}
											newContent={diffInfo.newContent}
										/>
									</div>
									<div class="border-t border-border bg-muted/30 px-2 py-1.5 flex justify-end">
										<button
											class="px-3 py-1 text-xs bg-muted hover:bg-accent border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
											onclick={(e: MouseEvent) => { e.stopPropagation(); openDiffModal(toolId, diffInfo.filePath, diffInfo.oldContent, diffInfo.newContent); }}
										>
											Open in modal
										</button>
									</div>
								</div>
							{:else if input}
								<div class="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-auto max-h-[250px]">
									<div class="text-muted-foreground text-[10px] uppercase tracking-wide mb-2 font-medium font-sans">Input</div>
									<pre class="whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(input, null, 2)}</pre>
								</div>
							{/if}

							<!-- Result section -->
							{#if result !== undefined && result !== null}
								<div class="rounded-lg p-3 font-mono text-xs overflow-auto max-h-[300px]
									{status === 'error' ? 'bg-destructive/5 border border-destructive/20' : 'bg-success/5 border border-success/20'}">
									<div class="text-[10px] uppercase tracking-wide mb-2 font-medium font-sans
										{status === 'error' ? 'text-destructive' : 'text-success'}">
										{status === 'error' ? 'Error' : 'Result'}
									</div>
									<pre class="whitespace-pre-wrap break-all text-muted-foreground">{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
								</div>
							{/if}
						</div>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{/each}
	</div>
</div>

<!-- Diff Modal — the data outlives the close so the panel can animate out. -->
{#if diffModalOpen && diffModalData}
	<DiffModal
		filePath={diffModalData.filePath}
		oldContent={diffModalData.oldContent}
		newContent={diffModalData.newContent}
		onClose={() => (diffModalOpen = false)}
	/>
{/if}

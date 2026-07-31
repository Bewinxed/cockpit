<script lang="ts">
	import { ChevronRight, Brain } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import type { MessageRendererProps } from './types';

	let { message }: MessageRendererProps = $props();
	let expanded = $state(false);

	const thinking = $derived(message.metadata?.thinking || message.content || '');
	const isRedacted = $derived(message.metadata?.isRedactedThinking === true);

	const summary = $derived(
		isRedacted
			? 'Reasoning redacted'
			: thinking.length > 100
				? thinking.slice(0, 100) + '...'
				: thinking
	);
</script>

<div class="flex justify-start gap-3 group">
	<div class="flex flex-col gap-1 items-start w-full max-w-[85%]">
		<div class="thinking-block border-l-2 border-border pl-3 py-1 w-full">
			<button
				type="button"
				class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-left"
				onclick={() => (expanded = !expanded)}
			>
				<ChevronRight
					class="size-4 shrink-0 transition-transform duration-200 {expanded
						? 'rotate-90'
						: ''}"
				/>
				<Brain class="size-4 shrink-0 text-muted-foreground" />
				<span class="font-medium text-muted-foreground">Thinking</span>
				{#if !expanded}
					<span class="text-xs opacity-60 truncate max-w-[300px]">{summary}</span>
				{/if}
			</button>

			{#if expanded}
				<div
					class="mt-2 text-sm text-muted-foreground font-mono whitespace-pre-wrap pl-6 {isRedacted
						? 'italic'
						: ''}"
					transition:slide={{ duration: 200 }}
				>
					{#if isRedacted}
						<span class="text-muted-foreground/60"
							>The reasoning for this response has been redacted.</span
						>
					{:else}
						{thinking}
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

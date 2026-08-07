<script lang="ts">
	import { IconChevronRight, IconThinking } from '$lib/icons';
	import * as Collapsible from '$lib/components/ui/collapsible';
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

<Collapsible.Root open={expanded} onOpenChange={() => (expanded = !expanded)}>
	<Collapsible.Trigger
		class="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors w-full text-left"
	>
		<IconChevronRight
			class="size-3 shrink-0 transition-transform duration-200 {expanded
				? 'rotate-90'
				: ''}"
		/>
		<IconThinking class="size-3 shrink-0" />
		<span>Thinking</span>
		{#if !expanded}
			<span class="opacity-60 truncate max-w-[300px]">{summary}</span>
		{/if}
	</Collapsible.Trigger>

	<Collapsible.Content>
		<div
			class="mt-2 text-sm text-muted-foreground font-mono whitespace-pre-wrap pl-[18px] {isRedacted
				? 'italic'
				: ''}"
		>
			{#if isRedacted}
				<span class="text-muted-foreground/60"
					>The reasoning for this response has been redacted.</span
				>
			{:else}
				{thinking}
			{/if}
		</div>
	</Collapsible.Content>
</Collapsible.Root>

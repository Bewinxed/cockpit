<script lang="ts">
	/**
	 * The parent's `answer_delegate` call as a readable receipt: what was
	 * approved/denied/answered and for which delegate — not the raw target uuid
	 * and requestId the generic tool row would print. The ask it answered is
	 * found in the same transcript by requestId; the raw ids stay behind the
	 * expand affordance.
	 */
	import { IconCheck, IconClose, IconChevronRight } from '$lib/icons';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { answerVerdict, askShort, askShortOf } from '$lib/cockpit/frames';
	import { cockpit } from '$lib/cockpit/client.svelte';
	import type { MessageRendererProps } from './types';

	let { message, instanceId = '' }: MessageRendererProps = $props();

	const verdict = $derived(answerVerdict(message.metadata?.toolInput));

	/** The ask this call answered, off the hub's record of the exchange. */
	const asked = $derived(verdict.requestId ? cockpit.delegateAskOf(verdict.requestId) : null);

	/** The same ask paired by requestId in this transcript, where the hub has no row. */
	const stored = $derived.by(() => {
		if (!verdict.requestId || asked) return null;
		const session = cockpit.session(instanceId || message.instanceId);
		return (
			(session?.messages ?? []).find(
				(m) => m.type === 'user.delegate_ask' && m.metadata?.askRequestId === verdict.requestId
			) ?? null
		);
	});

	const label = $derived.by(() => {
		// The hub names a delegate `<checkout>#<short id>`; a row carries both.
		const row = asked ? cockpit.instances.find((r) => r.id === asked.instanceId) : undefined;
		if (row) return `${row.cwd.split('/').filter(Boolean).pop() ?? row.cwd}#${row.id.slice(0, 8)}`;
		return stored?.metadata?.askLabel ?? 'delegate';
	});

	const short = $derived(
		asked
			? askShortOf(asked.toolName, asked.payload.input ?? {})
			: stored
				? askShort(stored.content)
				: ''
	);
	let open = $state(false);
</script>

<div class="w-full max-w-[min(65ch,100%)] overflow-hidden rounded-xl border border-border/50 bg-muted/30">
	<Collapsible.Root {open} onOpenChange={() => (open = !open)}>
		<Collapsible.Trigger class="w-full text-left">
			<div class="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/50">
				<IconChevronRight
					class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 {open
						? 'rotate-90'
						: ''}"
				/>
				{#if verdict.verb === 'Denied'}
					<IconClose class="size-4 shrink-0 text-destructive" />
				{:else}
					<IconCheck class="size-4 shrink-0 text-success" />
				{/if}
				<span class="shrink-0 text-xs font-medium text-muted-foreground">
					{verdict.verb}
					<span class="font-mono text-foreground">{label}</span>'s ask
				</span>
				{#if short}
					<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
						{short}
					</span>
				{/if}
			</div>
		</Collapsible.Trigger>

		<Collapsible.Content>
			<div class="space-y-1.5 border-t border-border/40 px-3 py-2">
				{#each verdict.answers as pair (pair.question)}
					<p class="text-xs text-muted-foreground">
						<span class="font-medium">{pair.question}</span> → {pair.choice}
					</p>
				{/each}
				{#if verdict.requestId}
					<p class="font-mono text-micro text-muted-foreground/70">{verdict.requestId}</p>
				{/if}
				{#if message.metadata?.toolStatus === 'error' && message.metadata?.toolResult}
					<p class="text-micro text-destructive/70">
						{String(message.metadata.toolResult).slice(0, 200)}
					</p>
				{/if}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>

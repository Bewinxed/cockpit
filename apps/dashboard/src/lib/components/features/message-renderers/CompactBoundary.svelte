<script lang="ts">
	import { IconScissors } from '$lib/icons';
	import type { MessageRendererProps } from './types';

	let { message }: MessageRendererProps = $props();
</script>

<!-- Compact boundary - horizontal divider -->
<div class="w-full flex items-center gap-3 py-2">
	<div class="flex-1 h-px bg-border"></div>
	<div class="flex items-center gap-2 text-xs text-muted-foreground">
		<IconScissors class="w-3 h-3" />
		<span>Context compacted</span>
		{#if message.metadata?.preTokens}
			<span class="text-muted-foreground">({message.metadata.preTokens.toLocaleString()} tokens)</span>
		{/if}
	</div>
	<div class="flex-1 h-px bg-border"></div>
</div>

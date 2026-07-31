<script lang="ts">
	import { Circle, Server, ChevronRight } from '@lucide/svelte';

	interface MCPServer {
		name: string;
		status: string;
	}

	interface Props {
		servers: MCPServer[];
		collapsedThreshold?: number;
	}

	let { servers, collapsedThreshold = 5 }: Props = $props();

	// Collapse if more than threshold servers (start collapsed for many servers)
	let expanded = $state(false);

	const listId = $props.id();
	const shouldCollapse = $derived(servers.length > collapsedThreshold);

	// Separate servers by status for priority display
	const connectedServers = $derived(servers.filter((s) => s.status === 'connected'));
	const problemServers = $derived(servers.filter((s) => s.status !== 'connected'));

	// Display priority: problem servers first, then connected
	const displayServers = $derived([...problemServers, ...connectedServers]);
	const visibleServers = $derived(expanded ? displayServers : displayServers.slice(0, collapsedThreshold));
	const hiddenCount = $derived(displayServers.length - visibleServers.length);

	/** Wire vocabulary reads as wire vocabulary — the chip says it in words. */
	const STATUS_LABEL: Record<string, string> = {
		connected: 'Connected',
		'needs-auth': 'Needs auth',
		error: 'Error',
		pending: 'Starting'
	};

	const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

	function getStatusColor(status: string) {
		switch (status) {
			case 'connected':
				return 'bg-success/10 text-success';
			case 'needs-auth':
				return 'bg-warning/10 text-warning';
			case 'error':
				return 'bg-error/10 text-error';
			default:
				return 'bg-muted text-muted-foreground';
		}
	}

	function getDotColor(status: string) {
		switch (status) {
			case 'connected':
				return 'text-success';
			case 'needs-auth':
				return 'text-warning';
			case 'error':
				return 'text-error';
			default:
				return 'text-muted-foreground';
		}
	}
</script>

{#if servers.length > 0}
	<div class="mcp-status mt-3 pt-3 border-t border-border/50">
		<div class="flex items-center gap-2 text-xs text-muted-foreground mb-2">
			<Server class="size-3" />
			<span class="font-medium">MCP servers ({servers.length})</span>
			{#if problemServers.length > 0}
				<span class="text-warning text-[10px]">({problemServers.length} need attention)</span>
			{/if}
		</div>

		<div id={listId} class="flex flex-wrap gap-1.5">
			{#each visibleServers as server (server.name)}
				<span
					class="inline-flex min-h-6 items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium {getStatusColor(server.status)}"
					title="{server.name}: {statusLabel(server.status)}"
				>
					<Circle class="size-1.5 fill-current {getDotColor(server.status)}" aria-hidden="true" />
					<span class="truncate max-w-[120px]">{server.name}</span>
					<span class="sr-only">{statusLabel(server.status)}</span>
				</span>
			{/each}

			{#if shouldCollapse && hiddenCount > 0}
				<button
					type="button"
					class="inline-flex min-h-6 items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring"
					aria-expanded={expanded}
					aria-controls={listId}
					onclick={() => (expanded = !expanded)}
				>
					<span>+{hiddenCount} more</span>
				</button>
			{/if}
		</div>

		{#if shouldCollapse && expanded}
			<button
				type="button"
				class="mt-2 flex min-h-6 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring"
				aria-expanded={expanded}
				aria-controls={listId}
				onclick={() => (expanded = false)}
			>
				<ChevronRight class="size-3 rotate-90" />
				<span>Show less</span>
			</button>
		{/if}
	</div>
{/if}

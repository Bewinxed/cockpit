<script lang="ts">
  /**
   * The session's MCP servers as favicon chips: the favicon where a URL names
   * one, the name's first letter where nothing does (stdio) or the image never
   * arrived. Connection trouble is a dot on the chip, not a chip of its own —
   * clicking one opens what went wrong and what the server offers.
   */
  import type { McpServerStatus } from '@cockpit/core';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import * as Popover from '$lib/components/ui/popover';
  import { restartMcpServer, setMcpServerEnabled } from './client.svelte';
  import { faviconCandidates, mcpHost } from './mcp';
  import McpServerDetail from './McpServerDetail.svelte';

  interface Props {
    servers: McpServerStatus[];
    instanceId: string;
    machineId: string;
  }

  let { servers, instanceId, machineId }: Props = $props();

  /** Chips shown before the rest fold into a count. */
  const VISIBLE = 8;

  const shown = $derived(servers.slice(0, VISIBLE));
  const rest = $derived(servers.slice(VISIBLE));

  /** How far down a server's candidate list the failures have walked, by name. */
  let attempt = $state<Record<string, number>>({});
  /** The server whose details popover is open; one at a time. */
  let detailsFor = $state<string | null>(null);
  /** Servers with a restart or stop in flight, by name. */
  let busy = $state<Record<string, boolean>>({});
  /** Favicons that have painted, for the fade-in. */
  let loaded = $state<Record<string, boolean>>({});

  const DOT: Record<string, string> = {
    connected: 'bg-success',
    failed: 'bg-destructive',
    'needs-auth': 'bg-warning',
    pending: 'bg-muted-foreground animate-pulse',
  };

  /** The chip's dot says only what needs acting on; connected is the quiet case. */
  const CHIP_DOT: Record<string, string> = {
    failed: DOT.failed,
    'needs-auth': DOT['needs-auth'],
    pending: DOT.pending,
  };

  const tip = (server: McpServerStatus): string =>
    server.status === 'failed' && server.error
      ? `${server.name} · ${server.status} — ${server.error}`
      : `${server.name} · ${server.status}`;

  async function run(name: string, action: () => Promise<void>) {
    busy[name] = true;
    try {
      await action();
    } catch (error) {
      console.error(`[cockpit] ${name} did not answer:`, error);
      toast.error(`${name} did not respond`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busy[name] = false;
    }
  }

  const restart = (name: string) => run(name, () => restartMcpServer(instanceId, machineId, name));
  const setEnabled = (name: string, enabled: boolean) =>
    run(name, () => setMcpServerEnabled(instanceId, machineId, name, enabled));
</script>

<span class="flex shrink-0 items-center gap-1" aria-label="MCP servers">
  {#each shown as server (server.name)}
    {@const host = mcpHost(server)}
    {@const candidates = host ? faviconCandidates(host) : []}
    {@const step = attempt[server.name] ?? 0}
    <!-- `inline-flex` on the wrapper: an inline span parks the trigger on the
         text baseline and every chip drifts against its neighbours. -->
    <span
      class="inline-flex"
      animate:flip={{ duration: 200 }}
      in:fly={{ y: 4, duration: 200, easing: quintOut }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger class="contents">
          <Popover.Root
            open={detailsFor === server.name}
            onOpenChange={(open) => (detailsFor = open ? server.name : null)}
          >
            <!-- The kit's outline button, like every other control in this
                 header: the border and hover are what say "clickable", and the
                 box matches its h-8 neighbours. The favicon inside is 24px. -->
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="outline"
                  size="icon-sm"
                  class="relative {server.status === 'disabled' ? 'opacity-40' : ''} {busy[
                    server.name
                  ]
                    ? 'animate-pulse'
                    : ''}"
                  title={tip(server)}
                  aria-label="MCP server {server.name}"
                >
                  <!-- The favicon IS the button: it fills the circle edge to
                       edge, cropped round — no inset, no framed-square look. -->
                  {#if step < candidates.length}
                    <img
                      src={candidates[step]}
                      alt={server.name}
                      class="size-full rounded-full object-cover transition-opacity duration-300 {loaded[
                        server.name
                      ]
                        ? 'opacity-100'
                        : 'opacity-0'}"
                      loading="lazy"
                      onload={() => (loaded[server.name] = true)}
                      onerror={() => (attempt[server.name] = step + 1)}
                    />
                  {:else}
                    <span
                      class="flex size-full items-center justify-center rounded-full bg-muted text-xs leading-none
                             font-medium text-muted-foreground uppercase"
                      aria-hidden="true"
                    >
                      {server.name.charAt(0)}
                    </span>
                  {/if}
                  {#if CHIP_DOT[server.status]}
                    <!-- Ringed so it reads over any favicon colour. -->
                    <span
                      class="absolute right-0.5 bottom-0.5 size-2 rounded-full ring-2 ring-background
                             transition-colors duration-300 {CHIP_DOT[server.status]}"
                    ></span>
                  {/if}
                </Button>
              {/snippet}
            </Popover.Trigger>

            <Popover.Content class="w-64 rounded-xl p-3 shadow-lg" align="end">
              <McpServerDetail {server} {instanceId} {machineId} />
            </Popover.Content>
          </Popover.Root>
        </ContextMenu.Trigger>

        <ContextMenu.Content>
          <ContextMenu.Item onSelect={() => (detailsFor = server.name)}>
            Status & errors
          </ContextMenu.Item>
          <ContextMenu.Item disabled={busy[server.name]} onSelect={() => restart(server.name)}>
            Restart
          </ContextMenu.Item>
          {#if server.status === 'disabled'}
            <ContextMenu.Item
              disabled={busy[server.name]}
              onSelect={() => setEnabled(server.name, true)}
            >
              Start
            </ContextMenu.Item>
          {:else}
            <ContextMenu.Item
              disabled={busy[server.name]}
              onSelect={() => setEnabled(server.name, false)}
            >
              Stop
            </ContextMenu.Item>
          {/if}
        </ContextMenu.Content>
      </ContextMenu.Root>
    </span>
  {/each}
  {#if rest.length > 0}
    <!-- Centred in the same h-8 line as the chips, or it floats off baseline. -->
    <span
      class="flex h-8 shrink-0 items-center px-1 text-xs text-muted-foreground tabular-nums"
      title={rest.map((server) => tip(server)).join('\n')}
    >
      +{rest.length}
    </span>
  {/if}
</span>

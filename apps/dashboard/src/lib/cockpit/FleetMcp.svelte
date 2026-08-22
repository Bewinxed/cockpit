<script lang="ts">
  import { toast } from 'svelte-sonner';
  import type { FleetMcpServer } from '@cockpit/core';
  import { IconPen, IconPlus, IconRefresh, IconTrash, IconWarningTriangle } from '$lib/icons';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Machine } from './client.svelte';
  import { describeMcp, isRemoteMcp, removeMcpServer, saveMcpServer, syncFleet } from './fleet';
  import FleetStatusStrip from './FleetStatusStrip.svelte';
  import MachineInventory from './MachineInventory.svelte';
  import McpServerDialog from './McpServerDialog.svelte';

  let {
    servers,
    machines,
    settling,
    error,
  }: {
    servers: FleetMcpServer[];
    machines: Machine[];
    settling: boolean;
    error: string | null;
  } = $props();

  let editing = $state<FleetMcpServer | null>(null);
  let composing = $state(false);
  let syncing = $state(false);
  let busy = $state<Record<string, boolean>>({});

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // Quiet Ledger surfaces (DESIGN.md · mocks/v5-components.html .panel / .callout).
  const panelList = 'gap-0 overflow-hidden rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-0 shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]';
  const panelPad = 'gap-[var(--space-3)] rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-[var(--space-6)] shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]';
  const warnAlert = 'items-center rounded-[var(--radius-control)] border-[var(--warning-9)] bg-[var(--warning-3)] p-[var(--space-3)] [&>svg]:text-[var(--warning-11)]';

  function open(row: FleetMcpServer | null) {
    editing = row;
    composing = true;
  }

  function saved(row: FleetMcpServer) {
    const at = servers.findIndex((other) => other.name === row.name);
    if (at === -1) servers.push(row);
    else servers[at] = row;
    if (editing && editing.name !== row.name) {
      toast.info(`${editing.name} is still there — a new name makes a new server.`);
    }
  }

  async function toggle(row: FleetMcpServer, enabled: boolean) {
    busy[row.name] = true;
    try {
      saved(await saveMcpServer(row.name, row.config, enabled));
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.name];
    }
  }

  async function remove(row: FleetMcpServer) {
    busy[row.name] = true;
    try {
      await removeMcpServer(row.name);
      servers.splice(
        servers.findIndex((other) => other.name === row.name),
        1
      );
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.name];
    }
  }

  async function syncAll() {
    syncing = true;
    try {
      await syncFleet();
      toast.success('Every machine that is online is syncing.');
    } catch (error) {
      toast.error(message(error));
    } finally {
      syncing = false;
    }
  }
</script>

<div class="flex flex-wrap items-start justify-between gap-3">
  <p class="max-w-prose text-caption">
    The MCP servers every machine's Claude Code can reach. Add one here and the hub writes it to the
    machines that are online now, and on the rest as they come back.
  </p>
  <div class="flex shrink-0 items-center gap-2">
    <Button variant="outline" size="sm" disabled={syncing} onclick={syncAll}>
      <IconRefresh class="shrink-0" />
      {syncing ? 'Syncing…' : 'Sync all'}
    </Button>
    <Button size="sm" onclick={() => open(null)}>
      <IconPlus class="shrink-0" />
      Add server
    </Button>
  </div>
</div>

<p class="text-micro text-muted-foreground">
  New sessions pick these up. Running sessions keep the servers they started with — relaunch a
  session to change it.
</p>

{#if error}
  <Alert.Root class={warnAlert}>
    <IconWarningTriangle />
    <Alert.Description class="text-caption text-[var(--warning-11)]">{error}</Alert.Description>
  </Alert.Root>
{:else if servers.length === 0}
  <Card.Root class={panelPad}>
    <h2 class="text-body font-medium">No MCP servers yet</h2>
    <p class="max-w-prose text-caption">
      Add a server and every machine gets it — the quick way is a package name.
    </p>
    <Button size="sm" class="self-start" onclick={() => open(null)}>
      <IconPlus class="shrink-0" />
      Add server
    </Button>
  </Card.Root>
{:else}
  <Card.Root class={panelList}>
   <ul class="flex flex-col">
    {#each servers as row (row.name)}
      <li class="group flex flex-col gap-[var(--space-2)] border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0">
        <div class="flex items-start gap-[var(--space-3)]">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex items-center gap-2">
              <span class="truncate text-caption font-medium text-foreground">{row.name}</span>
              {#if isRemoteMcp(row.config)}
                <Badge variant="outline" class="shrink-0 uppercase">{row.config.type}</Badge>
              {/if}
            </span>
            <span class="truncate font-mono text-micro text-muted-foreground" title={describeMcp(row.config)}>
              {describeMcp(row.config)}
            </span>
          </div>
          <Toggle
            variant="outline"
            size="sm"
            class="h-6 shrink-0 px-2 text-micro font-normal text-muted-foreground
                   aria-pressed:font-medium aria-pressed:text-foreground"
            pressed={row.enabled}
            disabled={busy[row.name] === true}
            onPressedChange={(next) => toggle(row, next)}
            title="A disabled server is taken off the machines, not left switched off"
          >
            {row.enabled ? 'Enabled' : 'Disabled'}
          </Toggle>
          <span class="flex shrink-0 items-center gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:opacity-0">
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              aria-label="Edit {row.name}"
              onclick={() => open(row)}
            >
              <IconPen />
            </Button>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground hover:text-destructive"
                    aria-label="Delete {row.name}"
                    disabled={busy[row.name] === true}
                    onclick={() => remove(row)}
                  >
                    <IconTrash />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Removes it from every machine</Tooltip.Content>
            </Tooltip.Root>
          </span>
        </div>

        {#if machines.length === 0 && settling}
          <Skeleton class="h-5 w-40 rounded-full" />
        {:else if machines.length === 0}
          <span class="text-micro text-muted-foreground">
            No machines yet — this lands on the first one that registers.
          </span>
        {:else}
          <FleetStatusStrip {machines} kind="mcp" name={row.name} what="server" />
        {/if}
      </li>
    {/each}
   </ul>
  </Card.Root>
{/if}

{#if !error}
  <MachineInventory {machines} kind="mcp" taken={servers.map((row) => row.name)} onserver={saved} />
{/if}

<McpServerDialog
  bind:open={composing}
  {editing}
  taken={servers.filter((row) => row.name !== editing?.name).map((row) => row.name)}
  onsaved={saved}
/>

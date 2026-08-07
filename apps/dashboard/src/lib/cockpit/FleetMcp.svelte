<script lang="ts">
  /**
   * The MCP servers every machine's Claude Code should have (NEW.md §11). The
   * rows are the desired state, which the hub owns; the chips under each row are
   * what the machines made of it, off `AgentRow.fleet`. Every write here is one
   * call — the hub fans it out — so nothing on this page loops over machines.
   */
  import { toast } from 'svelte-sonner';
  import type { FleetMcpServer } from '@cockpit/core';
  import { IconPen, IconPlus, IconRefresh, IconTrash } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Machine } from './client.svelte';
  import { describeMcp, isRemoteMcp, removeMcpServer, saveMcpServer, syncFleet } from './fleet';
  import FleetStatusStrip from './FleetStatusStrip.svelte';
  import McpServerDialog from './McpServerDialog.svelte';

  let {
    servers,
    machines,
    settling,
    error,
  }: {
    /** The hub's `mcp` rows, mutated in place as writes land. */
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

  function open(row: FleetMcpServer | null) {
    editing = row;
    composing = true;
  }

  /** A saved row replaces the one it renamed nothing about, or joins the list. */
  function saved(row: FleetMcpServer) {
    const at = servers.findIndex((other) => other.name === row.name);
    if (at === -1) servers.push(row);
    else servers[at] = row;
    // Renaming is really a new server, so the one it was edited from stays until
    // it is deleted — say so rather than leaving two rows to be puzzled over.
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
  <p class="max-w-prose text-[13px] text-muted-foreground">
    The MCP servers every machine's Claude Code can reach. Add one here and the hub writes it to the
    machines that are online now, and to the rest as they come back.
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

<p class="text-xs text-muted-foreground">
  New sessions pick these up. Running sessions keep the servers they started with — relaunch a
  session to change it.
</p>

{#if error}
  <p class="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-warning" role="alert">
    {error}
  </p>
{:else if servers.length === 0}
  <section class="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
    <h2 class="text-sm font-medium">No MCP servers yet</h2>
    <p class="max-w-prose text-[13px] text-muted-foreground">
      Sessions can reach the tools Claude Code ships with, and nothing else. Add a server and every
      machine gets it — the quick way is a package name, which the machines run with
      <span class="font-mono">bunx</span> without installing anything first.
    </p>
  </section>
{:else}
  <ul class="flex flex-col rounded-xl border border-border bg-card">
    {#each servers as row (row.name)}
      <li class="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
        <div class="flex items-start gap-3">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex items-center gap-2">
              <span class="truncate text-[13px] font-medium">{row.name}</span>
              {#if isRemoteMcp(row.config)}
                <span
                  class="shrink-0 rounded-full bg-muted px-2 text-xs text-muted-foreground uppercase"
                >
                  {row.config.type}
                </span>
              {/if}
            </span>
            <span class="truncate font-mono text-xs text-muted-foreground" title={describeMcp(row.config)}>
              {describeMcp(row.config)}
            </span>
          </div>
          <Toggle
            variant="outline"
            size="sm"
            class="h-6 shrink-0 px-2 text-xs font-normal text-muted-foreground
                   aria-pressed:font-medium aria-pressed:text-foreground"
            pressed={row.enabled}
            disabled={busy[row.name] === true}
            onPressedChange={(next) => toggle(row, next)}
            title="A disabled server is taken off the machines, not left switched off"
          >
            {row.enabled ? 'Enabled' : 'Disabled'}
          </Toggle>
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-muted-foreground"
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
                  class="shrink-0 text-muted-foreground hover:text-destructive"
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
        </div>

        {#if machines.length === 0 && settling}
          <Skeleton class="h-5 w-40 rounded-full" />
        {:else if machines.length === 0}
          <span class="text-xs text-muted-foreground">
            No machines yet — this lands on the first one that registers.
          </span>
        {:else}
          <FleetStatusStrip {machines} kind="mcp" name={row.name} what="server" />
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<McpServerDialog
  bind:open={composing}
  {editing}
  taken={servers.filter((row) => row.name !== editing?.name).map((row) => row.name)}
  onsaved={saved}
/>

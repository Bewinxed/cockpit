<script lang="ts">
  /**
   * What a machine really has, fleet or not (NEW.md §11). Everything else on
   * this page is desired state — the hub's rows — and a reader whose Mac is
   * full of skills cockpit never put there was, until this, looking at a page
   * that quietly disagreed with their own `/` menu.
   *
   * Read on the first expand and never stored: a machine's config changes
   * without telling anybody, so a cached answer would be a confident lie.
   */
  import { toast } from 'svelte-sonner';
  import type { ConfigInspection, DiscoveredMcp, DiscoveredSkill, FleetMcpServer, FleetSkillMeta } from '@cockpit/core';
  import { IconChevronDown, IconChevronRight, IconSpinner } from '$lib/icons';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import type { Machine } from './client.svelte';
  import { adoptSkill, inspectMachine, saveMcpServer } from './fleet';
  import { machineLabel } from './machine';

  let {
    machines,
    kind,
    taken,
    onserver,
    onskill,
  }: {
    machines: Machine[];
    /** Which half of the answer this section shows; the read is the same one. */
    kind: 'mcp' | 'skills';
    /** Names the fleet already has, so an adopted one is not offered twice. */
    taken: readonly string[];
    onserver?: (row: FleetMcpServer) => void;
    onskill?: (row: FleetSkillMeta) => void;
  } = $props();

  const online = $derived(machines.filter((machine) => machine.status === 'online'));
  const asleep = $derived(machines.filter((machine) => machine.status !== 'online'));

  let open = $state<Record<string, boolean>>({});
  let found = $state<Record<string, ConfigInspection>>({});
  let reading = $state<Record<string, boolean>>({});
  let unread = $state<Record<string, string>>({});
  let busy = $state<Record<string, boolean>>({});

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** A row's own key: the same name can be a skill of two scopes. */
  const keyOf = (machineId: string, scope: string, name: string) => `${machineId}:${scope}:${name}`;

  async function expand(machine: Machine) {
    open[machine.machineId] = !open[machine.machineId];
    if (!open[machine.machineId] || found[machine.machineId] || reading[machine.machineId]) return;

    reading[machine.machineId] = true;
    delete unread[machine.machineId];
    try {
      found[machine.machineId] = await inspectMachine(machine.machineId);
    } catch (error) {
      unread[machine.machineId] = message(error);
    } finally {
      delete reading[machine.machineId];
    }
  }

  async function adoptServer(machine: Machine, row: DiscoveredMcp) {
    const key = keyOf(machine.machineId, row.scope, row.name);
    busy[key] = true;
    try {
      onserver?.(await saveMcpServer(row.name, row.config, true));
      toast.success(`${row.name} is the fleet's now — every machine gets it.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[key];
    }
  }

  async function adopt(machine: Machine, row: DiscoveredSkill) {
    const key = keyOf(machine.machineId, row.scope, row.name);
    busy[key] = true;
    try {
      onskill?.(await adoptSkill(row.name, machine.machineId));
      toast.success(`${row.name} is the fleet's now — its files went to the hub.`);
    } catch (error) {
      // The machine's own sentence, cap included: a skill too big to carry says so.
      toast.error(message(error));
    } finally {
      delete busy[key];
    }
  }
</script>

<section class="flex flex-col gap-2">
  <h2 class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
    On this machine
  </h2>
  <p class="max-w-prose text-xs text-muted-foreground">
    What each machine really has, whoever put it there — read live, never stored. Anything the
    fleet does not manage can be adopted into it.
  </p>

  {#if online.length === 0}
    <p class="text-[13px] text-muted-foreground">No machine is online to ask.</p>
  {:else}
    <ul class="flex flex-col rounded-xl border border-border bg-card">
      {#each online as machine (machine.machineId)}
        {@const inspection = found[machine.machineId]}
        {@const rows = kind === 'mcp' ? (inspection?.mcp ?? []) : (inspection?.skills ?? [])}
        <li class="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
          <div class="flex flex-wrap items-center gap-3">
            <span class="min-w-0 flex-1 truncate text-[13px] font-medium">
              {machineLabel(machine.hostname)}
            </span>
            <Button
              variant="outline"
              size="xs"
              class="shrink-0"
              aria-expanded={open[machine.machineId] === true}
              onclick={() => expand(machine)}
            >
              {#if open[machine.machineId]}
                <IconChevronDown class="shrink-0" />
              {:else}
                <IconChevronRight class="shrink-0" />
              {/if}
              {open[machine.machineId] ? 'Hide' : 'Show'}
            </Button>
          </div>

          {#if open[machine.machineId]}
            {#if reading[machine.machineId]}
              <p class="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
                <IconSpinner class="size-4 shrink-0 animate-spin" />
                Asking this machine…
              </p>
            {:else if unread[machine.machineId]}
              <p class="text-[13px] text-warning" role="alert">{unread[machine.machineId]}</p>
            {:else if rows.length === 0}
              <p class="text-[13px] text-muted-foreground">
                {kind === 'mcp'
                  ? 'This machine has no MCP servers at all.'
                  : 'This machine has no skills at all.'}
              </p>
            {:else}
              <ul class="flex flex-col rounded-lg border border-border">
                {#each rows as row (`${row.scope}:${row.name}`)}
                  {@const key = keyOf(machine.machineId, row.scope, row.name)}
                  <li class="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-border px-3 py-2 first:border-t-0">
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="truncate font-mono text-[13px]">{row.name}</span>
                        <Badge variant="outline">{row.scope}</Badge>
                        {#if row.managed}
                          <Badge variant="secondary">fleet</Badge>
                        {/if}
                        {#if 'shadowedBy' in row && row.shadowedBy}
                          <Badge variant="outline" class="text-warning">
                            shadowed by {row.shadowedBy}
                          </Badge>
                        {/if}
                      </span>
                      {#if 'description' in row && row.description}
                        <span class="line-clamp-2 text-xs text-muted-foreground">
                          {row.description}
                        </span>
                      {/if}
                    </span>
                    {#if !row.managed && !taken.includes(row.name)}
                      <Button
                        variant="outline"
                        size="xs"
                        class="shrink-0"
                        disabled={busy[key] === true}
                        onclick={() =>
                          kind === 'mcp'
                            ? adoptServer(machine, row as DiscoveredMcp)
                            : adopt(machine, row as DiscoveredSkill)}
                      >
                        {busy[key] ? 'Adopting…' : 'Adopt'}
                      </Button>
                    {:else if taken.includes(row.name) && !row.managed}
                      <span class="shrink-0 pt-0.5 text-xs text-muted-foreground">in the fleet</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if asleep.length > 0}
    <p class="text-xs text-muted-foreground">
      {asleep.map((machine) => machineLabel(machine.hostname)).join(', ')}
      {asleep.length === 1 ? 'is' : 'are'} offline — only a machine that is up can say what it has.
    </p>
  {/if}
</section>

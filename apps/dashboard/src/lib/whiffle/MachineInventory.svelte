<script lang="ts">
  import { toast } from 'svelte-sonner';
  import type { ConfigInspection, DiscoveredMcp, DiscoveredSkill, FleetMcpServer, FleetSkillMeta } from '@whiffle/core';
  import { IconChevronDown, IconChevronRight, IconSpinner } from '$lib/icons';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card } from '$lib/components/ui/card';
  import type { Machine } from './client.svelte';
  import { adoptSkill, inspectMachine, saveMcpServer } from './fleet';
  import { machineLabel } from './machine';

  let { machines, kind, taken, onserver, onskill }: {
    machines: Machine[];
    kind: 'mcp' | 'skills';
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
  const keyOf = (machineId: string, scope: string, name: string) => `${machineId}:${scope}:${name}`;

  async function expand(machine: Machine) {
    open[machine.machineId] = !open[machine.machineId];
    if (!open[machine.machineId] || found[machine.machineId] || reading[machine.machineId]) return;
    reading[machine.machineId] = true; delete unread[machine.machineId];
    try { found[machine.machineId] = await inspectMachine(machine.machineId); }
    catch (error) { unread[machine.machineId] = message(error); }
    finally { delete reading[machine.machineId]; }
  }

  async function adoptServer(machine: Machine, row: DiscoveredMcp) {
    const key = keyOf(machine.machineId, row.scope, row.name); busy[key] = true;
    try { onserver?.(await saveMcpServer(row.name, row.config, true)); toast.success(`${row.name} is the fleet's now — every machine gets it.`); }
    catch (error) { toast.error(message(error)); }
    finally { delete busy[key]; }
  }

  async function adopt(machine: Machine, row: DiscoveredSkill) {
    const key = keyOf(machine.machineId, row.scope, row.name); busy[key] = true;
    try { onskill?.(await adoptSkill(row.name, machine.machineId)); toast.success(`${row.name} is the fleet's now — its files went to the hub.`); }
    catch (error) { toast.error(message(error)); }
    finally { delete busy[key]; }
  }
</script>

<section class="flex flex-col gap-[var(--space-3)]">
  <h2 class="text-micro font-medium tracking-wider text-muted-foreground uppercase">On this machine</h2>
  <p class="max-w-prose text-micro text-muted-foreground">
    What each machine really has, whoever put it there — read live, never stored. Anything the fleet does not manage can be adopted into it.
  </p>

  {#if online.length === 0}
    <p class="text-caption text-muted-foreground">No machine is online to ask.</p>
  {:else}
    <Card class="gap-0 rounded-[var(--radius-panel)] py-0 shadow-md [--card-spacing:var(--space-4)]">
      <ul class="flex flex-col">
        {#each online as machine (machine.machineId)}
          {@const inspection = found[machine.machineId]}
          {@const rows = kind === 'mcp' ? (inspection?.mcp ?? []) : (inspection?.skills ?? [])}
          <li class="flex flex-col gap-[var(--space-2)] border-t border-border p-[var(--space-4)] first:border-t-0">
          <div class="flex flex-wrap items-center gap-[var(--space-3)]">
            <span class="min-w-0 flex-1 truncate text-caption font-medium text-foreground">{machineLabel(machine.hostname)}</span>
            <Button variant="outline" size="xs" class="shrink-0" aria-expanded={open[machine.machineId] === true} onclick={() => expand(machine)}>
              {#if open[machine.machineId]}<IconChevronDown class="shrink-0" />{:else}<IconChevronRight class="shrink-0" />{/if}
              {open[machine.machineId] ? 'Hide' : 'Show'}
            </Button>
          </div>
          {#if open[machine.machineId]}
            {#if reading[machine.machineId]}
              <p class="flex items-center gap-2 text-caption text-muted-foreground" role="status"><IconSpinner class="size-4 shrink-0 animate-spin" />Asking this machine…</p>
            {:else if unread[machine.machineId]}
              <Alert
                class="border-warning/40 bg-warning/10 px-[var(--space-3)] py-[var(--space-2)] text-warning"
              >
                <AlertDescription class="text-warning">{unread[machine.machineId]}</AlertDescription>
              </Alert>
            {:else if rows.length === 0}
              <p class="text-caption text-muted-foreground">{kind === 'mcp' ? 'This machine has no MCP servers at all.' : 'This machine has no skills at all.'}</p>
            {:else}
              <ul class="flex flex-col rounded-[var(--radius-card)] border border-border">
                {#each rows as row (`${row.scope}:${row.name}`)}
                  {@const key = keyOf(machine.machineId, row.scope, row.name)}
                  <li class="flex flex-wrap items-start gap-x-[var(--space-3)] gap-y-[var(--space-1)] border-t border-border px-[var(--space-3)] py-[var(--space-2)] first:border-t-0">
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="truncate font-mono text-caption">{row.name}</span>
                        <Badge variant="outline">{row.scope}</Badge>
                        {#if row.managed}<Badge variant="secondary">fleet</Badge>{/if}
                        {#if 'shadowedBy' in row && row.shadowedBy}<Badge variant="outline" class="text-warning">shadowed by {row.shadowedBy}</Badge>{/if}
                      </span>
                      {#if 'description' in row && row.description}<span class="line-clamp-2 text-micro text-muted-foreground">{row.description}</span>{/if}
                    </span>
                    {#if !row.managed && !taken.includes(row.name)}
                      <Button variant="outline" size="xs" class="shrink-0" disabled={busy[key] === true} onclick={() => kind === 'mcp' ? adoptServer(machine, row as DiscoveredMcp) : adopt(machine, row as DiscoveredSkill)}>
                        {busy[key] ? 'Adopting…' : 'Adopt'}
                      </Button>
                    {:else if taken.includes(row.name) && !row.managed}
                      <span class="shrink-0 pt-0.5 text-micro text-muted-foreground">in the fleet</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </li>
        {/each}
      </ul>
    </Card>
  {/if}

  {#if asleep.length > 0}
    <p class="text-micro text-muted-foreground">
      {asleep.map((machine) => machineLabel(machine.hostname)).join(', ')} {asleep.length === 1 ? 'is' : 'are'} offline — only a machine that is up can say what it has.
    </p>
  {/if}
</section>

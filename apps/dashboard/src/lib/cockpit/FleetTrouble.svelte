<script lang="ts">
  /**
   * What is wrong with the fleet right now, in one place.
   *
   * Every panel below this one answers "what does the fleet carry?". None of
   * them answered "what is broken?", so the answer was spread across five
   * panels, four different renderings of the same fact, and a `title` attribute
   * — and the operator found out from a badge on another page that said
   * `unknown option '--scope'` and nothing else.
   *
   * This panel is the index. It never resolves anything on its own that a panel
   * below already resolves: a drifted memory still sends the reader to the
   * memory panel's compare, because that is where the two copies are. What it
   * owns is the sentence, the attribution, and the retry.
   */
  import { IconCheck, IconWarningTriangle } from '$lib/icons';
  import * as Card from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import type { FleetPlugin, FleetSkillMeta } from '@cockpit/core';
  import { invalidateAll } from '$app/navigation';
  import type { Machine } from './client.svelte';
  import FleetFault from './FleetFault.svelte';
  import { groupFaults, hubFaults, machineFaults } from './fleet-faults';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { machineLabel } from './machine';

  let { machines, skills, plugins, settling }: {
    machines: Machine[];
    skills: FleetSkillMeta[];
    plugins: FleetPlugin[];
    settling: boolean;
  } = $props();

  const faults = $derived([
    ...hubFaults(skills, plugins),
    ...machines.flatMap((machine) => machineFaults(machine.machineId, machine.fleet)),
  ]);
  const groups = $derived(groupFaults(faults));

  /**
   * Machines that have never answered a sync at all. Not a fault with a cause —
   * there is no report to read one out of — but the absence itself is the fact,
   * and a fleet page that shows only the failures it has words for would call
   * this machine healthy.
   */
  const silent = $derived(machines.filter((machine) => machine.fleet === undefined));
  const lastSync = $derived(
    machines
      .filter((machine) => machine.fleet !== undefined)
      .map((machine) => ({ machine, at: machine.fleet!.at }))
      .sort((a, b) => a.at - b.at)
  );

  const panelList =
    'gap-0 overflow-hidden rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-0 shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]';
</script>

<div class="wrap">
  {#if machines.length === 0 && settling}
    <Skeleton class="h-10 w-full rounded-[var(--radius-panel)]" />
  {:else if groups.length === 0 && silent.length === 0}
    <p class="clear">
      <IconCheck class="size-4 shrink-0 text-success" />
      <span>Everything the fleet carries has landed on every machine that has reported.</span>
      {#if lastSync.length > 0}
        {@const oldest = lastSync[0]}
        <span class="age">
          Oldest report: {machineLabel(oldest.machine.hostname)}, {formatDistanceToNow(new Date(oldest.at))}.
        </span>
      {/if}
    </p>
  {:else}
    <Card.Root class={panelList}>
      <ul class="list">
        {#each groups as group (group.origin + group.cause + group.scope + (group.machineId ?? ''))}
          <li><FleetFault {group} {machines} onresolved={() => invalidateAll()} /></li>
        {/each}
        {#each silent as machine (machine.machineId)}
          <li>
            <div class="silent">
              <IconWarningTriangle class="size-4 shrink-0 text-warning" />
              <span class="t">{machineLabel(machine.hostname)} has never reported a sync</span>
              <span class="s">
                It is on the board, so the hub can see it — but nothing has come back about what it
                carries. Treat it as holding none of this, not as up to date.
              </span>
            </div>
          </li>
        {/each}
      </ul>
    </Card.Root>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  .list li {
    border-top: 1px solid var(--border-hairline);
    padding: var(--space-4);
    min-width: 0;
  }
  .list li:first-child {
    border-top: 0;
  }
  .clear {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--ink-strong);
  }
  .clear .age {
    color: var(--ink-muted);
  }
  .silent {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }
  .silent .t {
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .silent .s {
    grid-column: 2;
    max-width: 68ch;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
</style>

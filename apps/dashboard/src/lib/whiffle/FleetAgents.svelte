<script lang="ts">
  import { type FleetAgent, parseAgentFrontMatter } from "@whiffle/core";
  /**
   * Subagents, fleet-wide (NEW.md §11): define one here and it reaches every
   * machine's `~/.claude/agents/` the way a skill reaches every machine's
   * `~/.claude/skills/`.
   *
   * Two sections, because there are two truths: what the fleet keeps, and what
   * the machines really have. The second is read live off disk — a subagent
   * somebody wrote on one machine is invisible until something looks, and
   * adopting it is how it reaches the rest.
   */
  import { toast } from "svelte-sonner";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Alert from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Card from "$lib/components/ui/card";
  import { Skeleton } from "$lib/components/ui/skeleton";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    IconPlus,
    IconSpinner,
    IconTrash,
    IconWarningTriangle,
  } from "$lib/icons";
  import AgentEditor from "./AgentEditor.svelte";
  import type { Machine } from "./client.svelte";
  import { confirm } from "./confirm.svelte";
  import {
    type DiscoveredAgent,
    discoverAgents,
    pushAgents,
    removeAgent,
    saveAgent,
  } from "./fleet";
  import { machineLabel } from "./machine";
  import OsMark from "./OsMark.svelte";

  let {
    agents,
    machines,
    settling,
    error: loadError,
  }: {
    agents: FleetAgent[];
    machines: Machine[];
    settling: boolean;
    error: string | null;
  } = $props();

  const online = $derived(
    machines.filter((machine) => machine.status === "online")
  );

  let editing = $state<FleetAgent | null>(null);
  let open = $state(false);
  async function askForget(row: FleetAgent) {
    const ok = await confirm({
      title: `Remove ${row.name}?`,
      body: "The fleet forgets it. Every machine keeps the file it was already given, and lists it below as unmanaged, until the daemon can take one away itself.",
      confirmLabel: "Remove",
    });
    if (ok) {
      await forget(row);
    }
  }
  let pushing = $state(false);
  let busy = $state<Record<string, boolean>>({});
  let unpushable = $state<Record<string, string>>({});
  let found = $state<Record<string, DiscoveredAgent[]>>({});
  let reading = $state<Record<string, boolean>>({});

  const message = (caught: unknown) =>
    caught instanceof Error ? caught.message : String(caught);

  // Quiet Ledger surfaces (DESIGN.md · mocks/v5-components.html .panel / .callout):
  // a raised panel is --surface-raised at --radius-panel under --shadow-lifted;
  // a warning banner is the callout — --warning-9 edge, --warning-3 tint, --warning-11 ink.
  const panelList =
    "gap-0 overflow-hidden rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-0 shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]";
  const panelPad =
    "gap-[var(--space-3)] rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-[var(--space-6)] shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]";
  const warnAlert =
    "items-center rounded-[var(--radius-control)] border-[var(--warning-9)] bg-[var(--warning-3)] p-[var(--space-3)] [&>svg]:text-[var(--warning-11)]";

  /**
   * Every online machine is asked once, when it appears. Nothing is stored: a
   * discovery is what the disk said at the moment of asking, and a listing kept
   * past that is a listing that lies.
   */
  $effect(() => {
    for (const machine of online) {
      if (found[machine.machineId] || reading[machine.machineId]) {
        continue;
      }
      reading[machine.machineId] = true;
      // biome-ignore lint/complexity/noVoid: fire-and-forget by intent — the effect re-runs per machine, not per promise
      void discoverAgents(machine.machineId)
        .then((rows) => {
          found[machine.machineId] = rows;
        })
        .finally(() => delete reading[machine.machineId]);
    }
  });

  /** Every machine's discovery in one list: the row says which machine it is on. */
  const discovered = $derived(
    online.flatMap((machine) =>
      (found[machine.machineId] ?? []).map((row) => ({ machine, row }))
    )
  );

  function landed(row: FleetAgent) {
    const at = agents.findIndex((other) => other.name === row.name);
    if (at === -1) {
      agents.push(row);
    } else {
      agents[at] = row;
    }
  }

  function edit(agent: FleetAgent | null) {
    editing = agent;
    open = true;
  }

  async function forget(row: FleetAgent) {
    busy[row.name] = true;
    try {
      await removeAgent(row.name);
      agents.splice(
        agents.findIndex((other) => other.name === row.name),
        1
      );
    } catch (caught) {
      toast.error(message(caught));
    } finally {
      delete busy[row.name];
    }
  }

  async function adopt(machineId: string, row: DiscoveredAgent) {
    const key = `${machineId}:${row.name}`;
    busy[key] = true;
    try {
      landed(await saveAgent(row.name, row.content));
      toast.success(`${row.name} is the fleet's now — every machine gets it.`);
    } catch (caught) {
      toast.error(message(caught));
    } finally {
      delete busy[key];
    }
  }

  async function push() {
    pushing = true;
    try {
      ({ unpushable } = await pushAgents());
      const skipped = Object.keys(unpushable).length;
      if (skipped === 0) {
        toast.success("Written to every machine that is online.");
      } else {
        toast.info(
          `${skipped} machine${skipped === 1 ? "" : "s"} could not be written to.`
        );
      }
    } catch (caught) {
      toast.error(message(caught));
    } finally {
      pushing = false;
    }
  }
</script>

<div class="flex flex-wrap items-start justify-between gap-3">
  <p class="max-w-prose text-caption">
    A subagent is a markdown file: front matter, then a body that becomes its
    system prompt. Write one here and it lands in
    <span class="font-mono">~/.claude/agents</span>
    on every machine, which Claude Code re-reads within seconds.
  </p>
  <div class="flex shrink-0 items-center gap-2">
    <Button
      disabled={pushing || agents.length === 0}
      onclick={push}
      size="sm"
      variant="outline"
    >
      {pushing ? 'Pushing…' : 'Push to machines'}
    </Button>
    <Button onclick={() => edit(null)} size="sm">
      <IconPlus class="shrink-0" />
      Add subagent
    </Button>
  </div>
</div>

{#if loadError}
  <Alert.Root class={warnAlert}>
    <IconWarningTriangle />
    <Alert.Description class="text-caption text-[var(--warning-11)]"
      >{loadError}</Alert.Description
    >
  </Alert.Root>
{:else}
  <section class="flex flex-col gap-3">
    <h2
      class="text-micro font-medium tracking-wider text-muted-foreground uppercase"
    >
      Fleet subagents
    </h2>
    {#if agents.length === 0}
      <Card.Root class={panelPad}>
        <p class="text-caption">
          None yet. Write one, or adopt one a machine already has from the list
          below.
        </p>
        <Button class="self-start" onclick={() => edit(null)} size="sm">
          <IconPlus class="shrink-0" />
          Add subagent
        </Button>
      </Card.Root>
    {:else}
      <Card.Root class={panelList}>
        <ul class="flex flex-col">
          {#each agents as row (row.name)}
            {@const front = parseAgentFrontMatter(row.content)}
            <li
              class="group flex items-start gap-[var(--space-3)] border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0"
            >
              <button
                class="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                onclick={() => edit(row)}
                type="button"
              >
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="truncate font-mono text-caption text-foreground"
                    >{row.name}</span
                  >
                  {#if front.model && front.model !== 'inherit'}
                    <Badge variant="outline">{front.model}</Badge>
                  {/if}
                  {#if front.tools}
                    <Badge variant="outline">{front.tools.length} tools</Badge>
                  {/if}
                  {#if front.effort}
                    <Badge variant="outline">{front.effort} effort</Badge>
                  {/if}
                </span>
                {#if front.description}
                  <span class="line-clamp-1 text-micro text-muted-foreground"
                    >{front.description}</span
                  >
                {/if}
              </button>
              <Button
                class="shrink-0"
                onclick={() => edit(row)}
                size="xs"
                variant="outline"
                >Edit</Button
              >
              <span class="shrink-0">
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        aria-label="Remove {row.name}"
                        class="text-muted-foreground hover:text-destructive"
                        disabled={busy[row.name] === true}
                        onclick={() => askForget(row)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <IconTrash />
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    >Forgets it here; the machines keep their
                    copies</Tooltip.Content
                  >
                </Tooltip.Root>
              </span>
            </li>
          {/each}
        </ul>
      </Card.Root>
    {/if}
    {#each Object.entries(unpushable) as [machineId, why] (machineId)}
      {@const machine = machines.find((row) => row.machineId === machineId)}
      <p class="text-micro text-muted-foreground">
        {machine ? machineLabel(machine.hostname) : machineId}
        — {why}.
      </p>
    {/each}
  </section>

  <section class="flex flex-col gap-3">
    <h2
      class="text-micro font-medium tracking-wider text-muted-foreground uppercase"
    >
      On machines
    </h2>
    <p class="max-w-prose text-micro text-muted-foreground">
      The definition files each machine really has, read live off its disk. One
      the fleet does not keep can be adopted into it, and every other machine
      gets it.
    </p>

    {#if online.length === 0 && settling}
      <Skeleton class="h-16 w-full rounded-[var(--radius-panel)]" />
    {:else if online.length === 0}
      <p class="text-caption text-muted-foreground">
        No machine is online to ask.
      </p>
    {:else if discovered.length === 0}
      {#if Object.keys(reading).length > 0}
        <p
          class="flex items-center gap-2 text-caption text-muted-foreground"
          role="status"
        >
          <IconSpinner class="size-4 shrink-0 animate-spin" />
          Asking the machines…
        </p>
      {:else}
        <p class="text-caption text-muted-foreground">
          No machine has any subagent files yet.
        </p>
      {/if}
    {:else}
      <Card.Root class={panelList}>
        <ul class="flex flex-col">
          {#each discovered as { machine, row } (`${machine.machineId}:${row.path}`)}
            {@const stored = agents.find((other) => other.name === row.name)}
            {@const key = `${machine.machineId}:${row.name}`}
            <li
              class="flex flex-wrap items-start gap-x-[var(--space-3)] gap-y-1 border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="truncate font-mono text-caption text-foreground"
                    >{row.name}</span
                  >
                  <span
                    class="flex shrink-0 items-center gap-1 text-micro text-muted-foreground"
                  >
                    <OsMark class="size-3.5" os={machine.os} />
                    {machineLabel(machine.hostname)}
                  </span>
                </span>
                {#if row.description}
                  <span class="line-clamp-1 text-micro text-muted-foreground"
                    >{row.description}</span
                  >
                {/if}
              </span>
              {#if stored && stored.content === row.content}
                <span class="shrink-0 pt-0.5 text-micro text-muted-foreground"
                  >managed &middot; in sync</span
                >
              {:else if stored}
                <span class="shrink-0 pt-0.5 text-micro text-warning"
                  >managed &middot; differs</span
                >
                <Button
                  class="shrink-0"
                  disabled={busy[key] === true}
                  onclick={() => adopt(machine.machineId, row)}
                  size="xs"
                  variant="outline"
                >
                  {busy[key] ? 'Adopting…' : 'Adopt this copy'}
                </Button>
              {:else}
                <Button
                  class="shrink-0"
                  disabled={busy[key] === true}
                  onclick={() => adopt(machine.machineId, row)}
                  size="xs"
                  variant="outline"
                >
                  {busy[key] ? 'Adopting…' : 'Adopt'}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      </Card.Root>
    {/if}
  </section>
{/if}

<AgentEditor agent={editing} onsaved={landed} bind:open />

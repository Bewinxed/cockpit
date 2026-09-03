<script lang="ts">
  /**
   * One row's convergence, machine by machine: the chip says whether this
   * machine has the thing, the popover says what happened if it does not.
   *
   * The popover used to be a sentence and a `<pre>` of whatever the machine
   * said last. That is what put `unknown option '--scope'` in front of the
   * operator with no cause, no binary and no next step, so what a failure opens
   * now is {@link FleetFault} — the same reading, the same remedy and the same
   * retry the "Needs attention" panel shows, rather than a second, poorer copy
   * of them.
   */
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Popover from "$lib/components/ui/popover";
  import {
    IconCheck,
    IconInfo,
    IconRefresh,
    IconWarningTriangle,
  } from "$lib/icons";
  import type { Machine } from "./client.svelte";
  import FleetFault from "./FleetFault.svelte";
  import { syncFleet } from "./fleet";
  import { causeOf, type FaultScope } from "./fleet-faults";
  import { machineLabel, machineOs } from "./machine";
  import OsMark from "./OsMark.svelte";

  let {
    machines,
    kind,
    name,
    what,
  }: {
    machines: Machine[];
    /** Which record of the machine's report this row lives in. */
    kind: Extract<
      FaultScope,
      "mcp" | "marketplaces" | "plugins" | "skills" | "memoryDocs" | "hooks"
    >;
    name: string;
    what: string;
  } = $props();

  const CHIP =
    "inline-flex min-h-5 max-w-36 items-center gap-1 rounded-full px-2 text-micro transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  let asked = $state<Record<string, boolean>>({});

  function toneFor(state: string | undefined): string {
    if (state === "applied") {
      return "text-success hover:bg-success/10";
    }
    if (state === "failed") {
      return "bg-warning/10 text-warning hover:bg-warning/20";
    }
    return "text-faint hover:bg-muted";
  }

  async function resync(machine: Machine) {
    asked[machine.machineId] = true;
    try {
      await syncFleet(machine.machineId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      delete asked[machine.machineId];
    }
  }
</script>

<div class="flex flex-wrap items-center gap-1">
  {#each machines as machine (machine.machineId)}
    {@const item = machine.fleet?.[kind]?.[name]}
    {@const online = machine.status === 'online'}
    {@const os = machineOs(machine.os)}
    {@const tone = toneFor(item?.state)}
    <Popover.Root>
      <Popover.Trigger
        aria-label="{machineLabel(machine.hostname)}: {item?.state ?? 'not reported'}"
        class="{CHIP} {tone} {online ? '' : 'opacity-50'}"
      >
        {#if item?.state === 'applied'}
          <IconCheck class="size-3 shrink-0" />
        {:else if item?.state === 'failed'}
          <IconWarningTriangle class="size-3 shrink-0" />
        {/if}
        <OsMark class="size-3.5 shrink-0" os={machine.os} />
        <span class="truncate">{machineLabel(machine.hostname)}</span>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        class="w-96 max-w-[calc(100vw-2rem)] rounded-[var(--radius-panel)] p-0 shadow-xl"
      >
        <header
          class="flex items-baseline gap-2 border-b border-border px-3 py-2"
        >
          <span class="truncate text-caption font-medium text-foreground"
            >{machineLabel(machine.hostname)}</span
          >
          <span class="ml-auto shrink-0 text-micro text-muted-foreground"
            >{os.label}{online ? '' : ' · offline'}</span
          >
        </header>
        <div class="flex flex-col gap-2 px-3 py-2">
          {#if item?.state === 'failed'}
            <FleetFault
              group={{
                origin: 'machine',
                cause: causeOf(item.detail),
                scope: kind,
                machineId: machine.machineId,
                faults: [{ origin: 'machine', scope: kind, key: name, machineId: machine.machineId, detail: item.detail, cause: causeOf(item.detail) }],
              }}
              {machines}
            />
          {:else}
            <p class="text-caption">
              {#if item?.state === 'applied'}
                This machine has the {what}.
              {:else if item?.state === 'removed'}
                The {what} was taken off this machine.
              {:else}
                This machine has not reported on the {what} yet.
              {/if}
            </p>
            <!-- A detail on a row that did NOT fail is a note, not an error: the
                 sync went through and the machine has something to add (a runner
                 that is not on its PATH yet, a copy it kept). It used to be an
                 unlabelled `<pre>` under a green tick, which reads as neither. -->
            {#if item?.detail}
              <p
                class="flex items-start gap-1.5 text-micro text-muted-foreground"
              >
                <IconInfo class="mt-px size-3.5 shrink-0" />
                <span class="font-mono">{item.detail}</span>
              </p>
            {/if}
            <Button
              class="self-start"
              disabled={!online || asked[machine.machineId] === true}
              onclick={() => resync(machine)}
              size="xs"
              variant="outline"
            >
              <IconRefresh class="shrink-0" />
              {asked[machine.machineId] ? 'Syncing…' : 'Sync this machine'}
            </Button>
            {#if !online}
              <p class="text-micro text-muted-foreground">
                It syncs on its own the moment it comes back.
              </p>
            {/if}
          {/if}
        </div>
      </Popover.Content>
    </Popover.Root>
  {/each}
</div>

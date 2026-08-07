<script lang="ts">
  /**
   * What one desired entry came to on every machine (NEW.md §11) — one chip
   * each, straight off `AgentRow.fleet`, which rides every `instances` frame.
   * Nothing here is stored or polled: a sync started on another device paints
   * here too, and a machine that is offline shows the last thing it said
   * rather than a guess about now.
   */
  import { toast } from 'svelte-sonner';
  import { IconCheck, IconRefresh, IconWarningTriangle } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import type { Machine } from './client.svelte';
  import { syncFleet } from './fleet';
  import { machineLabel, machineOs } from './machine';

  let {
    machines,
    kind,
    name,
    what,
  }: {
    machines: Machine[];
    kind: 'mcp' | 'marketplaces' | 'plugins' | 'skills';
    name: string;
    /** What to call the entry in the popover — "server", "plugin", "skill". */
    what: string;
  } = $props();

  const CHIP =
    'inline-flex min-h-5 max-w-36 items-center gap-1 rounded-full px-2 text-xs transition-colors' +
    ' focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  /** Machines this browser has asked to re-sync, so the button cannot be double-clicked. */
  let asked = $state<Record<string, boolean>>({});

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
    {@const tone =
      item?.state === 'applied'
        ? 'text-success hover:bg-success/10'
        : item?.state === 'failed'
          ? 'bg-warning/10 text-warning hover:bg-warning/20'
          : 'text-muted-foreground/80 hover:bg-muted'}
    <Popover.Root>
      <Popover.Trigger
        class="{CHIP} {tone} {online ? '' : 'opacity-50'}"
        aria-label="{machineLabel(machine.hostname)}: {item?.state ?? 'not reported'}"
      >
        {#if item?.state === 'applied'}
          <IconCheck class="size-3 shrink-0" />
        {:else if item?.state === 'failed'}
          <IconWarningTriangle class="size-3 shrink-0" />
        {/if}
        <span class="truncate">{machineLabel(machine.hostname)}</span>
      </Popover.Trigger>
      <Popover.Content class="w-80 p-0" align="start">
        <header class="flex items-baseline gap-2 border-b border-border px-3 py-2">
          <span class="truncate text-[13px] font-medium">{machineLabel(machine.hostname)}</span>
          <span class="ml-auto shrink-0 text-xs text-muted-foreground">
            {os.label}{online ? '' : ' · offline'}
          </span>
        </header>
        <div class="flex flex-col gap-2 px-3 py-2">
          <p class="text-[13px]">
            {#if item?.state === 'applied'}
              This machine has the {what}.
            {:else if item?.state === 'failed'}
              This machine could not apply the {what}.
            {:else if item?.state === 'removed'}
              The {what} was taken off this machine.
            {:else}
              This machine has not reported on the {what} yet.
            {/if}
          </p>
          {#if item?.detail}
            <!-- Verbatim: the tail of what the write or the CLI said, which is
                 the whole of what there is to know. -->
            <pre
              class="max-h-40 overflow-auto rounded-lg bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap">{item.detail}</pre>
          {/if}
          <Button
            variant="outline"
            size="xs"
            class="self-start"
            disabled={!online || asked[machine.machineId] === true}
            onclick={() => resync(machine)}
          >
            <IconRefresh class="shrink-0" />
            {asked[machine.machineId] ? 'Syncing…' : 'Sync this machine'}
          </Button>
          {#if !online}
            <p class="text-xs text-muted-foreground">
              It syncs on its own the moment it comes back.
            </p>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Root>
  {/each}
</div>

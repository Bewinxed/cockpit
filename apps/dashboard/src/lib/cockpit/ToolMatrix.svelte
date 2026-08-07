<script lang="ts">
  /**
   * The fleet's workflow CLIs (NEW.md §10): every machine against every tool the
   * hub carries, one chip per cell. The switch in a column header is the whole
   * point — the hub installs a required tool wherever a register finds it
   * missing, including on the machines that come back tomorrow — and the buttons
   * in the cells are for the one machine in front of you.
   *
   * Nothing here is stored: the chips are `AgentRow.tools`, which rides every
   * `instances` frame, so an install started on another device paints here too.
   */
  import { toast } from 'svelte-sonner';
  import type { ToolPolicy, ToolSpec } from '@cockpit/core';
  import { IconCheck, IconExternal, IconSpinner, IconWarningTriangle } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Machine } from './client.svelte';
  import { machineLabel, machineOs } from './machine';
  import { installTool, policyFor, setPolicy } from './tools';

  let {
    machines,
    settling,
    catalog,
    policies,
    error,
  }: {
    machines: Machine[];
    /** The machines arrive a beat after the page paints; nothing is said until then. */
    settling: boolean;
    catalog: ToolSpec[];
    policies: ToolPolicy[];
    error: string | null;
  } = $props();

  /** One status chip's shell — the same shape whatever the chip has to say. */
  const CHIP = 'inline-flex min-h-6 items-center gap-1.5 rounded-full px-2 text-xs';

  /**
   * A tool that exists only to satisfy a `requires` gets no column of its own.
   * It still shows up where it matters: in the `detail` of whatever was waiting
   * on it, which names the version it found.
   */
  const columns = $derived(catalog.filter((spec) => !spec.dependencyOnly));

  /** Policies this page has written, over the load's word on the rest. */
  let written = $state<Record<string, ToolPolicy>>({});
  const policyOf = (spec: ToolSpec): ToolPolicy => written[spec.id] ?? policyFor(policies, spec.id);

  /** Tools whose policy PUT is out, and cells whose install this browser asked for. */
  let saving = $state<Record<string, boolean>>({});
  let asked = $state<Record<string, boolean>>({});

  const cellKey = (machineId: string, toolId: string): string => `${machineId}:${toolId}`;

  const installedOn = (spec: ToolSpec): number =>
    machines.filter((machine) => machine.tools?.[spec.id]?.state === 'installed').length;

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  async function install(machine: Machine, spec: ToolSpec) {
    const key = cellKey(machine.machineId, spec.id);
    // The hub marks the cell `installing` and publishes as the control goes
    // past, but a frame is not instant and a button that sits there gets
    // clicked twice.
    asked[key] = true;
    try {
      await installTool(machine.machineId, spec.id, policyOf(spec).pinnedVersion);
    } catch (error) {
      toast.error(`${spec.name} on ${machineLabel(machine.hostname)}: ${message(error)}`);
    } finally {
      delete asked[key];
    }
  }

  async function requireEverywhere(spec: ToolSpec, required: boolean) {
    saving[spec.id] = true;
    try {
      written[spec.id] = await setPolicy(spec.id, { required });
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete saving[spec.id];
    }
  }
</script>

{#snippet cell(machine: Machine, spec: ToolSpec, online: boolean)}
  {@const status = machine.tools?.[spec.id]}
  {@const pending = asked[cellKey(machine.machineId, spec.id)] === true}
  {@const shown = pending ? 'installing' : (status?.state ?? 'unknown')}

  {#if shown === 'installed'}
    <span class="flex items-center gap-1">
      <span class="{CHIP} text-success">
        <IconCheck class="size-3.5 shrink-0" />
        <span class="font-mono">{status?.version ?? '—'}</span>
      </span>
      <!-- Re-running the installer is also how a tool is upgraded, so it is
           always offered — quietly, because it is rarely what you came for.
           The reveal is on the wrapper, not the button: a disabled button
           carries a dimming of its own, and the two would fight. -->
      <span
        class="transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 md:opacity-0"
      >
        <Button
          variant="ghost"
          size="xs"
          class="text-muted-foreground"
          disabled={!online}
          onclick={() => install(machine, spec)}
        >
          Reinstall
        </Button>
      </span>
    </span>
  {:else if shown === 'installing'}
    <span class="{CHIP} text-muted-foreground">
      <IconSpinner class="size-3.5 shrink-0 animate-spin" />
      Installing…
    </span>
  {:else if shown === 'missing'}
    <Button variant="outline" size="xs" disabled={!online} onclick={() => install(machine, spec)}>
      Install
    </Button>
  {:else if shown === 'failed'}
    <span class="flex items-center gap-1">
      <Popover.Root>
        <Popover.Trigger
          class="{CHIP} bg-warning/10 text-warning transition-colors hover:bg-warning/20
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Why {spec.name} did not install on {machineLabel(machine.hostname)}"
        >
          <IconWarningTriangle class="size-3.5 shrink-0" />
          Failed
        </Popover.Trigger>
        <Popover.Content class="w-96 p-0" align="start">
          <header class="flex items-baseline gap-2 border-b border-border px-3 py-2">
            <span class="text-[13px] font-medium">{spec.name} did not install</span>
            {#if status?.method}
              <span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {status.method}
              </span>
            {/if}
          </header>
          <pre
            class="max-h-56 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">{status?.detail ??
              'The machine did not say why.'}</pre>
        </Popover.Content>
      </Popover.Root>
      <Button
        variant="ghost"
        size="xs"
        class="text-muted-foreground"
        disabled={!online}
        onclick={() => install(machine, spec)}
      >
        Retry
      </Button>
    </span>
  {:else if shown === 'unsupported'}
    <Popover.Root>
      <Popover.Trigger
        class="{CHIP} text-muted-foreground transition-colors hover:bg-muted
               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Why {spec.name} cannot run on {machineLabel(machine.hostname)}"
      >
        Unsupported
      </Popover.Trigger>
      <Popover.Content class="w-80" align="start">
        <!-- Verbatim: the daemon names the prerequisite and the version it
             found, which is the whole of what there is to know. -->
        <p class="font-mono text-xs">
          {status?.detail ?? 'no install method for this platform'}
        </p>
      </Popover.Content>
    </Popover.Root>
  {:else}
    <span class="flex items-center gap-1">
      <Tooltip.Root>
        <Tooltip.Trigger class="{CHIP} text-muted-foreground/70">Unknown</Tooltip.Trigger>
        <Tooltip.Content>The daemon has not reported this tool</Tooltip.Content>
      </Tooltip.Root>
      <!-- Offered outright, unlike the reinstall: nobody knows what is on this
           machine, so installing is a reasonable thing to want. -->
      <Button
        variant="ghost"
        size="xs"
        class="text-muted-foreground"
        disabled={!online}
        onclick={() => install(machine, spec)}
      >
        Install
      </Button>
    </span>
  {/if}
{/snippet}

<p class="max-w-prose text-[13px] text-muted-foreground">
  The workflow CLIs your machines carry. Require one on every machine and the hub puts it there — on
  the machines that are online now, and on the rest as they come back.
</p>

{#if error}
  <p class="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-warning" role="alert">
    {error}
  </p>
{:else if columns.length === 0}
  <p class="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
    The hub's catalog is empty, so there is nothing to install yet.
  </p>
{:else if machines.length === 0 && settling}
  <div
    class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    role="status"
    aria-label="Reading the fleet"
  >
    {#each [0, 1, 2] as row (row)}
      <div class="flex items-center gap-6">
        <Skeleton class="h-4 w-40 rounded-md" />
        {#each columns as spec (spec.id)}
          <Skeleton class="h-4 w-20 rounded-md" />
        {/each}
      </div>
    {/each}
  </div>
{:else if machines.length === 0}
  <section class="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
    <h2 class="text-sm font-medium">No machines yet</h2>
    <p class="text-[13px] text-muted-foreground">
      Tools are installed on your own hardware, never on a server of ours — so this stays empty until
      a machine says it is here. Start the agent daemon on one, pointed at this hub, and it reports
      what it already has the moment it registers.
    </p>
    <pre
      class="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">COCKPIT_HUB_URL=ws://&lt;this-host&gt;:3456/ws bun run agent</pre>
  </section>
{:else}
  <div class="overflow-x-auto rounded-xl border border-border bg-card">
    <table class="w-full border-collapse text-left">
      <thead>
        <tr class="align-top">
          <th
            scope="col"
            class="sticky left-0 z-10 bg-card px-3 py-2 text-xs font-medium tracking-wider
                   text-muted-foreground uppercase"
          >
            Machine
          </th>
          {#each columns as spec (spec.id)}
            {@const policy = policyOf(spec)}
            <th scope="col" class="min-w-56 border-l border-border px-3 py-2 font-normal">
              <div class="flex flex-col items-start gap-1.5">
                <span class="flex items-center gap-1.5">
                  <span class="text-[13px] font-medium">{spec.name}</span>
                  <a
                    href={spec.homepage}
                    target="_blank"
                    rel="noreferrer"
                    class="text-muted-foreground transition-colors hover:text-foreground"
                    title={spec.homepage}
                    aria-label="{spec.name} homepage"
                  >
                    <IconExternal class="size-3" />
                  </a>
                </span>
                <span class="text-xs tabular-nums text-muted-foreground">
                  {installedOn(spec)}/{machines.length} installed
                </span>
                <!-- The one click: the hub reads this on every register, so
                     turning it on covers the machines that are not here. -->
                <Toggle
                  variant="outline"
                  size="sm"
                  class="h-6 gap-1 px-2 text-xs font-normal text-muted-foreground
                         aria-pressed:font-medium aria-pressed:text-foreground"
                  pressed={policy.required}
                  disabled={saving[spec.id] === true}
                  onPressedChange={(next) => requireEverywhere(spec, next)}
                  title="Install {spec.name} on every machine, now and whenever one registers"
                >
                  {#if policy.required}
                    <IconCheck class="size-3 shrink-0" />
                  {/if}
                  Required on every machine
                </Toggle>
              </div>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each machines as machine (machine.machineId)}
          {@const os = machineOs(machine.os)}
          {@const online = machine.status === 'online'}
          <tr class={online ? '' : 'opacity-60'}>
            <th
              scope="row"
              class="sticky left-0 z-10 border-t border-border bg-card px-3 py-2 font-normal"
            >
              <span class="flex items-center gap-2">
                <os.Icon class="size-4 shrink-0 text-muted-foreground" />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-[13px] font-medium">
                    {machineLabel(machine.hostname)}
                  </span>
                  <!-- Offline is said, not only dimmed: the chips below are
                       the last thing this machine reported, not what it is. -->
                  <span class="text-xs text-muted-foreground">
                    {os.label}{online ? '' : ' · offline'}
                  </span>
                </span>
              </span>
            </th>
            {#each columns as spec (spec.id)}
              <td class="group/cell border-t border-l border-border px-3 py-2">
                {@render cell(machine, spec, online)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

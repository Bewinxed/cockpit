<script lang="ts">
  import type { ToolPolicy, ToolSpec } from "@whiffle/core";
  import { toast } from "svelte-sonner";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import * as Popover from "$lib/components/ui/popover";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Switch } from "$lib/components/ui/switch";
  import * as Table from "$lib/components/ui/table";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { IconCheck, IconExternal, IconSpinner } from "$lib/icons";
  import type { Machine } from "./client.svelte";
  import { machineLabel, machineOs } from "./machine";
  import OsMark from "./OsMark.svelte";
  import { installTool, policyFor, setPolicy } from "./tools";

  let {
    machines,
    settling,
    catalog,
    policies,
    error,
  }: {
    machines: Machine[];
    settling: boolean;
    catalog: ToolSpec[];
    policies: ToolPolicy[];
    error: string | null;
  } = $props();

  const CHIP = "h-auto min-h-6 gap-1.5 px-2";
  const columns = $derived(catalog.filter((spec) => !spec.dependencyOnly));
  let written = $state<Record<string, ToolPolicy>>({});
  const policyOf = (spec: ToolSpec): ToolPolicy =>
    written[spec.id] ?? policyFor(policies, spec.id);
  let saving = $state<Record<string, boolean>>({});
  let asked = $state<Record<string, boolean>>({});
  const cellKey = (machineId: string, toolId: string): string =>
    `${machineId}:${toolId}`;
  const installedOn = (spec: ToolSpec): number =>
    machines.filter(
      (machine) => machine.tools?.[spec.id]?.state === "installed"
    ).length;
  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  async function install(machine: Machine, spec: ToolSpec) {
    const key = cellKey(machine.machineId, spec.id);
    asked[key] = true;
    try {
      await installTool(
        machine.machineId,
        spec.id,
        policyOf(spec).pinnedVersion
      );
    } catch (error) {
      toast.error(
        `${spec.name} on ${machineLabel(machine.hostname)}: ${message(error)}`
      );
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
    <span class="flex items-center gap-[var(--space-1)]">
      <Badge class="{CHIP} text-success" variant="ghost">
        <IconCheck class="size-3.5 shrink-0" />
        <span class="font-mono tabular-nums">{status?.version ?? '—'}</span>
      </Badge>
      <span
        class="transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 md:opacity-0"
      >
        <Button
          class="text-muted-foreground"
          disabled={!online}
          onclick={() => install(machine, spec)}
          size="xs"
          variant="ghost"
        >
          Reinstall
        </Button>
      </span>
    </span>
  {:else if shown === 'installing'}
    <Badge class="{CHIP} text-muted-foreground" variant="ghost">
      <IconSpinner class="size-3.5 shrink-0 animate-spin" />
      Installing…
    </Badge>
  {:else if shown === 'missing'}
    <Button
      disabled={!online}
      onclick={() => install(machine, spec)}
      size="xs"
      variant="outline"
      >Install</Button
    >
  {:else if shown === 'failed'}
    <span class="flex items-center gap-[var(--space-1)]">
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Badge
              {...props}
              aria-label="Why {spec.name} did not install on {machineLabel(machine.hostname)}"
              class="{CHIP} cursor-pointer"
              variant="destructive"
            >
              <span class="size-2 shrink-0 rounded-full bg-error"></span>
              Failed
            </Badge>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content
          align="start"
          class="w-96 rounded-[var(--radius-panel)] p-0 shadow-xl"
        >
          <header
            class="flex items-baseline gap-[var(--space-1)] border-b border-border px-[var(--space-3)] py-[var(--space-2)]"
          >
            <span class="text-caption font-medium text-foreground"
              >{spec.name}
              did not install</span
            >
            {#if status?.method}
              <span
                class="ml-auto shrink-0 font-mono text-micro text-muted-foreground"
                >{status.method}</span
              >
            {/if}
          </header>
          <pre
            class="max-h-56 overflow-auto px-[var(--space-3)] py-[var(--space-2)] font-mono text-micro whitespace-pre-wrap"
          >{status?.detail ?? 'The machine did not say why.'}</pre>
          <footer
            class="border-t border-border px-[var(--space-3)] py-[var(--space-2)]"
          >
            <Button
              disabled={!online}
              onclick={() => install(machine, spec)}
              size="xs"
              variant="outline"
              >Retry</Button
            >
          </footer>
        </Popover.Content>
      </Popover.Root>
      <Button
        class="text-muted-foreground"
        disabled={!online}
        onclick={() => install(machine, spec)}
        size="xs"
        variant="ghost"
        >Retry</Button
      >
    </span>
  {:else if shown === 'unsupported'}
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Badge
            {...props}
            aria-label="Why {spec.name} cannot run on {machineLabel(machine.hostname)}"
            class="{CHIP} cursor-pointer text-muted-foreground"
            variant="ghost"
          >
            Unsupported
          </Badge>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content
        align="start"
        class="w-80 rounded-[var(--radius-panel)] shadow-xl"
      >
        <p class="font-mono text-micro">
          {status?.detail ?? 'no install method for this platform'}
        </p>
      </Popover.Content>
    </Popover.Root>
  {:else}
    <span class="flex items-center gap-[var(--space-1)]">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Badge {...props} class="{CHIP} text-faint" variant="ghost"
              >Unknown</Badge
            >
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>The daemon has not reported this tool</Tooltip.Content>
      </Tooltip.Root>
      <Button
        class="text-muted-foreground"
        disabled={!online}
        onclick={() => install(machine, spec)}
        size="xs"
        variant="ghost"
        >Install</Button
      >
    </span>
  {/if}
{/snippet}

<p class="max-w-prose text-caption">
  The workflow CLIs your machines carry. Require one on every machine and the
  hub puts it there — on the machines that are online now, and on the rest as
  they come back.
</p>

{#if error}
  <Alert class="border-warning/40 bg-warning/10 text-warning">
    <AlertDescription class="text-warning">{error}</AlertDescription>
  </Alert>
{:else if columns.length === 0}
  <Card class="rounded-[var(--radius-panel)] p-[var(--space-6)] shadow-md">
    <p class="text-body text-muted-foreground">
      The hub's catalog is empty, so there is nothing to install yet.
    </p>
  </Card>
{:else if machines.length === 0 && settling}
  <Card
    aria-label="Reading the fleet"
    class="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-panel)] p-[var(--space-6)] shadow-md"
    role="status"
  >
    {#each [0, 1, 2] as row (row)}
      <div class="flex items-center gap-[var(--space-6)]">
        <Skeleton class="h-4 w-40 rounded-[var(--radius-mark)]" />
        {#each columns as spec (spec.id)}
          <Skeleton class="h-4 w-20 rounded-[var(--radius-mark)]" />
        {/each}
      </div>
    {/each}
  </Card>
{:else if machines.length === 0}
  <Card
    class="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-panel)] p-[var(--space-6)] shadow-md"
  >
    <h2 class="text-body font-medium">No machines yet</h2>
    <p class="text-caption">
      Tools are installed on your own hardware, never on a server of ours — so
      this stays empty until a machine says it is here. Start the agent daemon
      on one, pointed at this hub, and it reports what it already has the moment
      it registers.
    </p>
    <pre
      class="overflow-x-auto rounded-[var(--radius-well)] bg-muted px-[var(--space-3)] py-[var(--space-2)] font-mono text-micro"
    >WHIFFLE_HUB_URL=ws://&lt;this-host&gt;:3456/ws whiffle up</pre>
  </Card>
{:else}
  <Card
    class="gap-0 overflow-hidden rounded-[var(--radius-panel)] py-0 shadow-md"
  >
    <Table.Root class="border-collapse text-left">
      <Table.Header>
        <Table.Row class="align-top hover:bg-transparent">
          <Table.Head
            class="sticky left-0 z-10 h-auto bg-card px-[var(--space-4)] py-[var(--space-3)] text-micro font-medium tracking-wider text-muted-foreground uppercase"
            scope="col"
            >Machine</Table.Head
          >
          {#each columns as spec (spec.id)}
            {@const policy = policyOf(spec)}
            <Table.Head
              class="h-auto min-w-56 border-l border-border px-[var(--space-4)] py-[var(--space-3)] font-normal whitespace-normal"
              scope="col"
            >
              <div class="flex flex-col items-start gap-[var(--space-2)]">
                <span class="flex items-center gap-1.5">
                  <span class="text-caption font-medium text-foreground"
                    >{spec.name}</span
                  >
                  <a
                    aria-label="{spec.name} homepage"
                    class="text-muted-foreground transition-colors hover:text-foreground"
                    href={spec.homepage}
                    rel="noreferrer"
                    target="_blank"
                    title={spec.homepage}
                  >
                    <IconExternal class="size-3" />
                  </a>
                </span>
                <span class="text-micro tabular-nums text-muted-foreground"
                  >{installedOn(spec)}/{machines.length}
                  installed</span
                >
                <label
                  class="flex items-center gap-[var(--space-2)] text-micro text-muted-foreground"
                >
                  <Switch
                    checked={policy.required}
                    disabled={saving[spec.id] === true}
                    onCheckedChange={(next) => requireEverywhere(spec, next)}
                    size="sm"
                  />
                  Required on every machine
                </label>
              </div>
            </Table.Head>
          {/each}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each machines as machine (machine.machineId)}
          {@const os = machineOs(machine.os)}
          {@const online = machine.status === 'online'}
          <Table.Row class={online ? '' : 'opacity-50'}>
            <Table.Head
              class="sticky left-0 z-10 h-auto bg-card px-[var(--space-4)] py-[var(--space-2)] font-normal"
              scope="row"
            >
              <span class="flex items-center gap-[var(--space-2)]">
                <OsMark
                  class="size-4 shrink-0 text-muted-foreground"
                  os={machine.os}
                />
                <span class="flex min-w-0 flex-col">
                  <span class="flex items-center gap-[var(--space-2)]">
                    <span
                      class="truncate text-caption font-medium text-foreground"
                      >{machineLabel(machine.hostname)}</span
                    >
                    <span
                      class="size-2 shrink-0 rounded-full {online ? 'bg-success' : 'bg-muted-foreground/40'}"
                    ></span>
                  </span>
                  <span class="text-micro text-muted-foreground"
                    >{os.label}{online ? '' : ' · offline'}</span
                  >
                </span>
              </span>
            </Table.Head>
            {#each columns as spec (spec.id)}
              <Table.Cell
                class="group/cell border-l border-border px-[var(--space-4)] py-[var(--space-2)] whitespace-normal"
              >
                {@render cell(machine, spec, online)}
              </Table.Cell>
            {/each}
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Card>
{/if}

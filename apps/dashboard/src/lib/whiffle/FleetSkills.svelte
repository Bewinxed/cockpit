<script lang="ts">
  import type {
    FleetConfig,
    FleetPlugin,
    FleetSkillMeta,
    MarketplacePluginInfo,
  } from "@whiffle/core";
  import { toast } from "svelte-sonner";
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Toggle } from "$lib/components/ui/toggle";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    IconPlus,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconWarningTriangle,
  } from "$lib/icons";
  import type { Machine } from "./client.svelte";
  import { confirm } from "./confirm.svelte";
  import FleetStatusStrip from "./FleetStatusStrip.svelte";
  import {
    catalogHost,
    formatBytes,
    marketplaceCatalog,
    refreshPlugin,
    refreshSkill,
    removeMarketplace,
    removePlugin,
    removeSkill,
    savePlugin,
    saveSkill,
  } from "./fleet";
  import MachineInventory from "./MachineInventory.svelte";
  import MarketplaceDialog from "./MarketplaceDialog.svelte";
  import SkillDialog from "./SkillDialog.svelte";

  let {
    config,
    skills,
    machines,
    settling,
    error,
  }: {
    config: FleetConfig;
    skills: FleetSkillMeta[];
    machines: Machine[];
    settling: boolean;
    error: string | null;
  } = $props();

  let linking = $state(false);
  let fetching = $state(false);
  let busy = $state<Record<string, boolean>>({});
  let browsing = $state<string | null>(null);
  let listings = $state<Record<string, MarketplacePluginInfo[]>>({});
  let reading = $state<Record<string, boolean>>({});
  let unread = $state<Record<string, string>>({});
  let working = $state<Record<string, boolean>>({});

  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  const installed = (id: string): boolean =>
    config.plugins.some((row) => row.id === id);

  // Quiet Ledger surfaces (DESIGN.md · mocks/v5-components.html .panel / .callout).
  const panelList =
    "gap-0 overflow-hidden rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-0 shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]";
  const panelPad =
    "gap-[var(--space-3)] rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-[var(--space-6)] shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]";
  const warnAlert =
    "items-center rounded-[var(--radius-control)] border-[var(--warning-9)] bg-[var(--warning-3)] p-[var(--space-3)] [&>svg]:text-[var(--warning-11)]";
  // A hub-side failure is not the amber a machine's is: nothing downstream of
  // it can be fixed until it is, so it wears the fail tint.
  const failAlert =
    "items-center rounded-[var(--radius-control)] border-[var(--status-fail-ink)] bg-[var(--status-fail-bg)] p-[var(--space-3)] [&>svg]:text-[var(--status-fail-ink)]";

  function landed(row: FleetSkillMeta) {
    const at = skills.findIndex((other) => other.name === row.name);
    if (at === -1) {
      skills.push(row);
    } else {
      skills[at] = row;
    }
  }

  async function switchSkill(row: FleetSkillMeta, enabled: boolean) {
    working[row.name] = true;
    try {
      landed(await saveSkill(row.name, { source: row.source, enabled }));
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete working[row.name];
    }
  }

  async function refresh(row: FleetSkillMeta) {
    working[row.name] = true;
    try {
      const next = await refreshSkill(row.name);
      landed(next);
      if (next.error) {
        toast.error(next.error);
      } else if (next.hash === row.hash) {
        toast.info(`${row.name} is already current.`);
      } else {
        toast.success(`${row.name} changed — the machines get the new files.`);
      }
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete working[row.name];
    }
  }

  /**
   * Re-resolve a plugin's bytes at the hub. The mirror of a skill's Retry, and
   * the answer to the failure that had no affordance at all: a plugin the hub
   * could not fetch never reached a machine, so nothing a machine is asked to
   * do can help it.
   */
  async function refetch(row: FleetPlugin) {
    busy[row.id] = true;
    try {
      const next = await refreshPlugin(row.id);
      const at = config.plugins.findIndex((other) => other.id === row.id);
      if (at !== -1) {
        config.plugins[at] = next;
      }
      if (next.error) {
        toast.error(next.error);
      } else {
        toast.success(`${row.id} fetched — the machines get the files.`);
      }
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.id];
    }
  }

  async function forget(row: FleetSkillMeta) {
    working[row.name] = true;
    try {
      await removeSkill(row.name);
      skills.splice(
        skills.findIndex((other) => other.name === row.name),
        1
      );
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete working[row.name];
    }
  }

  async function browse(name: string) {
    if (browsing === name) {
      browsing = null;
      return;
    }
    browsing = name;
    if (listings[name] || reading[name]) {
      return;
    }
    const host = catalogHost(machines, name);
    if (!host) {
      return;
    }
    reading[name] = true;
    delete unread[name];
    try {
      listings[name] = await marketplaceCatalog(host.machineId, name);
    } catch (error) {
      unread[name] = message(error);
    } finally {
      delete reading[name];
    }
  }

  async function unlinkMp(name: string) {
    busy[name] = true;
    try {
      await removeMarketplace(name);
      config.marketplaces.splice(
        config.marketplaces.findIndex((row) => row.name === name),
        1
      );
      if (browsing === name) {
        browsing = null;
      }
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[name];
    }
  }

  async function installPlugin(
    plugin: MarketplacePluginInfo,
    marketplace: string
  ) {
    const id = `${plugin.name}@${marketplace}`;
    busy[id] = true;
    try {
      config.plugins.push(await savePlugin(id, { enabled: true }));
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[id];
    }
  }

  async function toggle(id: string, enabled: boolean) {
    busy[id] = true;
    try {
      const row = await savePlugin(id, { enabled });
      const at = config.plugins.findIndex((other) => other.id === id);
      if (at !== -1) {
        config.plugins[at] = row;
      }
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[id];
    }
  }

  async function uninstall(id: string) {
    busy[id] = true;
    try {
      await removePlugin(id);
      config.plugins.splice(
        config.plugins.findIndex((row) => row.id === id),
        1
      );
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[id];
    }
  }

  // Every removal here reaches the whole fleet, so each goes through the shared
  // confirm — no bare hover-revealed click takes a skill or plugin off every
  // machine.
  async function askForget(row: FleetSkillMeta) {
    if (
      await confirm({
        title: `Remove ${row.name}?`,
        body: `This removes the ${row.name} skill from every machine in the fleet. It can't be undone.`,
        confirmLabel: "Remove everywhere",
        destructive: true,
      })
    ) {
      await forget(row);
    }
  }
  async function askUnlink(name: string) {
    if (
      await confirm({
        title: `Unlink ${name}?`,
        body: "The fleet stops tracking this marketplace. Plugins already installed from it stay installed.",
        confirmLabel: "Unlink",
      })
    ) {
      await unlinkMp(name);
    }
  }
  async function askUninstall(id: string) {
    if (
      await confirm({
        title: `Remove ${id}?`,
        body: "This removes the plugin from every machine in the fleet. It can't be undone.",
        confirmLabel: "Remove everywhere",
        destructive: true,
      })
    ) {
      await uninstall(id);
    }
  }
</script>

<div class="flex flex-wrap items-start justify-between gap-3">
  <p class="max-w-prose text-caption">
    Two ways to the same thing. Fetch a skill and the hub downloads its files
    once for the whole fleet; link a marketplace and every machine clones it,
    then install its plugins.
  </p>
  <div class="flex shrink-0 items-center gap-2">
    <Button onclick={() => (linking = true)} size="sm" variant="outline"
      >Link marketplace</Button
    >
    <Button onclick={() => (fetching = true)} size="sm">
      <IconPlus class="shrink-0" />
      Add skill
    </Button>
  </div>
</div>

{#if error}
  <Alert.Root class={warnAlert}>
    <IconWarningTriangle />
    <Alert.Description class="text-caption text-[var(--warning-11)]"
      >{error}</Alert.Description
    >
  </Alert.Root>
{:else}
  <section class="flex flex-col gap-3">
    <h2
      class="text-micro font-medium tracking-wider text-muted-foreground uppercase"
    >
      Skills
    </h2>
    {#if skills.length === 0}
      <Card.Root class={panelPad}>
        <p class="text-caption">
          No skills fetched yet. Paste what you would otherwise have run and the
          hub downloads the files itself.
        </p>
        <Button class="self-start" onclick={() => (fetching = true)} size="sm">
          <IconPlus class="shrink-0" />
          Add skill
        </Button>
      </Card.Root>
    {:else}
      <Card.Root class={panelList}>
        <ul class="flex flex-col">
          {#each skills as row (row.name)}
            <li
              class="group flex flex-col gap-[var(--space-2)] border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0"
            >
              <div class="flex items-start gap-[var(--space-3)]">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="flex flex-wrap items-baseline gap-x-2">
                    <span
                      class="truncate text-caption font-medium text-foreground"
                      >{row.name}</span
                    >
                    {#if row.bytes !== undefined}
                      <span class="shrink-0 text-micro text-muted-foreground"
                        >{formatBytes(row.bytes)}</span
                      >
                    {/if}
                    {#if row.hash}
                      <span
                        class="shrink-0 font-mono text-micro text-muted-foreground"
                        title={row.hash}
                        >{row.hash.slice(0, 7)}</span
                      >
                    {/if}
                  </span>
                  <span
                    class="truncate font-mono text-micro text-muted-foreground"
                    title={row.source}
                    >{row.source}</span
                  >
                </div>
                <Toggle
                  class="h-6 shrink-0 px-2 text-micro font-normal text-muted-foreground aria-pressed:font-medium aria-pressed:text-foreground"
                  disabled={working[row.name] === true}
                  onPressedChange={(next) => switchSkill(row, next)}
                  pressed={row.enabled}
                  size="sm"
                  title="A disabled skill is taken off the machines, not left switched off"
                  variant="outline"
                  >{row.enabled ? 'Enabled' : 'Disabled'}</Toggle
                >
                <span class="flex shrink-0 items-center gap-0.5">
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          aria-label="Refresh {row.name}"
                          class="text-muted-foreground"
                          disabled={working[row.name] === true}
                          onclick={() => refresh(row)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <IconRefresh />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content>Fetches the source again</Tooltip.Content>
                  </Tooltip.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          aria-label="Delete {row.name}"
                          class="text-muted-foreground hover:text-destructive"
                          disabled={working[row.name] === true}
                          onclick={() => askForget(row)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <IconTrash />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content
                      >Removes the files from every machine</Tooltip.Content
                    >
                  </Tooltip.Root>
                </span>
              </div>

              {#if row.error}
                <Alert.Root class={warnAlert}>
                  <IconWarningTriangle />
                  <Alert.Description class="flex flex-col gap-1">
                    <span class="text-caption text-[var(--warning-11)]"
                      >The hub could not fetch this skill, so no machine has
                      it.</span
                    >
                    <span class="font-mono text-micro text-[var(--warning-11)]"
                      >{row.error}</span
                    >
                  </Alert.Description>
                  <Alert.Action>
                    <Button
                      class="shrink-0"
                      disabled={working[row.name] === true}
                      onclick={() => refresh(row)}
                      size="xs"
                      variant="outline"
                    >
                      {working[row.name] ? 'Retrying…' : 'Retry'}
                    </Button>
                  </Alert.Action>
                </Alert.Root>
              {/if}

              {#if machines.length === 0 && settling}
                <Skeleton class="h-5 w-40 rounded-full" />
              {:else if machines.length === 0}
                <span class="text-micro text-muted-foreground"
                  >No machines yet — this lands on the first one that
                  registers.</span
                >
              {:else}
                <FleetStatusStrip
                  kind="skills"
                  {machines}
                  name={row.name}
                  what="skill"
                />
              {/if}
            </li>
          {/each}
        </ul>
      </Card.Root>
    {/if}
    <p class="max-w-prose text-micro text-muted-foreground">
      Whiffle installs a skill's files. A skill that also ships hooks or
      subagents runs in its degraded mode until those are set up by hand.
    </p>
  </section>

  <section class="flex flex-col gap-3">
    <h2
      class="text-micro font-medium tracking-wider text-muted-foreground uppercase"
    >
      Marketplaces
    </h2>
    {#if config.marketplaces.length === 0}
      <Card.Root class={panelPad}>
        <p class="text-caption">
          No marketplaces linked yet. Link one and its plugins become browsable
          here.
        </p>
        <Button
          class="self-start"
          onclick={() => (linking = true)}
          size="sm"
          variant="outline"
          >Link marketplace</Button
        >
      </Card.Root>
    {:else}
      <Card.Root class={panelList}>
        <ul class="flex flex-col">
          {#each config.marketplaces as row (row.name)}
            {@const host = catalogHost(machines, row.name)}
            <li
              class="group flex flex-col gap-[var(--space-2)] border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0"
            >
              <div class="flex items-start gap-[var(--space-3)]">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    class="truncate text-caption font-medium text-foreground"
                    >{row.name}</span
                  >
                  <span
                    class="truncate font-mono text-micro text-muted-foreground"
                    title={row.source}
                    >{row.source}</span
                  >
                </div>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        class="shrink-0"
                        disabled={!host}
                        onclick={() => browse(row.name)}
                        size="xs"
                        variant="outline"
                      >
                        <IconSearch class="shrink-0" />
                        {browsing === row.name ? 'Hide' : 'Browse'}
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    >{host ? `Read from ${host.hostname}` : 'No machine that is online has this marketplace yet'}</Tooltip.Content
                  >
                </Tooltip.Root>
                <span class="flex shrink-0 items-center">
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          aria-label="Unlink {row.name}"
                          class="text-muted-foreground hover:text-destructive"
                          disabled={busy[row.name] === true}
                          onclick={() => askUnlink(row.name)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <IconTrash />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content
                      >Unlinks it from every machine</Tooltip.Content
                    >
                  </Tooltip.Root>
                </span>
              </div>

              {#if machines.length === 0 && settling}
                <Skeleton class="h-5 w-40 rounded-full" />
              {:else if machines.length > 0}
                <FleetStatusStrip
                  kind="marketplaces"
                  {machines}
                  name={row.name}
                  what="marketplace"
                />
              {/if}

              {#if browsing === row.name}
                {#if reading[row.name]}
                  <div
                    aria-label="Reading {row.name}"
                    class="flex flex-col gap-2 pt-1"
                    role="status"
                  >
                    {#each [0, 1, 2] as line (line)}
                      <Skeleton
                        class="h-8 w-full rounded-[var(--radius-control)]"
                      />
                    {/each}
                  </div>
                {:else if unread[row.name]}
                  <p class="pt-1 text-caption text-warning" role="alert">
                    {unread[row.name]}
                  </p>
                {:else if (listings[row.name] ?? []).length === 0}
                  <p class="pt-1 text-caption text-muted-foreground">
                    This marketplace lists no plugins.
                  </p>
                {:else}
                  <ul
                    class="flex flex-col rounded-[var(--radius-well)] border border-[var(--border-hairline)] bg-[var(--surface-field)]"
                  >
                    {#each listings[row.name] as plugin (plugin.name)}
                      {@const id = `${plugin.name}@${row.name}`}
                      <li
                        class="flex items-start gap-[var(--space-3)] border-t border-[var(--border-hairline)] px-[var(--space-3)] py-[var(--space-2)] first:border-t-0"
                      >
                        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span class="flex flex-wrap items-baseline gap-x-2">
                            <span
                              class="text-caption font-medium text-foreground"
                              >{plugin.name}</span
                            >
                            {#if plugin.version}
                              <span
                                class="font-mono text-micro text-muted-foreground"
                                >{plugin.version}</span
                              >
                            {/if}
                            {#if plugin.category}
                              <span class="text-micro text-muted-foreground"
                                >{plugin.category}</span
                              >
                            {/if}
                          </span>
                          {#if plugin.description}
                            <span class="text-micro text-muted-foreground"
                              >{plugin.description}</span
                            >
                          {/if}
                        </div>
                        {#if installed(id)}
                          <span
                            class="shrink-0 pt-0.5 text-micro text-muted-foreground"
                            >Added</span
                          >
                        {:else}
                          <Button
                            class="shrink-0"
                            disabled={busy[id] === true}
                            onclick={() => installPlugin(plugin, row.name)}
                            size="xs"
                            variant="outline"
                          >
                            {busy[id] ? 'Adding…' : 'Install'}
                          </Button>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      </Card.Root>
    {/if}
  </section>

  <section class="flex flex-col gap-3">
    <h2
      class="text-micro font-medium tracking-wider text-muted-foreground uppercase"
    >
      Plugins
    </h2>
    {#if config.plugins.length === 0}
      <Card.Root class={panelPad}>
        <p class="text-caption">
          Nothing installed yet. Browse a marketplace above and add a plugin.
        </p>
      </Card.Root>
    {:else}
      <Card.Root class={panelList}>
        <ul class="flex flex-col">
          {#each config.plugins as row (row.id)}
            <li
              class="group flex flex-col gap-[var(--space-2)] border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0"
            >
              <div class="flex items-start gap-[var(--space-3)]">
                <span
                  class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2"
                >
                  <span class="truncate font-mono text-caption">{row.id}</span>
                  <!-- What the hub resolved this to, the same three facts a skill
                     row shows. A plugin with neither is one no machine has been
                     handed bytes for. -->
                  {#if row.bytes !== undefined}
                    <span class="shrink-0 text-micro text-muted-foreground"
                      >{formatBytes(row.bytes)}</span
                    >
                  {/if}
                  {#if row.hash}
                    <span
                      class="shrink-0 font-mono text-micro text-muted-foreground"
                      title={row.hash}
                      >{row.hash.slice(0, 7)}</span
                    >
                  {/if}
                </span>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Toggle
                        {...props}
                        class="h-6 shrink-0 px-2 text-micro font-normal text-muted-foreground aria-pressed:font-medium aria-pressed:text-foreground"
                        disabled={busy[row.id] === true}
                        onPressedChange={(next) => toggle(row.id, next)}
                        pressed={row.enabled}
                        size="sm"
                        variant="outline"
                        >{row.enabled ? 'Enabled' : 'Disabled'}</Toggle
                      >
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    >Disabling uninstalls it from the machines and keeps the row
                    here</Tooltip.Content
                  >
                </Tooltip.Root>
                <span class="flex shrink-0 items-center">
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          aria-label="Remove {row.id}"
                          class="text-muted-foreground hover:text-destructive"
                          disabled={busy[row.id] === true}
                          onclick={() => askUninstall(row.id)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <IconTrash />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content
                      >Removes it from every machine</Tooltip.Content
                    >
                  </Tooltip.Root>
                </span>
              </div>
              <!-- A hub-side resolve failure, which is a different fault from a
                 machine refusing to apply it: this one never reached a machine
                 at all, so the chips below would say nothing about it. -->
              {#if row.error}
                <Alert.Root class={failAlert}>
                  <IconWarningTriangle />
                  <Alert.Description class="flex flex-col gap-1">
                    <span class="text-caption text-[var(--status-fail-ink)]"
                      >The hub could not fetch this plugin, so no machine has
                      it.</span
                    >
                    <span
                      class="font-mono text-micro text-[var(--status-fail-ink)]"
                      >{row.error}</span
                    >
                  </Alert.Description>
                  <Alert.Action>
                    <Button
                      class="shrink-0"
                      disabled={busy[row.id] === true}
                      onclick={() => refetch(row)}
                      size="xs"
                      variant="outline"
                    >
                      {busy[row.id] ? 'Fetching…' : 'Fetch again'}
                    </Button>
                  </Alert.Action>
                </Alert.Root>
              {/if}

              {#if machines.length === 0 && settling}
                <Skeleton class="h-5 w-40 rounded-full" />
              {:else if machines.length === 0}
                <span class="text-micro text-muted-foreground"
                  >No machines yet — this lands on the first one that
                  registers.</span
                >
              {:else}
                <FleetStatusStrip
                  kind="plugins"
                  {machines}
                  name={row.id}
                  what="plugin"
                />
              {/if}
            </li>
          {/each}
        </ul>
      </Card.Root>
    {/if}
  </section>

  <p class="text-micro text-muted-foreground">
    Either way, a skill is in every session's
    <span class="font-mono">/</span> menu on that machine once the machine has
    it.
  </p>

  <MachineInventory
    kind="skills"
    {machines}
    onskill={landed}
    taken={skills.map((row) => row.name)}
  />
{/if}

<MarketplaceDialog
  onsaved={(row) => config.marketplaces.push(row)}
  taken={config.marketplaces.map((row) => row.name)}
  bind:open={linking}
/>
<SkillDialog
  onsaved={landed}
  taken={skills.map((row) => row.name)}
  bind:open={fetching}
/>

<script lang="ts">
  import { hookSentence } from "@whiffle/core";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Alert from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Card from "$lib/components/ui/card";
  import { Toggle } from "$lib/components/ui/toggle";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { IconAlert, IconHook, IconPlus, IconTrash } from "$lib/icons";
  import { whiffle } from "$lib/whiffle/client.svelte";
  import { confirm } from "$lib/whiffle/confirm.svelte";
  import {
    draftOf,
    type FleetHook,
    HOOK_TEMPLATES,
    hooksOf,
    message,
    removeHook,
    saveHook,
  } from "$lib/whiffle/hooks";
  import { newId } from "$lib/whiffle/id";
  import type { PageData } from "./$types";

  /**
   * The hook library. Each row reads as the sentence the hook actually is,
   * because a hook — unlike an MCP server or a skill — has a matcher whose
   * meaning is easy to get wrong silently, so the English is worth reading on
   * every visit, not just at save time.
   *
   * The empty state is the onboarding: three ready-made hooks, one click each.
   */
  let { data }: { data: PageData } = $props();

  let hooks = $state<FleetHook[]>(untrack(() => data.hooks));
  let busy = $state<Record<string, boolean>>({});
  let seeding = $state<string | null>(null);

  /** A hook writes an executable script to every machine — never a bare click. */
  async function askRemove(row: FleetHook) {
    const ok = await confirm({
      title: `Delete ${row.name}?`,
      body: "This hook stops running and is removed from every machine that had it. You can always write it again, but there's no undo.",
      confirmLabel: "Delete hook",
      destructive: true,
    });
    if (ok) {
      await remove(row);
    }
  }

  // Re-seed when SvelteKit hands the route a fresh load (a return from the
  // editor), without clobbering the optimistic edits made since.
  let latch = $state.raw(untrack(() => data));
  $effect(() => {
    if (latch === data) {
      return;
    }
    latch = data;
    ({ hooks } = data);
  });

  const enabledTotal = $derived(hooks.filter((hook) => hook.enabled).length);
  const eventsCovered = $derived(
    new Set(hooks.filter((hook) => hook.enabled).map((hook) => hook.event)).size
  );
  const machinesApplied = $derived(
    whiffle.machines.filter((machine) =>
      Object.values(hooksOf(machine) ?? {}).some(
        (state) => state.state === "applied"
      )
    ).length
  );

  async function toggle(row: FleetHook, enabled: boolean) {
    busy[row.id] = true;
    try {
      await saveHook(row.id, { ...draftOf(row), enabled });
      row.enabled = enabled;
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.id];
    }
  }

  async function remove(row: FleetHook) {
    busy[row.id] = true;
    try {
      await removeHook(row.id, row.name);
      hooks = hooks.filter((other) => other.id !== row.id);
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.id];
    }
  }

  /* Quiet Ledger dressing for shadcn primitives — see routes/rules/+page.svelte. */
  const panelClass =
    "gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-lifted)] ring-0";
  const tileClass =
    "h-full gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--c-card-pad)] shadow-[var(--shadow-lifted)] ring-0";
  const btnPrimary =
    "h-[var(--c-btn-h)] gap-[var(--c-btn-gap)] rounded-[var(--radius-control)] border-transparent bg-[var(--brand-solid)] bg-[image:var(--gradient-action)] px-[var(--c-btn-pad)] text-[length:var(--c-btn-fs)] font-medium !text-[color:var(--on-brand)] shadow-[var(--shadow-action)] hover:brightness-110";
  const btnQuiet =
    "h-[var(--c-btn-h)] gap-[var(--c-btn-gap)] rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--surface-raised)] px-[var(--c-btn-pad)] text-[length:var(--c-btn-fs)] font-medium !text-[color:var(--ink-strong)] shadow-none hover:bg-[var(--surface-hover)]";
  const alertDanger =
    "rounded-[var(--radius-control)] border-[var(--error-9)] bg-[var(--error-3)] !text-[color:var(--error-11)]";

  async function useTemplate(template: (typeof HOOK_TEMPLATES)[number]) {
    seeding = template.title;
    try {
      const id = newId();
      const saved = await saveHook(id, template.draft);
      hooks = [saved, ...hooks];
      toast.success(`${template.title} is written to every machine.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      seeding = null;
    }
  }

  const appliedLine = (row: FleetHook): string | null => {
    if (!row.enabled) {
      return null;
    }
    const total = whiffle.machines.length;
    if (total === 0) {
      return null;
    }
    const applied = whiffle.machines.filter(
      (machine) => hooksOf(machine)?.[row.id]?.state === "applied"
    ).length;
    const failed = whiffle.machines.filter(
      (machine) => hooksOf(machine)?.[row.id]?.state === "failed"
    ).length;
    if (failed > 0) {
      return `Applied on ${applied} of ${total} machines — ${failed} failed.`;
    }
    return `Applied on ${applied} of ${total} machines.`;
  };
</script>

<svelte:head><title>Hooks &middot; Whiffle</title></svelte:head>

{#snippet stat(label: string, value: string | number, unit?: string)}
  <Card.Root class={tileClass}>
    <div class="well">
      <span class="k">{label}</span>
      <span class="v">{value}</span>
      {#if unit}
        <span class="u">{unit}</span>
      {/if}
    </div>
  </Card.Root>
{/snippet}
<Tooltip.Provider>
  <div class="page">
    <div class="col">
      <header class="head">
        <p class="sub">
          Scripts and calls the fleet runs on a session's own lifecycle — before
          a tool call, after a turn ends, when a session starts. Whiffle writes
          each one to every machine and keeps it converged; a session is never
          told Whiffle is the one running it.
        </p>
        <Button class={btnPrimary} onclick={() => goto('/hooks/new')}>
          <IconPlus class="shrink-0" />
          New hook
        </Button>
      </header>

      <section aria-label="Hook library at a glance" class="stats">
        {@render stat('Hooks', hooks.length)}
        {@render stat('Enabled', enabledTotal, `of ${hooks.length}`)}
        {@render stat('Events covered', eventsCovered, 'of 31')}
        {@render stat('Machines applied', machinesApplied, `of ${whiffle.machines.length}`)}
      </section>

      {#if data.error}
        <Alert.Root class={alertDanger}>
          <Alert.Description
            class="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[color:var(--error-11)]"
          >
            {data.error}
          </Alert.Description>
        </Alert.Root>
      {:else if hooks.length === 0}
        <Card.Root class={panelClass}>
          <header class="phead">
            <h2>Nothing runs yet</h2>
            <span class="psub">
              Start from one of these — they are ordinary hooks once added, and
              you can change every part of them.
            </span>
          </header>
          <div class="pbody">
            <ul class="rows">
              {#each HOOK_TEMPLATES as template (template.title)}
                <li class="row">
                  <div class="rowtext">
                    <span class="name">{template.title}</span>
                    <span class="line">{template.blurb}</span>
                    <span class="line">{hookSentence(template.draft)}</span>
                  </div>
                  <div class="rowactions">
                    <Button
                      class={btnQuiet}
                      disabled={seeding !== null}
                      onclick={() => useTemplate(template)}
                    >
                      {seeding === template.title ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                </li>
              {/each}
            </ul>
            <div>
              <Button class={btnQuiet} onclick={() => goto('/hooks/new')}>
                Or write one from scratch
              </Button>
            </div>
          </div>
        </Card.Root>
      {:else}
        <Card.Root class={panelClass}>
          <header class="phead">
            <h2>Hook library</h2>
            <span class="psub"
              >Every hook the fleet keeps, and where it has landed</span
            >
          </header>
          <div class="pbody">
            <ul class="rows">
              {#each hooks as row (row.id)}
                {@const applied = appliedLine(row)}
                <li class="row group">
                  <div class="rowtext" class:off={!row.enabled}>
                    <span class="name">
                      <a href="/hooks/{row.id}">{row.name}</a>
                      <Badge
                        class="gap-[var(--space-1)] rounded-[var(--radius-pill)] px-[var(--space-2)] font-mono text-[length:var(--text-xs)] font-medium"
                        variant="outline"
                      >
                        <IconHook class="size-3 shrink-0" />
                        {row.event}
                      </Badge>
                    </span>
                    <span class="line">{hookSentence(row)}</span>
                    {#if applied}
                      <span class="line">{applied}</span>
                    {/if}
                  </div>
                  <div class="rowactions">
                    <Toggle
                      disabled={busy[row.id] === true}
                      onPressedChange={(next) => toggle(row, next)}
                      pressed={row.enabled}
                      size="sm"
                      variant="outline"
                    >
                      {row.enabled ? 'Enabled' : 'Disabled'}
                    </Toggle>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <Button
                            {...props}
                            aria-label="Delete {row.name}"
                            class="text-muted-foreground hover:text-destructive"
                            disabled={busy[row.id] === true}
                            onclick={() => askRemove(row)}
                            size="icon"
                            variant="ghost"
                          >
                            <IconTrash class="size-4" />
                          </Button>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content>Delete {row.name}</Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        </Card.Root>
      {/if}
    </div>
  </div>
</Tooltip.Provider>

<style>
  .page {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-6);
    min-width: 0;
  }
  .col {
    margin: 0 auto;
    max-width: 1100px;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .head .sub {
    max-width: 68ch;
    font-size: var(--text-base);
    color: var(--ink-muted);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: var(--space-4);
  }
  .well {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    justify-content: center;
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-well);
    padding: var(--c-card-pad);
  }
  .well .k {
    color: var(--ink-label);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .well .v {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-numeric);
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .well .u {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
  .phead {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    margin-bottom: var(--space-4);
  }
  .phead h2 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .psub {
    max-width: 68ch;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .pbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border-hairline);
  }
  .row:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .rowtext {
    display: flex;
    min-width: 0;
    flex: 1 1 320px;
    flex-direction: column;
    gap: var(--space-1);
    transition: opacity var(--c-300) ease-out;
  }
  .rowtext.off {
    opacity: 0.55;
  }
  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .name a {
    color: inherit;
    text-decoration: none;
  }
  .name a::after {
    content: "";
    position: absolute;
    inset: 0;
  }
  .name a:hover,
  .name a:focus-visible {
    text-decoration: underline;
  }
  .line {
    max-width: 68ch;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .rowactions {
    position: relative;
    z-index: 1;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
  }
</style>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { hookSentence } from '@whiffle/core';
  import { IconHook, IconPlus, IconTrash, IconWarningTriangle } from '$lib/icons';
  import * as Alert from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { confirm } from './confirm.svelte';
  import type { Machine } from './client.svelte';
  import { draftOf, message, removeHook, saveHook, type FleetHook } from './hooks';
  import FleetStatusStrip from './FleetStatusStrip.svelte';

  /**
   * The sixth fleet panel: what runs on a session's own lifecycle, and where
   * it has actually landed. Unlike MCP or skills, a hook that fails to
   * converge is not a missing convenience — it is code that was supposed to
   * run and did not — so `failed` gets the warning tint the other panels
   * reserve for the whole-panel alert, right on the machine chip.
   */
  let {
    hooks,
    machines,
    settling,
    error,
  }: {
    hooks: FleetHook[];
    machines: Machine[];
    settling: boolean;
    error: string | null;
  } = $props();

  let busy = $state<Record<string, boolean>>({});

  const panelList = 'gap-0 overflow-hidden rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-0 shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]';
  const panelPad = 'gap-[var(--space-3)] rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-[var(--space-6)] shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)]';
  const warnAlert = 'items-center rounded-[var(--radius-control)] border-[var(--warning-9)] bg-[var(--warning-3)] p-[var(--space-3)] [&>svg]:text-[var(--warning-11)]';

  async function toggle(row: FleetHook, enabled: boolean) {
    busy[row.id] = true;
    try {
      await saveHook(row.id, { ...draftOf(row), enabled });
      row.enabled = enabled;
    } catch (caught) {
      toast.error(message(caught));
    } finally {
      delete busy[row.id];
    }
  }

  // A hook is executable material on every machine it applies to, so removal
  // goes through the shared confirm — same reasoning as an MCP server, with
  // higher stakes.
  async function askRemove(row: FleetHook) {
    const ok = await confirm({
      title: `Delete ${row.name}?`,
      body: `This removes ${row.name} from every machine it applies to. It can't be undone.`,
      confirmLabel: 'Delete hook',
      destructive: true,
    });
    if (ok) await remove(row);
  }

  async function remove(row: FleetHook) {
    busy[row.id] = true;
    try {
      await removeHook(row.id, row.name);
      hooks.splice(
        hooks.findIndex((other) => other.id === row.id),
        1
      );
    } catch (caught) {
      toast.error(message(caught));
    } finally {
      delete busy[row.id];
    }
  }
</script>

<div class="flex flex-wrap items-start justify-between gap-3">
  <p class="max-w-prose text-caption">
    Scripts and calls that run on a session's own lifecycle events — before a tool call, when a
    session starts, after a turn ends. Written to every machine it applies to and kept converged.
  </p>
  <Button size="sm" onclick={() => goto('/hooks/new')}>
    <IconPlus class="shrink-0" />
    New hook
  </Button>
</div>

{#if error}
  <Alert.Root class={warnAlert}>
    <IconWarningTriangle />
    <Alert.Description class="text-caption text-[var(--warning-11)]">{error}</Alert.Description>
  </Alert.Root>
{:else if hooks.length === 0}
  <Card.Root class={panelPad}>
    <p class="text-caption">
      No hooks yet. Add one and every machine gets the script, registered against the event you
      pick.
    </p>
    <Button size="sm" class="self-start" onclick={() => goto('/hooks/new')}>
      <IconPlus class="shrink-0" />
      New hook
    </Button>
  </Card.Root>
{:else}
  <Card.Root class={panelList}>
    <ul class="flex flex-col">
      {#each hooks as row (row.id)}
        <li class="group flex flex-col gap-[var(--space-2)] border-t border-[var(--border-hairline)] p-[var(--space-4)] first:border-t-0">
          <div class="flex items-start gap-[var(--space-3)]">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex flex-wrap items-baseline gap-x-2">
                <a href="/hooks/{row.id}" class="truncate text-caption font-medium text-foreground hover:underline">
                  {row.name}
                </a>
                <span class="shrink-0 font-mono text-micro text-muted-foreground">{row.event}</span>
              </span>
              <span class="truncate text-micro text-muted-foreground" title={hookSentence(row)}>
                {hookSentence(row)}
              </span>
            </div>
            <Toggle
              variant="outline"
              size="sm"
              class="h-6 shrink-0 px-2 text-micro font-normal text-muted-foreground aria-pressed:font-medium aria-pressed:text-foreground"
              pressed={row.enabled}
              disabled={busy[row.id] === true}
              onPressedChange={(next) => toggle(row, next)}
              title="A disabled hook is taken off the machines, not left switched off"
            >
              {row.enabled ? 'Enabled' : 'Disabled'}
            </Toggle>
            <span class="flex shrink-0 items-center gap-0.5">
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} variant="ghost" size="icon-sm" class="text-muted-foreground" aria-label="Edit {row.name}" onclick={() => goto(`/hooks/${row.id}`)}>
                      <IconHook />
                    </Button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Open the editor</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} variant="ghost" size="icon-sm" class="text-muted-foreground hover:text-destructive" aria-label="Delete {row.name}" disabled={busy[row.id] === true} onclick={() => askRemove(row)}>
                      <IconTrash />
                    </Button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Removes it from every machine</Tooltip.Content>
              </Tooltip.Root>
            </span>
          </div>

          {#if machines.length === 0 && settling}
            <Skeleton class="h-5 w-40 rounded-full" />
          {:else if machines.length === 0}
            <span class="text-micro text-muted-foreground">
              No machines yet — this lands on the first one that registers.
            </span>
          {:else}
            <!-- The same strip every other fleet row uses. It was a bare chip
                 with a `title` attribute: a hook that failed to register is code
                 that was supposed to run and did not, and its reason was
                 reachable only by hovering the exact pixel with a mouse — never
                 by keyboard, never on touch, never on the page. -->
            <FleetStatusStrip {machines} kind="hooks" name={row.id} what="hook" />
          {/if}
        </li>
      {/each}
    </ul>
  </Card.Root>
{/if}

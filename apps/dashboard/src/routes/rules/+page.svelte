<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import type { RuleRow } from '@cockpit/core';
  import { ruleSentence } from '@cockpit/core';
  import { IconAlert, IconPlus, IconTrash } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    draftOf,
    message,
    removeRule,
    RULE_TEMPLATES,
    saveRule,
    since,
    times,
  } from '$lib/cockpit/rules';
  import type { PageData } from './$types';

  /**
   * The rule library. Each row reads as the sentence the rule actually is,
   * because a rule is a sentence — a grid of pattern/timing/scope columns
   * would make the reader reassemble it on every visit.
   *
   * The empty state is the onboarding: three ready-made rules, one click each.
   * A rules feature nobody writes a rule for is a rules feature that does
   * nothing, and the blank form is the place people stop.
   */
  let { data }: { data: PageData } = $props();

  let rules = $state<RuleRow[]>(untrack(() => data.rules));
  let busy = $state<Record<string, boolean>>({});
  let seeding = $state<string | null>(null);

  // Re-seed when SvelteKit hands the route a fresh load (a return from the
  // editor), without clobbering the optimistic edits made since.
  let latch = $state.raw(untrack(() => data));
  $effect(() => {
    if (latch === data) return;
    latch = data;
    rules = data.rules;
  });

  const pendingTotal = $derived(rules.reduce((sum, rule) => sum + rule.stats.pending, 0));

  async function toggle(row: RuleRow, enabled: boolean) {
    busy[row.id] = true;
    try {
      await saveRule(row.id, { ...draftOf(row), enabled });
      row.enabled = enabled;
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.id];
    }
  }

  async function remove(row: RuleRow) {
    busy[row.id] = true;
    try {
      await removeRule(row.id, row.name);
      rules = rules.filter((other) => other.id !== row.id);
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.id];
    }
  }

  async function useTemplate(template: (typeof RULE_TEMPLATES)[number]) {
    seeding = template.title;
    try {
      const id = crypto.randomUUID();
      const saved = await saveRule(id, template.draft);
      rules = [
        { ...saved, stats: { ruleId: id, pending: 0, totalFires: 0, lastFiredAt: null } },
        ...rules,
      ];
      toast.success(`${template.title} is live on every session.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      seeding = null;
    }
  }
</script>

<svelte:head><title>Rules · cockpit</title></svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-col gap-2">
        <h1 class="text-display">Rules</h1>
        <p class="max-w-prose text-caption">
          Standing instructions the hub enforces on every session it watches. When a session says
          something a rule is looking for, cockpit answers it — and keeps answering until the
          session acknowledges what it was told.
        </p>
      </div>
      <Button size="sm" class="shrink-0" onclick={() => goto('/rules/new')}>
        <IconPlus class="shrink-0" />
        New rule
      </Button>
    </header>

    {#if pendingTotal > 0}
      <p class="text-micro text-muted-foreground">
        {pendingTotal}
        {pendingTotal === 1 ? 'session has' : 'sessions have'} been told something and not answered for
        it yet.
      </p>
    {/if}

    {#if data.error}
      <div class="rounded-xl bg-card p-4 shadow-md" role="alert">
        <p class="text-caption text-warning">{data.error}</p>
      </div>
    {:else if rules.length === 0}
      <section class="flex flex-col gap-5 rounded-xl bg-card p-6 shadow-md">
        <div class="flex flex-col gap-2">
          <h2 class="text-title">Nothing is watching yet</h2>
          <p class="max-w-prose text-caption">
            Start from one of these — they are ordinary rules once added, and you can change every
            part of them.
          </p>
        </div>
        <ul class="flex flex-col gap-3">
          {#each RULE_TEMPLATES as template (template.title)}
            <li class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-caption font-medium text-foreground">{template.title}</span>
                <span class="text-micro text-muted-foreground">{template.blurb}</span>
                <span class="truncate font-mono text-micro text-muted-foreground">
                  {template.draft.pattern}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                disabled={seeding !== null}
                onclick={() => useTemplate(template)}
              >
                {seeding === template.title ? 'Adding…' : 'Add'}
              </Button>
            </li>
          {/each}
        </ul>
        <Button variant="ghost" size="sm" class="self-start" onclick={() => goto('/rules/new')}>
          Or write one from scratch
        </Button>
      </section>
    {:else}
      <ul class="flex flex-col rounded-xl bg-card shadow-md">
        {#each rules as row (row.id)}
          <li class="group relative flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
            <div class="flex items-start gap-3">
              <!-- A disabled rule reads dimmed rather than carrying a second
                   "Off" badge next to a toggle that already says Disabled. -->
              <div
                class="flex min-w-0 flex-1 flex-col gap-1 transition-opacity duration-240 ease-expo {row.enabled
                  ? ''
                  : 'opacity-55'}"
              >
                <span class="flex flex-wrap items-center gap-2">
                  <!-- The whole row is the link; the actions sit above it. -->
                  <a
                    href="/rules/{row.id}"
                    class="text-caption font-medium text-foreground after:absolute after:inset-0 hover:underline focus-visible:underline"
                  >
                    {row.name}
                  </a>
                  {#if row.stats.pending > 0}
                    <span
                      class="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-micro text-warning"
                    >
                      <IconAlert class="size-3 shrink-0" />
                      {row.stats.pending} waiting
                    </span>
                  {/if}
                </span>
                <span class="max-w-prose text-micro text-muted-foreground">
                  {ruleSentence(row)}
                </span>
                <span class="text-micro text-muted-foreground">
                  {row.stats.totalFires === 0
                    ? 'Has not caught anything yet.'
                    : `Fired ${times(row.stats.totalFires)}, last ${since(row.stats.lastFiredAt)}.`}
                </span>
              </div>
              <div class="relative z-10 flex shrink-0 items-center gap-1">
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={row.enabled}
                  disabled={busy[row.id] === true}
                  onPressedChange={(next) => toggle(row, next)}
                >
                  {row.enabled ? 'Enabled' : 'Disabled'}
                </Toggle>
                <Tooltip.Provider>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="icon"
                          class="text-muted-foreground transition-opacity duration-150 hover:text-destructive md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                          disabled={busy[row.id] === true}
                          aria-label="Delete {row.name}"
                          onclick={() => remove(row)}
                        >
                          <IconTrash class="size-4" />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content>Delete {row.name}</Tooltip.Content>
                  </Tooltip.Root>
                </Tooltip.Provider>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

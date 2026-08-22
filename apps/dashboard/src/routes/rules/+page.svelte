<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import type { RuleRow } from '@cockpit/core';
  import { ruleSentence } from '@cockpit/core';
  import { IconAlert, IconPlus, IconTrash } from '$lib/icons';
  import { Button, Callout, Panel, StatCard } from '$lib/outpost';
  import { Button as UiButton } from '$lib/components/ui/button';
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
  const enabledTotal = $derived(rules.filter((rule) => rule.enabled).length);
  const firesTotal = $derived(rules.reduce((sum, rule) => sum + rule.stats.totalFires, 0));

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

<svelte:head><title>Rules &middot; Outpost</title></svelte:head>

<div class="page">
  <div class="col">
    <header class="head">
      <div class="headtext">
        <h1>Rules</h1>
        <p class="sub">
          Standing instructions the hub enforces on every session it watches. When a session says
          something a rule is looking for, cockpit answers it — and keeps answering until the
          session acknowledges what it was told.
        </p>
      </div>
      <Button variant="primary" onclick={() => goto('/rules/new')}>
        <IconPlus class="shrink-0" />
        New rule
      </Button>
    </header>

    <section class="stats" aria-label="Rule library at a glance">
      <StatCard label="Rules" value={rules.length} />
      <StatCard label="Enabled" value={enabledTotal} unit="of {rules.length}" />
      <StatCard label="Waiting on an answer" value={pendingTotal} unit="sessions" />
      <StatCard label="Times fired" value={firesTotal} unit="all time" />
    </section>

    {#if pendingTotal > 0}
      <Callout>
        {pendingTotal}
        {pendingTotal === 1 ? 'session has' : 'sessions have'} been told something and not answered for
        it yet.
      </Callout>
    {/if}

    {#if data.error}
      <Callout danger>{data.error}</Callout>
    {:else if rules.length === 0}
      <Panel style="--c-card-pad: var(--space-5)">
        <header class="phead">
          <h2>Nothing is watching yet</h2>
          <span class="psub">
            Start from one of these — they are ordinary rules once added, and you can change every
            part of them.
          </span>
        </header>
        <div class="pbody">
          <ul class="rows">
            {#each RULE_TEMPLATES as template (template.title)}
              <li class="row">
                <div class="rowtext">
                  <span class="name">{template.title}</span>
                  <span class="line">{template.blurb}</span>
                  <span class="line mono">{template.draft.pattern}</span>
                </div>
                <div class="rowactions">
                  <Button disabled={seeding !== null} onclick={() => useTemplate(template)}>
                    {seeding === template.title ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
          <div>
            <Button onclick={() => goto('/rules/new')}>Or write one from scratch</Button>
          </div>
        </div>
      </Panel>
    {:else}
      <Panel style="--c-card-pad: var(--space-5)">
        <header class="phead">
          <h2>Rule library</h2>
          <span class="psub">Every rule the hub is enforcing, and what it has caught</span>
        </header>
        <div class="pbody">
          <ul class="rows">
            {#each rules as row (row.id)}
              <li class="row group">
                <!-- A disabled rule reads dimmed rather than carrying a second
                     "Off" badge next to a toggle that already says Disabled. -->
                <div class="rowtext" class:off={!row.enabled}>
                  <span class="name">
                    <!-- The whole row is the link; the actions sit above it. -->
                    <a href="/rules/{row.id}">{row.name}</a>
                    {#if row.stats.pending > 0}
                      <span class="waiting">
                        <IconAlert class="size-3 shrink-0" />
                        {row.stats.pending} waiting
                      </span>
                    {/if}
                  </span>
                  <span class="line">{ruleSentence(row)}</span>
                  <span class="line">
                    {row.stats.totalFires === 0
                      ? 'Has not caught anything yet.'
                      : `Fired ${times(row.stats.totalFires)}, last ${since(row.stats.lastFiredAt)}.`}
                  </span>
                </div>
                <div class="rowactions">
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
                          <UiButton
                            {...props}
                            variant="ghost"
                            size="icon"
                            class="text-muted-foreground transition-opacity duration-150 hover:text-destructive md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                            disabled={busy[row.id] === true}
                            aria-label="Delete {row.name}"
                            onclick={() => remove(row)}
                          >
                            <IconTrash class="size-4" />
                          </UiButton>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content>Delete {row.name}</Tooltip.Content>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      </Panel>
    {/if}
  </div>
</div>

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
  .headtext {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head h1 {
    font-size: var(--text-2xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
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
  /* Tiles share a row, so they share a height — a tile with a unit line must not
     stand taller than one without. */
  .stats :global(.tile > .panel) {
    height: 100%;
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
    content: '';
    position: absolute;
    inset: 0;
  }
  .name a:hover,
  .name a:focus-visible {
    text-decoration: underline;
  }
  .waiting {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-pill);
    padding: 1px 8px;
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
  }
  .line {
    max-width: 68ch;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .line.mono {
    font-family: var(--font-mono);
    word-break: break-word;
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

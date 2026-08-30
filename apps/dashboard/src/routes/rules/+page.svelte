<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import type { RuleRow } from '@cockpit/core';
  import { ruleSentence } from '@cockpit/core';
  import { IconAlert, IconPlus, IconTrash } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import { confirm } from '$lib/cockpit/confirm.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    createRule,
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

  /** Deleting a rule is destructive and easy to mis-tap, so it goes through the confirm. */
  async function askRemove(row: RuleRow) {
    const ok = await confirm({
      title: `Delete ${row.name}?`,
      body: "This rule stops applying to every session and is removed for good. You can always write it again, but there's no undo.",
      confirmLabel: 'Delete rule',
      destructive: true,
    });
    if (ok) await remove(row);
  }
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

  /* Quiet Ledger dressing for shadcn primitives — tailwind-merge drops the stock
     radius / bg-primary / bg-card defaults these override, so nothing reads
     as unmodified shadcn. */
  const panelClass =
    'gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-lifted)] ring-0';
  const tileClass =
    'h-full gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--c-card-pad)] shadow-[var(--shadow-lifted)] ring-0';
  // The never-flat primary action: graphite brand fill + top-light gradient + inset edge.
  const btnPrimary =
    'h-[var(--c-btn-h)] gap-[var(--c-btn-gap)] rounded-[var(--radius-control)] border-transparent bg-[var(--brand-solid)] bg-[image:var(--gradient-action)] px-[var(--c-btn-pad)] text-[length:var(--c-btn-fs)] font-medium !text-[color:var(--on-brand)] shadow-[var(--shadow-action)] hover:brightness-110';
  // The quiet secondary action: raised surface + control border.
  const btnQuiet =
    'h-[var(--c-btn-h)] gap-[var(--c-btn-gap)] rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--surface-raised)] px-[var(--c-btn-pad)] text-[length:var(--c-btn-fs)] font-medium !text-[color:var(--ink-strong)] shadow-none hover:bg-[var(--surface-hover)]';
  const alertWarn =
    'rounded-[var(--radius-control)] border-[var(--warning-9)] bg-[var(--warning-3)] !text-[color:var(--warning-11)]';
  const alertDanger =
    'rounded-[var(--radius-control)] border-[var(--error-9)] bg-[var(--error-3)] !text-[color:var(--error-11)]';

  async function useTemplate(template: (typeof RULE_TEMPLATES)[number]) {
    seeding = template.title;
    try {
      const saved = await createRule(template.draft);
      rules = [
        { ...saved, stats: { ruleId: saved.id, pending: 0, totalFires: 0, lastFiredAt: null } },
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

<!-- Stat tile: a raised shadcn Card whose body is a sunken hairline well — the
     Quiet Ledger recessed-field signature, a number set *in* the surface. -->
{#snippet stat(label: string, value: string | number, unit?: string)}
  <Card.Root class={tileClass}>
    <div class="well">
      <span class="k">{label}</span>
      <span class="v">{value}</span>
      {#if unit}<span class="u">{unit}</span>{/if}
    </div>
  </Card.Root>
{/snippet}
<div class="page">
  <div class="col">
    <header class="head">
      <p class="sub">
        Standing instructions the hub enforces on every session it watches. When a session says
        something a rule is looking for, cockpit answers it — and keeps answering until the
        session acknowledges what it was told.
      </p>
      <Button class={btnPrimary} onclick={() => goto('/rules/new')}>
        <IconPlus class="shrink-0" />
        New rule
      </Button>
    </header>

    <section class="stats" aria-label="Rule library at a glance">
      {@render stat('Rules', rules.length)}
      {@render stat('Enabled', enabledTotal, `of ${rules.length}`)}
      {@render stat('Waiting on an answer', pendingTotal, 'sessions')}
      {@render stat('Times fired', firesTotal, 'all time')}
    </section>

    {#if pendingTotal > 0}
      <Alert.Root class={alertWarn}>
        <Alert.Description
          class="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[color:var(--warning-11)]"
        >
          {pendingTotal}
          {pendingTotal === 1 ? 'session has' : 'sessions have'} been told something and not answered
          for it yet.
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if data.error}
      <Alert.Root class={alertDanger}>
        <Alert.Description
          class="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[color:var(--error-11)]"
        >
          {data.error}
        </Alert.Description>
      </Alert.Root>
    {:else if rules.length === 0}
      <Card.Root class={panelClass}>
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
            <Button class={btnQuiet} onclick={() => goto('/rules/new')}>
              Or write one from scratch
            </Button>
          </div>
        </div>
      </Card.Root>
    {:else}
      <Card.Root class={panelClass}>
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
                      <Badge
                        class="gap-[var(--space-1)] rounded-[var(--radius-pill)] border-transparent bg-[var(--status-attn-bg)] px-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[color:var(--status-attn-ink)]"
                      >
                        <IconAlert class="size-3 shrink-0" />
                        {row.stats.pending} waiting
                      </Badge>
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
                          <Button
                            {...props}
                            variant="ghost"
                            size="icon"
                            class="text-muted-foreground hover:text-destructive"
                            disabled={busy[row.id] === true}
                            aria-label="Delete {row.name}"
                            onclick={() => askRemove(row)}
                          >
                            <IconTrash class="size-4" />
                          </Button>
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
      </Card.Root>
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
  /* The sunken well inside each raised stat Card — the recessed-field signature.
     flex:1 keeps a tile with a unit line the same height as one without. */
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
    content: '';
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

<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import type { DelegateType } from '$lib/whiffle/delegate-types';
  import { message, removeDelegateType } from '$lib/whiffle/delegate-types';
  import { IconPlus, IconSubagent, IconTrash } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { confirm } from '$lib/whiffle/confirm.svelte';
  import type { PageData } from './$types';

  /**
   * The delegate-type library — the named presets a `delegate` call's `type`
   * param routes against. A calling agent never sees a model string here: it
   * reads the description and picks the type that matches what it needs done,
   * so the description is the row's primary content, not a caption under the
   * name.
   *
   * `servedModel` and the cache columns are reserved for a per-type prompt-
   * cache reading the backend does not emit yet — they render an em-dash
   * until it does, never a placeholder number.
   */
  let { data }: { data: PageData } = $props();

  let types = $state<DelegateType[]>(untrack(() => data.types));
  let busy = $state<Record<string, boolean>>({});

  let latch = $state.raw(untrack(() => data));
  $effect(() => {
    if (latch === data) return;
    latch = data;
    types = data.types;
  });

  async function askRemove(row: DelegateType) {
    const ok = await confirm({
      title: `Delete ${row.name}?`,
      body:
        'A session already running keeps the type list it started with — the prompt cache is frozen for its lifetime. This only stops the name from being offered to new sessions.',
      confirmLabel: 'Delete delegate type',
      destructive: true,
    });
    if (ok) await remove(row);
  }

  async function remove(row: DelegateType) {
    busy[row.name] = true;
    try {
      await removeDelegateType(row.name);
      types = types.filter((other) => other.name !== row.name);
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[row.name];
    }
  }

  /** Every field that narrows what the delegate can do, read as a short list. */
  function narrowing(row: DelegateType): string | null {
    const parts: string[] = [];
    if (row.skills?.length) parts.push(`${row.skills.length} skill${row.skills.length === 1 ? '' : 's'}`);
    if (row.denyTools?.length) parts.push(`${row.denyTools.length} tool${row.denyTools.length === 1 ? '' : 's'} denied`);
    return parts.length ? parts.join(', ') : null;
  }

  /* Quiet Ledger dressing for shadcn primitives — see routes/rules/+page.svelte. */
  const panelClass =
    'gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-lifted)] ring-0';
  const tileClass =
    'h-full gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--c-card-pad)] shadow-[var(--shadow-lifted)] ring-0';
  const btnPrimary =
    'h-[var(--c-btn-h)] gap-[var(--c-btn-gap)] rounded-[var(--radius-control)] border-transparent bg-[var(--brand-solid)] bg-[image:var(--gradient-action)] px-[var(--c-btn-pad)] text-[length:var(--c-btn-fs)] font-medium !text-[color:var(--on-brand)] shadow-[var(--shadow-action)] hover:brightness-110';
  const alertDanger =
    'rounded-[var(--radius-control)] border-[var(--error-9)] bg-[var(--error-3)] !text-[color:var(--error-11)]';
</script>

<svelte:head><title>Delegates &middot; Whiffle</title></svelte:head>

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
        The routing table a session's own <code>delegate</code> call reads: each row is a named
        preset — a description, a harness, a model, an effort — and a calling agent picks one by
        matching what it needs done against the description, never by knowing a model string.
      </p>
      <Button class={btnPrimary} onclick={() => goto('/delegates/new')}>
        <IconPlus class="shrink-0" />
        New delegate type
      </Button>
    </header>

    <section class="stats" aria-label="Delegate library at a glance">
      {@render stat('Delegate types', types.length)}
      {@render stat('Harnesses in use', new Set(types.map((row) => row.harness)).size)}
    </section>

    {#if data.error}
      <Alert.Root class={alertDanger}>
        <Alert.Description
          class="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[color:var(--error-11)]"
        >
          {data.error}
        </Alert.Description>
      </Alert.Root>
    {:else if types.length === 0}
      <Card.Root class={panelClass}>
        <header class="phead">
          <h2>No delegate types yet</h2>
          <span class="psub">
            A fresh hub seeds five on first read; delete all of them and this is what is left.
          </span>
        </header>
        <div class="pbody">
          <Button class={btnPrimary} onclick={() => goto('/delegates/new')}>
            <IconPlus class="shrink-0" />
            New delegate type
          </Button>
        </div>
      </Card.Root>
    {:else}
      <Card.Root class={panelClass}>
        <header class="phead">
          <h2>Delegate library</h2>
          <span class="psub">Every preset a <code>delegate</code> call can route to</span>
        </header>
        <div class="pbody">
          <ul class="rows">
            {#each types as row (row.name)}
              <li class="row group">
                <div class="rowtext">
                  <span class="name">
                    <a href="/delegates/{row.name}">{row.name}</a>
                  </span>
                  <span class="line desc">{row.description}</span>
                  <span class="badgerow">
                    <Badge variant="outline" class="capitalize">{row.harness}</Badge>
                    <Badge variant="outline" class="font-mono">{row.model}</Badge>
                    {#if row.effort}<Badge variant="outline" class="capitalize">{row.effort}</Badge>{/if}
                    {#if narrowing(row)}<Badge variant="secondary">{narrowing(row)}</Badge>{/if}
                  </span>
                  <span class="line servedrow">
                    <span class="served">
                      <span class="servedk">served</span>
                      <span class="servedv">{row.model} &rarr; &mdash;</span>
                    </span>
                    <span class="served">
                      <span class="servedk">cache read</span>
                      <span class="servedv">&mdash;</span>
                    </span>
                    <span class="served">
                      <span class="servedk">cache write</span>
                      <span class="servedv">&mdash;</span>
                    </span>
                  </span>
                </div>
                <div class="rowactions">
                  <Tooltip.Provider>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <Button
                            {...props}
                            variant="ghost"
                            size="icon"
                            class="text-muted-foreground hover:text-destructive"
                            disabled={busy[row.name] === true}
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
  .head .sub code {
    font-family: var(--font-mono);
    font-size: 0.9em;
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
  .phead code {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .psub {
    max-width: 68ch;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .psub code {
    font-family: var(--font-mono);
    font-size: 0.9em;
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
    flex: 1 1 420px;
    flex-direction: column;
    gap: var(--space-2);
  }
  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
    font-family: var(--font-mono);
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
  /* The description is the routing content — it reads at body size, not caption. */
  .line.desc {
    font-size: var(--text-base);
    color: var(--ink-strong);
  }
  .badgerow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .servedrow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .served {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }
  .servedk {
    color: var(--ink-label);
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: var(--track-display);
  }
  .servedv {
    font-family: var(--font-mono);
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

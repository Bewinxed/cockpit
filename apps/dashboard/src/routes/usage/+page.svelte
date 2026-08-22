<script lang="ts">
  /**
   * The usage surface: how much room is left, and where it went.
   *
   * Structure locked by the user (2026-08-16): split by harness. The two
   * harnesses never merge into one total, because they are not the same kind of
   * number — Claude is a subscription whose real constraint is a percentage, and
   * opencode is real money. Making that the layout means the page cannot lie by
   * addition.
   *
   * Presentation ported (2026-08-22) from the outpost house components to
   * shadcn-svelte primitives (Card / Table / Badge) dressed in the Quiet Ledger
   * tokens — the raised-panel + sunken-well signature, the hairline table, the
   * uppercase micro-label header — so the primitives never read as stock shadcn.
   */
  import type { PageData } from './$types';
  import type { LimitWindow } from '@cockpit/core';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import { Badge } from '$lib/components/ui/badge';
  import { compactNumber, usd, type UsageSummaryRow } from '$lib/cockpit/usage';
  import DailyChart from '$lib/cockpit/usage/DailyChart.svelte';
  import BreakdownTable from '$lib/cockpit/usage/BreakdownTable.svelte';

  let { data }: { data: PageData } = $props();

  /**
   * Limits are account-scoped, not machine-scoped: every host signed in to the
   * same account reads the same numbers. So the first machine with a real
   * reading speaks for all of them.
   */
  const reading = $derived(
    data.limits?.machines.find((m) => m.limits.error === null)?.limits ??
      // A stale reading beats an empty room: backoff keeps the last good
      // windows with the error attached, and old numbers outrank "HTTP 429".
      data.limits?.machines.find((m) => m.limits.stale && m.limits.windows.length > 0)?.limits ??
      null
  );
  const readingError = $derived(
    reading === null ? (data.limits?.machines[0]?.limits.error ?? null) : null
  );

  const windows = $derived(reading?.windows ?? []);
  /** Session first, then the weekly windows fullest-first: worst news nearest the top. */
  const orderedWindows = $derived([
    ...windows.filter((w) => w.group === 'session'),
    ...windows.filter((w) => w.group === 'weekly').sort((a, b) => b.percent - a.percent),
    ...windows.filter((w) => w.group !== 'session' && w.group !== 'weekly'),
  ]);
  const binding = $derived(orderedWindows.find((w) => w.isActive) ?? orderedWindows[0] ?? null);

  const band = (pct: number): 'ok' | 'warn' | 'bad' =>
    pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';

  const windowLabel = (w: LimitWindow): string =>
    w.group === 'session' ? '5-hour' : w.scopeLabel ? `Weekly · ${w.scopeLabel}` : 'Weekly';

  /** A live clock; the countdowns only ever show minutes. */
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  function resetsIn(resetsAt: string | null, at: number): string {
    if (!resetsAt) return '';
    const diff = new Date(resetsAt).getTime() - at;
    if (diff <= 0) return 'resetting';
    const mins = Math.floor(diff / 60_000);
    const h = Math.floor(mins / 60);
    return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
  }

  const planLabel = $derived(
    reading?.planTier
      ? reading.planTier
          .replace(/^default_claude_/, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : null
  );

  /** Top models by spend; the tail is noise on a glance surface. */
  const topRows = (rows: UsageSummaryRow[] | undefined, n: number): UsageSummaryRow[] =>
    [...(rows ?? [])].sort((a, b) => b.costUsd - a.costUsd).slice(0, n);

  const claudeRows = $derived(topRows(data.claude?.rows, 6));
  const openCodeRows = $derived(topRows(data.opencode?.rows, 6));
  const claudeTotals = $derived(data.claude?.totals ?? null);
  const openCodeTotals = $derived(data.opencode?.totals ?? null);

  const missing = $derived([
    ...new Set([...(data.claude?.missingPricing ?? []), ...(data.opencode?.missingPricing ?? [])]),
  ]);

  /** Blocks, newest first, grouped under the day they started. */
  const allBlocks = $derived(
    [...data.blocksClaude.map((b) => ({ ...b, harness: 'Claude' })),
     ...data.blocksOpenCode.map((b) => ({ ...b, harness: 'opencode' }))]
      .filter((b) => !b.isGap)
      .sort((a, b) => b.startTime - a.startTime)
  );

  const dayKey = (ts: number): string =>
    new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const dayGroups = $derived.by(() => {
    const groups: { day: string; blocks: typeof allBlocks }[] = [];
    for (const block of allBlocks) {
      const day = dayKey(block.startTime);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.blocks.push(block);
      else groups.push({ day, blocks: [block] });
    }
    return groups;
  });

  const clock = (ts: number): string =>
    new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  /**
   * A block only minutes old divides by a tiny elapsed span, so its projection
   * is arithmetic noise. Ten minutes is where it starts meaning something.
   */
  const PROJECTABLE_MS = 10 * 60 * 1000;
  const projectable = (b: { firstTs: number; lastTs: number }): boolean =>
    b.lastTs - b.firstTs >= PROJECTABLE_MS;
</script>

<svelte:head>
  <title>Usage &middot; Outpost</title>
</svelte:head>

<!--
  THESIS: how much room is left, and where it went — refusing the dashboard
  default that sums every provider into one meaningless total.
  STORY: the operator glances, sees which window binds first and when it resets,
  and can name what spent it.
-->

<!-- The recessed-well stat tile: a raised shadcn Card with a sunken hairline
     field inside it — the DESIGN.md signature move, not a flat shadcn card. -->
{#snippet stat(label: string, value: string, unit?: string)}
  <Card.Root class="q-stat">
    <div class="q-well">
      <span class="k">{label}</span>
      <span class="v">{value}</span>
      {#if unit}<span class="u">{unit}</span>{/if}
    </div>
  </Card.Root>
{/snippet}

<div class="page">
  <div class="col">
    <header class="head">
      <h1>Usage</h1>
      <p class="sub">
        How much room is left, and where it went. Claude is a subscription whose constraint is a
        percentage; opencode is real money. The two are never added together.
      </p>
    </header>

    {#if data.error}
      <p class="note" role="alert">{data.error}</p>
    {/if}

    <section class="stats" aria-label="Usage at a glance">
      {#if binding}
        {@render stat(`${windowLabel(binding)} used`, `${Math.round(binding.percent)}%`)}
        {@render stat('Resets in', resetsIn(binding.resetsAt, now) || '—')}
      {/if}
      {@render stat(
        'opencode spend',
        openCodeTotals ? usd(openCodeTotals.costUsd) : '—',
        'real money'
      )}
      {@render stat(
        'Claude at API prices',
        claudeTotals ? `~${usd(claudeTotals.costUsd)}` : '—',
        'covered by the plan'
      )}
      {#if planLabel}
        {@render stat('Plan', planLabel)}
      {/if}
    </section>

    <Card.Root class="q-card">
      <Card.Header class="q-head">
        <Card.Title class="q-title">Claude limits</Card.Title>
        <span class="q-sub">Account-scoped — every signed-in machine reads the same numbers</span>
        {#if planLabel}
          <Badge class="q-tag">{planLabel}</Badge>
        {/if}
      </Card.Header>

      <Card.Content class="q-body">
        {#if readingError}
          <p class="note">
            {readingError === 'not signed in'
              ? 'This machine is not signed in to Claude, so there is no limit to read.'
              : readingError === 'token expired'
                ? 'The Claude login on this machine has expired. Claude Code owns that file — signing in there restores this reading.'
                : readingError}
          </p>
        {:else if orderedWindows.length === 0}
          <p class="note">No limit reading yet.</p>
        {:else}
          <Table.Root class="q-table">
            <Table.Header>
              <Table.Row>
                <Table.Head>Window</Table.Head>
                <Table.Head>Filled</Table.Head>
                <Table.Head class="num">Used</Table.Head>
                <Table.Head class="num">Resets in</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each orderedWindows as w (w.kind + (w.scopeLabel ?? ''))}
                {@const tone = band(w.percent)}
                <Table.Row>
                  <Table.Cell>{windowLabel(w)}</Table.Cell>
                  <Table.Cell class="wide">
                    <span
                      class="track"
                      role="progressbar"
                      aria-valuenow={w.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="{windowLabel(w)} limit"
                    >
                      <span class="fill {tone}" style="width: {Math.max(w.percent, 1)}%"></span>
                    </span>
                  </Table.Cell>
                  <Table.Cell class="num {tone}">{Math.round(w.percent)}%</Table.Cell>
                  <Table.Cell class="num muted">{resetsIn(w.resetsAt, now)}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}

        {#if claudeRows.length > 0}
          <Table.Root class="q-table">
            <Table.Header>
              <Table.Row>
                <Table.Head>Model</Table.Head>
                <Table.Head class="num">Output</Table.Head>
                <Table.Head class="num">At API prices</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each claudeRows as row (row.key)}
                <Table.Row>
                  <Table.Cell class="mono">{row.key}</Table.Cell>
                  <Table.Cell class="num">{compactNumber(row.output)}</Table.Cell>
                  <Table.Cell class="num">~{usd(row.costUsd)}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}

        {#if claudeTotals}
          <p class="note">
            <span class="tabular">~{usd(claudeTotals.costUsd)}</span> would cost on the API — your
            plan already covers it.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root class="q-card">
      <Card.Header class="q-head">
        <Card.Title class="q-title">opencode spend</Card.Title>
        <span class="q-sub">Recorded per message by opencode itself — real money, not an estimate</span>
      </Card.Header>

      <Card.Content class="q-body">
        {#if openCodeTotals}
          <div class="lede">
            <span class="big">{usd(openCodeTotals.costUsd)}</span>
            <span class="note">
              {compactNumber(openCodeTotals.input)} in · {compactNumber(openCodeTotals.output)} out ·
              {compactNumber(openCodeTotals.cacheRead)} cache read
            </span>
          </div>
        {/if}

        {#if openCodeRows.length > 0}
          <Table.Root class="q-table">
            <Table.Header>
              <Table.Row>
                <Table.Head>Model</Table.Head>
                <Table.Head class="num">Output</Table.Head>
                <Table.Head class="num">Cost</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each openCodeRows as row (row.key)}
                <Table.Row>
                  <Table.Cell class="mono">{row.key}</Table.Cell>
                  <Table.Cell class="num">{compactNumber(row.output)}</Table.Cell>
                  <Table.Cell class="num">{usd(row.costUsd)}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {:else}
          <p class="note">Nothing recorded yet.</p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- DailyChart brings its own heading and range switcher, so this card is
         all body — a second header here would only repeat it. -->
    <Card.Root class="q-card">
      <Card.Content class="q-body"><DailyChart /></Card.Content>
    </Card.Root>

    {#if dayGroups.length > 0}
      <Card.Root class="q-card">
        <Card.Header class="q-head">
          <Card.Title class="q-title">5-hour windows</Card.Title>
          <span class="q-sub">The windows as they actually fell, last 3 days</span>
        </Card.Header>
        <Card.Content class="q-body">
          <Table.Root class="q-table">
            <Table.Header>
              <Table.Row>
                <Table.Head>Window</Table.Head>
                <Table.Head>Harness</Table.Head>
                <Table.Head class="num">Cost</Table.Head>
                <Table.Head>Pace</Table.Head>
                <Table.Head>Models</Table.Head>
              </Table.Row>
            </Table.Header>
            {#each dayGroups as group (group.day)}
              <Table.Body>
                <Table.Row class="dayrow">
                  <Table.Head colspan={5} scope="colgroup">{group.day}</Table.Head>
                </Table.Row>
                {#each group.blocks as block (block.harness + block.id)}
                  <Table.Row>
                    <Table.Cell class="num-left">{clock(block.startTime)} – {clock(block.endTime)}</Table.Cell>
                    <Table.Cell class="muted">{block.harness}</Table.Cell>
                    <Table.Cell class="num">
                      {block.harness === 'Claude' ? '~' : ''}{usd(block.costUsd)}
                    </Table.Cell>
                    <Table.Cell class="pace">
                      {#if block.isActive && block.burnRate}
                        {usd(block.burnRate.costPerHour)}/h
                        {#if projectable(block) && block.projection}
                          · on pace for {block.harness === 'Claude'
                            ? '~'
                            : ''}{usd(block.projection.totalCost)}
                        {/if}
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="mono muted">{block.models.join(' · ')}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            {/each}
          </Table.Root>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- BreakdownTable owns its own heading, harness switch and tabs. -->
    <Card.Root class="q-card">
      <Card.Content class="q-body"><BreakdownTable /></Card.Content>
    </Card.Root>

    {#if missing.length > 0}
      <p class="note">
        No published price for <span class="mono">{missing.join(', ')}</span> — those read as $0
        rather than a guess.
      </p>
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
  .note {
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
  .mono {
    font-family: var(--font-mono);
    word-break: break-word;
  }
  .lede {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lede .big {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-numeric);
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }

  /* ---- shadcn primitives, dressed in Quiet Ledger tokens ------------------
     The classes below live on child-component elements, so they are addressed
     globally. Every value resolves through a DESIGN.md token; nothing here is a
     shadcn default (`rounded-2xl`, `ring-1`, `bg-card`, the 8/12/16 spacing
     ladder), because an unmodified shadcn surface is a High-severity tell. */
  :global {
    /* Card → the raised panel (was outpost Panel). */
    .q-card {
      background: var(--surface-raised);
      border-radius: var(--radius-panel);
      box-shadow: var(--shadow-lifted);
      padding: var(--space-5);
      gap: var(--space-4);
      overflow: visible;
      /* neutralise the stock ring/border shadcn ships on the card */
      --tw-ring-shadow: 0 0 transparent;
    }
    .q-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-1) var(--space-3);
      padding: 0;
    }
    .q-title {
      font-size: var(--text-md);
      font-weight: var(--weight-strong);
      line-height: var(--leading-tight);
      color: var(--ink-strong);
    }
    .q-sub {
      font-size: var(--text-sm);
      color: var(--ink-muted);
    }
    /* Badge → the plan tag. A quiet neutral chip (idle carries no status hue),
       not the stock solid-primary badge fill. */
    .q-tag {
      margin-left: auto;
      height: auto;
      border-radius: var(--radius-pill);
      background: var(--surface-field);
      border: 1px solid var(--border-hairline);
      color: var(--ink-muted);
      padding: 2px var(--space-3);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
    }
    .q-body {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: 0;
    }

    /* Stat tile → raised card wrapping a sunken hairline well. */
    .q-stat {
      height: 100%;
      background: var(--surface-raised);
      border-radius: var(--radius-panel);
      box-shadow: var(--shadow-lifted);
      padding: var(--space-4);
      overflow: visible;
      --tw-ring-shadow: 0 0 transparent;
    }
    .q-stat .q-well {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      justify-content: center;
      background: var(--surface-field);
      border: 1px solid var(--border-hairline);
      border-radius: var(--radius-well);
      padding: var(--space-4);
    }
    .q-stat .k {
      color: var(--ink-label);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
    }
    .q-stat .v {
      font-size: var(--text-3xl);
      font-weight: var(--weight-strong);
      line-height: var(--leading-numeric);
      color: var(--ink-strong);
      font-variant-numeric: tabular-nums;
    }
    .q-stat .u {
      color: var(--ink-muted);
      font-size: var(--text-sm);
    }

    /* Table → hairline dividers, uppercase micro-label header, tabular numerics.
       Table.Root ships its own overflow-x-auto container, so the whole card
       never scrolls sideways — the table does, inside the panel. */
    .q-table {
      width: 100%;
      min-width: max-content;
      border-collapse: collapse;
      font-variant-numeric: normal;
    }
    /* the primitives put dividers on the <tr>; ours live on the cells, so the
       row borders are zeroed to keep a single hairline (and its exact token). */
    .q-table tr {
      border: 0;
    }
    .q-table thead th {
      height: auto;
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: var(--track-caps);
      color: var(--ink-label);
      font-weight: var(--weight-strong);
      text-align: left;
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--border-divider);
      white-space: nowrap;
    }
    .q-table thead th.num {
      text-align: right;
    }
    .q-table td {
      font-size: var(--text-base);
      color: var(--ink-row);
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--border-hairline);
      vertical-align: middle;
      white-space: normal;
    }
    /* the primitive row ships a hover tint; these tables are read-only ledgers */
    .q-table tbody tr:hover {
      background: transparent;
    }
    .q-table tbody:last-child tr:last-child td {
      border-bottom: 0;
    }
    .q-table td.num,
    .q-table td.num-left {
      font-variant-numeric: tabular-nums;
    }
    .q-table td.num {
      text-align: right;
      white-space: nowrap;
      color: var(--ink-strong);
    }
    .q-table td.muted {
      color: var(--ink-muted);
    }
    .q-table td.mono {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      word-break: break-word;
    }
    .q-table td.wide {
      width: 40%;
      min-width: 90px;
    }
    .q-table td.pace {
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--status-attn-ink);
    }
    .q-table tr.dayrow th {
      color: var(--ink-muted);
      text-transform: none;
      letter-spacing: 0;
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
      border-bottom: 1px solid var(--border-hairline);
    }
    .q-table td.ok {
      color: var(--data-ok);
    }
    .q-table td.warn {
      color: var(--data-warn);
    }
    .q-table td.bad {
      color: var(--data-bad);
    }

    /* the inline progress bar (was .track / .fill). */
    .q-table .track {
      display: block;
      position: relative;
      height: 8px;
      border-radius: var(--radius-pill);
      background: var(--surface-sunken);
    }
    .q-table .fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: var(--radius-pill);
      transition: width var(--c-500) ease-out;
    }
    .q-table .fill.ok {
      background: var(--data-ok);
    }
    .q-table .fill.warn {
      background: var(--data-warn);
    }
    .q-table .fill.bad {
      background: var(--data-bad);
    }
  }
</style>

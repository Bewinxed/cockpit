<script lang="ts">
  /**
   * The usage surface: how much room is left, and where it went.
   *
   * Structure locked by the user (2026-08-16): split by harness. The two
   * harnesses never merge into one total, because they are not the same kind of
   * number — Claude is a subscription whose real constraint is a percentage, and
   * opencode is real money. Making that the layout means the page cannot lie by
   * addition.
   */
  import type { PageData } from './$types';
  import type { LimitWindow } from '@cockpit/core';
  import { Panel, StatCard, StatusPill } from '$lib/outpost';
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
        <StatCard label="{windowLabel(binding)} used" value="{Math.round(binding.percent)}%" />
        <StatCard label="Resets in" value={resetsIn(binding.resetsAt, now) || '—'} />
      {/if}
      <StatCard
        label="opencode spend"
        value={openCodeTotals ? usd(openCodeTotals.costUsd) : '—'}
        unit="real money"
      />
      <StatCard
        label="Claude at API prices"
        value={claudeTotals ? `~${usd(claudeTotals.costUsd)}` : '—'}
        unit="covered by the plan"
      />
      {#if planLabel}
        <StatCard label="Plan" value={planLabel} />
      {/if}
    </section>

    <Panel style="--c-card-pad: var(--space-5)">
      <header class="phead">
        <h2>Claude limits</h2>
        <span class="psub">Account-scoped — every signed-in machine reads the same numbers</span>
        {#if planLabel}
          <div class="pactions"><StatusPill status="idle">{planLabel}</StatusPill></div>
        {/if}
      </header>

      <div class="pbody">
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
          <table class="t">
            <thead>
              <tr>
                <th>Window</th>
                <th>Filled</th>
                <th class="num">Used</th>
                <th class="num">Resets in</th>
              </tr>
            </thead>
            <tbody>
              {#each orderedWindows as w (w.kind + (w.scopeLabel ?? ''))}
                {@const tone = band(w.percent)}
                <tr>
                  <td>{windowLabel(w)}</td>
                  <td class="wide">
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
                  </td>
                  <td class="num {tone}">{Math.round(w.percent)}%</td>
                  <td class="num muted">{resetsIn(w.resetsAt, now)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if claudeRows.length > 0}
          <table class="t">
            <thead>
              <tr>
                <th>Model</th>
                <th class="num">Output</th>
                <th class="num">At API prices</th>
              </tr>
            </thead>
            <tbody>
              {#each claudeRows as row (row.key)}
                <tr>
                  <td class="mono">{row.key}</td>
                  <td class="num">{compactNumber(row.output)}</td>
                  <td class="num">~{usd(row.costUsd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if claudeTotals}
          <p class="note">
            <span class="tabular">~{usd(claudeTotals.costUsd)}</span> would cost on the API — your
            plan already covers it.
          </p>
        {/if}
      </div>
    </Panel>

    <Panel style="--c-card-pad: var(--space-5)">
      <header class="phead">
        <h2>opencode spend</h2>
        <span class="psub">Recorded per message by opencode itself — real money, not an estimate</span>
      </header>

      <div class="pbody">
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
          <table class="t">
            <thead>
              <tr>
                <th>Model</th>
                <th class="num">Output</th>
                <th class="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {#each openCodeRows as row (row.key)}
                <tr>
                  <td class="mono">{row.key}</td>
                  <td class="num">{compactNumber(row.output)}</td>
                  <td class="num">{usd(row.costUsd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="note">Nothing recorded yet.</p>
        {/if}
      </div>
    </Panel>

    <!-- DailyChart brings its own heading and range switcher, so this panel is
         all body — a second header here would only repeat it. -->
    <Panel style="--c-card-pad: var(--space-5)">
      <div class="pbody"><DailyChart /></div>
    </Panel>

    {#if dayGroups.length > 0}
      <Panel style="--c-card-pad: var(--space-5)">
        <header class="phead">
          <h2>5-hour windows</h2>
          <span class="psub">The windows as they actually fell, last 3 days</span>
        </header>
        <div class="pbody">
          <table class="t">
            <thead>
              <tr>
                <th>Window</th>
                <th>Harness</th>
                <th class="num">Cost</th>
                <th>Pace</th>
                <th>Models</th>
              </tr>
            </thead>
            {#each dayGroups as group (group.day)}
              <tbody>
                <tr class="dayrow">
                  <th colspan="5" scope="colgroup">{group.day}</th>
                </tr>
                {#each group.blocks as block (block.harness + block.id)}
                  <tr>
                    <td class="num-left">{clock(block.startTime)} – {clock(block.endTime)}</td>
                    <td class="muted">{block.harness}</td>
                    <td class="num">
                      {block.harness === 'Claude' ? '~' : ''}{usd(block.costUsd)}
                    </td>
                    <td class="pace">
                      {#if block.isActive && block.burnRate}
                        {usd(block.burnRate.costPerHour)}/h
                        {#if projectable(block) && block.projection}
                          · on pace for {block.harness === 'Claude'
                            ? '~'
                            : ''}{usd(block.projection.totalCost)}
                        {/if}
                      {/if}
                    </td>
                    <td class="mono muted">{block.models.join(' · ')}</td>
                  </tr>
                {/each}
              </tbody>
            {/each}
          </table>
        </div>
      </Panel>
    {/if}

    <!-- BreakdownTable owns its own heading, harness switch and tabs. -->
    <Panel style="--c-card-pad: var(--space-5)">
      <div class="pbody"><BreakdownTable /></div>
    </Panel>

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
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .pactions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    /* Wide numeric tables (nowrap columns) exceed a phone viewport; scroll them
       inside the panel instead of forcing the whole page to scroll sideways. */
    overflow-x: auto;
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

  /* Tables: hairline dividers, small-caps label header, tabular numerics. */
  .t {
    width: 100%;
    /* Fills the panel when it fits; expands to its content width (making .pbody
       scroll) when the nowrap columns can't fit a narrow viewport. */
    min-width: max-content;
    border-collapse: collapse;
  }
  .t th {
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
  .t th.num {
    text-align: right;
  }
  .t td {
    font-size: var(--text-base);
    color: var(--ink-row);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-hairline);
    vertical-align: middle;
  }
  .t tbody:last-child tr:last-child td {
    border-bottom: 0;
  }
  .t td.num,
  .t td.num-left {
    font-variant-numeric: tabular-nums;
  }
  .t td.num {
    text-align: right;
    white-space: nowrap;
    color: var(--ink-strong);
  }
  .t td.muted {
    color: var(--ink-muted);
  }
  .t td.mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    word-break: break-word;
  }
  .t td.wide {
    width: 40%;
    min-width: 90px;
  }
  .t td.pace {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--status-attn-ink);
  }
  .t tr.dayrow th {
    color: var(--ink-muted);
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--border-hairline);
  }
  .t td.ok {
    color: var(--data-ok);
  }
  .t td.warn {
    color: var(--data-warn);
  }
  .t td.bad {
    color: var(--data-bad);
  }

  .track {
    display: block;
    position: relative;
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--surface-sunken);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: var(--radius-pill);
    transition: width var(--c-500) ease-out;
  }
  .fill.ok {
    background: var(--data-ok);
  }
  .fill.warn {
    background: var(--data-warn);
  }
  .fill.bad {
    background: var(--data-bad);
  }
</style>

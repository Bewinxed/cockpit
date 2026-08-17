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
  import { Badge } from '$lib/components/ui/badge';
  import IconClaude from '~icons/solar/stars-minimalistic-bold-duotone';
  import IconOpenCode from '~icons/solar/code-square-bold-duotone';
  import IconWindow from '~icons/solar/hourglass-line-duotone';
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

  const band = (pct: number): 'calm' | 'warn' | 'critical' =>
    pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'calm';
  const FILL: Record<string, string> = {
    calm: 'bg-muted-foreground/50',
    warn: 'bg-warning',
    critical: 'bg-destructive',
  };
  const TEXT: Record<string, string> = {
    calm: 'text-foreground',
    warn: 'text-warning',
    critical: 'text-destructive',
  };

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

<!--
  THESIS: how much room is left, and where it went — refusing the dashboard
  default that sums every provider into one meaningless total.
  OWN-WORLD: Daylight Studio, unchanged. Warm neutrals, one olive that only ever
  means "this acts", state hues reserved for how close a limit is, rounded-xl
  cards on soft warm shadow, hairlines between rows, TX-02 for data only.
  STORY: the operator glances, sees which window binds first and when it resets,
  and can name what spent it.
  FIRST VIEWPORT: route header, then two cards side by side that never merge —
  Claude led by its limit meters and reset countdowns, opencode led by real
  dollars. No primary action; this surface is read, not operated.
  FORM: split by harness, third on the ranked list, seed f9c9e4e0.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the
  finish review, the verdict, DESIGN.md, and every shipping raster carrying its
  provenance.
-->

<div class="flex min-h-0 flex-1">
  <div class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
    <div class="mx-auto flex max-w-5xl flex-col gap-5 2xl:max-w-none">
      <header class="flex items-center gap-3">
        <h1 class="text-title">Usage</h1>
        {#if reading}
          {@const binding = orderedWindows.find((w) => w.isActive) ?? orderedWindows[0]}
          {#if binding}
            <span class="text-micro text-muted-foreground">
              {windowLabel(binding).toLowerCase()} binds first · resets in {resetsIn(
                binding.resetsAt,
                now
              )}
            </span>
          {/if}
        {/if}
        {#if planLabel}
          <Badge variant="secondary" class="ml-auto font-normal">{planLabel}</Badge>
        {/if}
      </header>

      {#if data.error}
        <p class="text-caption">{data.error}</p>
      {/if}

      <!-- Two truths, side by side, never added together. -->
      <div
        class="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fit,minmax(480px,1fr))]
               2xl:grid-cols-[repeat(auto-fit,minmax(620px,1fr))]"
      >
        <!-- Claude: the constraint is a percentage, so percentages lead. -->
        <section class="rounded-xl bg-card shadow-md">
          <header class="flex items-center gap-2 px-4 py-3">
            <IconClaude class="size-5 text-muted-foreground" />
            <span class="text-sm font-semibold">Claude</span>
            <span class="ml-auto text-micro text-muted-foreground">limits</span>
          </header>

          {#if readingError}
            <p class="px-4 pb-4 text-caption">
              {readingError === 'not signed in'
                ? 'This machine is not signed in to Claude, so there is no limit to read.'
                : readingError === 'token expired'
                  ? 'The Claude login on this machine has expired. Claude Code owns that file — signing in there restores this reading.'
                  : readingError}
            </p>
          {:else if orderedWindows.length === 0}
            <p class="px-4 pb-4 text-caption">No limit reading yet.</p>
          {:else}
            <ul class="border-t border-border/50">
              {#each orderedWindows as w (w.kind + (w.scopeLabel ?? ''))}
                {@const tone = band(w.percent)}
                <li class="flex min-h-9 items-center gap-3 px-4 py-2">
                  <span class="w-28 shrink-0 truncate text-micro">{windowLabel(w)}</span>
                  <span
                    class="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={w.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="{windowLabel(w)} limit"
                  >
                    <span
                      class="absolute inset-y-0 left-0 rounded-full {FILL[tone]}
                             transition-[width,background-color] duration-500 ease-out"
                      style="width: {Math.max(w.percent, 1)}%"
                    ></span>
                  </span>
                  <span class="w-10 shrink-0 text-right text-micro tabular-nums {TEXT[tone]}">
                    {Math.round(w.percent)}%
                  </span>
                  <span class="w-16 shrink-0 text-right text-micro tabular-nums text-muted-foreground">
                    {resetsIn(w.resetsAt, now)}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          {#if claudeRows.length > 0}
            <ul class="border-t border-border/50">
              {#each claudeRows as row (row.key)}
                <li class="flex min-h-9 items-center gap-3 px-4 py-1.5">
                  <span class="min-w-0 flex-1 truncate font-mono text-micro">{row.key}</span>
                  <span class="shrink-0 text-micro tabular-nums text-muted-foreground">
                    {compactNumber(row.output)} out
                  </span>
                  <span class="w-20 shrink-0 text-right text-micro tabular-nums text-muted-foreground">
                    ~{usd(row.costUsd)}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          {#if claudeTotals}
            <p class="border-t border-border/50 px-4 py-2.5 text-micro text-muted-foreground">
              <span class="tabular-nums">~{usd(claudeTotals.costUsd)}</span> would cost on the API —
              your plan already covers it.
            </p>
          {/if}
        </section>

        <!-- opencode: real money, so the money leads. -->
        <section class="rounded-xl bg-card shadow-md">
          <header class="flex items-center gap-2 px-4 py-3">
            <IconOpenCode class="size-5 text-muted-foreground" />
            <span class="text-sm font-semibold">opencode</span>
            <span class="ml-auto text-micro text-muted-foreground">spend</span>
          </header>

          {#if openCodeTotals}
            <div class="px-4 pb-3">
              <p class="text-display tabular-nums">{usd(openCodeTotals.costUsd)}</p>
              <p class="text-micro tabular-nums text-muted-foreground">
                {compactNumber(openCodeTotals.input)} in · {compactNumber(openCodeTotals.output)} out
                · {compactNumber(openCodeTotals.cacheRead)} cache read
              </p>
            </div>
          {/if}

          {#if openCodeRows.length > 0}
            <ul class="border-t border-border/50">
              {#each openCodeRows as row (row.key)}
                <li class="flex min-h-9 items-center gap-3 px-4 py-1.5">
                  <span class="min-w-0 flex-1 truncate font-mono text-micro">{row.key}</span>
                  <span class="shrink-0 text-micro tabular-nums text-muted-foreground">
                    {compactNumber(row.output)} out
                  </span>
                  <span class="w-20 shrink-0 text-right text-micro tabular-nums">
                    {usd(row.costUsd)}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          <p class="border-t border-border/50 px-4 py-2.5 text-micro text-muted-foreground">
            Recorded per message by opencode itself — real money, not an estimate.
          </p>
        </section>
      </div>

      <!-- The windows themselves, as they actually fell. -->
      <DailyChart />

      {#if dayGroups.length > 0}
        <section class="rounded-xl bg-card shadow-md">
          <header class="flex items-center gap-2 px-4 py-3">
            <IconWindow class="size-5 text-muted-foreground" />
            <span class="text-sm font-semibold">5-hour windows</span>
            <span class="ml-auto text-micro text-muted-foreground">last 3 days</span>
          </header>

          {#each dayGroups as group (group.day)}
            <div class="border-t border-border/50">
              <p class="px-4 pt-2.5 pb-1 text-micro text-muted-foreground">{group.day}</p>
              <ul>
                {#each group.blocks as block (block.harness + block.id)}
                  <li class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5">
                    <span class="w-32 shrink-0 text-micro tabular-nums">
                      {clock(block.startTime)} – {clock(block.endTime)}
                    </span>
                    <span class="w-16 shrink-0 text-micro text-muted-foreground">
                      {block.harness}
                    </span>
                    <span class="w-20 shrink-0 text-micro tabular-nums">
                      {block.harness === 'Claude' ? '~' : ''}{usd(block.costUsd)}
                    </span>
                    {#if block.isActive && block.burnRate}
                      <span class="shrink-0 text-micro tabular-nums text-warning">
                        {usd(block.burnRate.costPerHour)}/h
                        {#if projectable(block) && block.projection}
                          · on pace for {block.harness === 'Claude'
                            ? '~'
                            : ''}{usd(block.projection.totalCost)}
                        {/if}
                      </span>
                    {/if}
                    <span
                      class="min-w-0 flex-1 truncate text-right font-mono text-micro text-muted-foreground"
                    >
                      {block.models.join(' · ')}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </section>
      {/if}

      <BreakdownTable />

      {#if missing.length > 0}
        <p class="text-micro text-muted-foreground">
          No published price for <span class="font-mono">{missing.join(', ')}</span> — those read as
          $0 rather than a guess.
        </p>
      {/if}
    </div>
  </div>
</div>

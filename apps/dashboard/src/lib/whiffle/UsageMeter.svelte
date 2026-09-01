<script lang="ts">
  /**
   * How full the machine's Claude limits are, on the dock next to ContextMeter.
   * The two answer the same "am I about to hit a wall?" question for the same
   * session, so this pill reads as its sibling: two stacked hairlines and a
   * number at rest, colour only when it matters, Popover on click.
   *
   * The limits arrive live over the socket (the hub's `kind: 'usage'` frame),
   * folded into `whiffle.usageLimitsFor` — no polling. The opencode spend is
   * fetched on open, once, because it is a heavy REST aggregate rather than a
   * pushed number.
   */
  import { onMount } from 'svelte';
  import type { ClaudeLimits, LimitWindow } from '@whiffle/core';
  import * as Popover from '$lib/components/ui/popover';
  import { Badge } from '$lib/components/ui/badge';
  import IconClock from '~icons/solar/clock-circle-linear';
  import IconHourglass from '~icons/solar/hourglass-line-duotone';
  import IconDollar from '~icons/solar/dollar-linear';
  import { whiffle } from './client.svelte';

  interface Props {
    /**
     * Optional, and usually absent. Limits are account-scoped, not
     * machine-scoped — every host signed in to the same account reads the same
     * numbers — so the chrome asks for whichever reading exists rather than
     * naming a machine.
     */
    machineId?: string;
  }

  let { machineId }: Props = $props();

  const limits: ClaudeLimits | null = $derived(
    machineId ? whiffle.usageLimitsFor(machineId) : whiffle.usageLimitsAny()
  );

  /** The three bands, identical thresholds to ContextMeter so the two read as one system. */
  const FILL: Record<string, string> = {
    calm: 'bg-muted-foreground/60',
    warn: 'bg-warning',
    critical: 'bg-destructive',
  };
  const TEXT: Record<string, string> = {
    calm: 'text-muted-foreground',
    warn: 'text-warning',
    critical: 'text-destructive',
  };
  const band = (pct: number): 'calm' | 'warn' | 'critical' =>
    pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'calm';

  const windows = $derived(limits?.windows ?? []);
  /** The 5-hour hairline: the session window. */
  const sessionWindow = $derived(windows.find((w) => w.group === 'session') ?? null);
  /** The weekly hairline: the active weekly window, else the fullest one. */
  const weeklyWindow = $derived(
    windows.find((w) => w.group === 'weekly' && w.isActive) ??
      windows
        .filter((w) => w.group === 'weekly')
        .reduce<LimitWindow | null>(
          (best, w) => (best === null || w.percent > best.percent ? w : best),
          null
        )
  );

  const fivePct = $derived(sessionWindow?.percent ?? null);
  const weekPct = $derived(weeklyWindow?.percent ?? null);

  const label = $derived.by(() => {
    if (fivePct !== null && weekPct !== null) return `${Math.round(fivePct)}% · ${Math.round(weekPct)}%`;
    if (fivePct !== null) return `${Math.round(fivePct)}%`;
    if (weekPct !== null) return `${Math.round(weekPct)}%`;
    return '—';
  });

  /**
   * The dock shows ONE number: the window that will stop you first. Two
   * percentages side by side in a composer read as arithmetic nobody asked for,
   * and colouring them both by the worse of the two says a 4% window is urgent
   * when it is not. The full set is one tap away, where it has room to be read.
   */
  const binding = $derived.by(() => {
    const scored = windows.filter((w) => typeof w.percent === 'number');
    if (scored.length === 0) return null;
    return scored.reduce((worst, w) => (w.percent > worst.percent ? w : worst));
  });
  const bindingPct = $derived(binding?.percent ?? null);

  /** Why there is nothing to meter — a normal state, never a fake 0%. */
  const emptyReason = $derived.by(() => {
    if (limits === null) return 'No limit reading yet.';
    if (limits.error === 'not signed in') return 'No limit reading — this machine is not signed in to Claude.';
    if (limits.error === 'token expired') return 'The Claude login on this machine has expired.';
    if (limits.error) {
      // A stale reading still has its windows; show them and flag the age.
      if (limits.stale && windows.length > 0) return null;
      return limits.error;
    }
    return null;
  });

  /** Surfaced only when the windows shown are a stale last-good reading. */
  const staleNote = $derived(
    limits?.stale && limits.error ? `last good reading · ${limits.error}` : null
  );

  /** There are real windows to show; anything else is an empty state. */
  const hasReading = $derived(emptyReason === null);

  /** A live clock for the countdowns; minute granularity is all they show. */
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  function resetsIn(resetsAt: string | null, at: number): string {
    if (!resetsAt) return '';
    const diff = new Date(resetsAt).getTime() - at;
    if (diff <= 0) return 'resetting now';
    const totalMin = Math.floor(diff / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `resets in ${h}h ${m}m`;
    if (m > 0) return `resets in ${m}m`;
    return 'resets in <1m';
  }

  function windowLabel(w: LimitWindow): string {
    if (w.group === 'session') return '5-hour';
    if (w.group === 'weekly') return w.scopeLabel ? `Weekly · ${w.scopeLabel}` : 'Weekly';
    return w.kind;
  }

  const planLabel = (tier: string | null): string | null => {
    if (!tier) return null;
    return tier
      .replace(/^default_claude_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const usd = (n: number): string => `$${n.toFixed(2)}`;

  /** The opencode spend, fetched on open — real dollars, never a guess. */
  let spend = $state<{ today: number; total: number } | null>(null);

  async function refreshSpend(): Promise<void> {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const since = day.getTime();
    const query = machineId
      ? `harness=opencode&machineId=${encodeURIComponent(machineId)}`
      : 'harness=opencode';
    try {
      const [totalRes, todayRes] = await Promise.all([
        fetch(`/api/usage/summary?${query}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/usage/summary?${query}&since=${since}`).then((r) => (r.ok ? r.json() : null)),
      ]);
      spend = {
        total: totalRes?.totals?.costUsd ?? 0,
        today: todayRes?.totals?.costUsd ?? 0,
      };
    } catch {
      // Keep the last reading; the pill is a glance, not a report.
    }
  }
</script>

<Popover.Root
  onOpenChange={(open) => {
    if (open) void refreshSpend();
  }}
>
  <Popover.Trigger
    class="flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5
           text-micro tabular-nums
           hover:bg-muted
           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring
           transition-[background-color,color] duration-150 ease-out
           {hasReading && bindingPct !== null
      ? TEXT[band(bindingPct)]
      : 'text-muted-foreground'}"
    title={hasReading && binding
      ? `${windowLabel(binding)} limit — ${Math.round(binding.percent)}% used, ${resetsIn(binding.resetsAt, now)}${staleNote ? ` · ${staleNote}` : ''}`
      : 'Claude usage limits'}
    aria-label={hasReading && binding
      ? `Claude limits. ${windowLabel(binding)} window ${Math.round(binding.percent)} percent used, the fullest of ${windows.length}. Show them all.${staleNote ? ` ${staleNote}.` : ''}`
      : `Claude usage limits. ${emptyReason}`}
  >
    {#if hasReading && binding}
      <!-- An hourglass, because this meter is about a window that refills —
           and because a bare bar beside the context meter's bare bar would be
           two identical readings of two different things. -->
      <IconHourglass class="size-3.5 shrink-0" aria-hidden="true" />
      <span
        role="progressbar"
        aria-valuenow={Math.round(binding.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="{windowLabel(binding)} limit">{Math.round(binding.percent)}%</span
      >
    {:else}
      <span class="text-muted-foreground">—</span>
    {/if}
  </Popover.Trigger>

  <Popover.Content class="w-80 rounded-[var(--radius-panel)] p-0 shadow-lg" align="end" side="top">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <IconClock class="size-4 text-muted-foreground" />
      <span class="text-sm font-medium">Usage limits</span>
      {#if hasReading && limits && planLabel(limits.planTier)}
        <Badge variant="outline" class="ml-auto font-mono text-micro">{planLabel(limits.planTier)}</Badge>
      {/if}
    </div>

    {#if staleNote}
      <p class="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">{staleNote}</p>
    {/if}

    {#if emptyReason}
      <p class="px-3 py-4 text-micro text-muted-foreground">{emptyReason}</p>
    {:else}
      <ul class="px-3 py-2">
        {#each windows as window (window.kind)}
          <li class="flex flex-col gap-1 py-1.5">
            <div class="flex items-center gap-1.5">
              <span class="min-w-0 truncate text-micro font-medium">{windowLabel(window)}</span>
              {#if window.isActive}
                <span class="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                  active
                </span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <span
                class="relative h-1 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={window.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="{windowLabel(window)} limit"
              >
                <span
                  class="absolute inset-y-0 left-0 rounded-full {FILL[band(window.percent)]}
                         transition-[width,background-color] duration-500 ease-out"
                  style="width: {window.percent}%"
                ></span>
              </span>
              <span class="shrink-0 text-micro tabular-nums {TEXT[band(window.percent)]}">
                {Math.round(window.percent)}%
              </span>
            </div>
            {#if window.resetsAt}
              <span class="text-micro tabular-nums text-muted-foreground">
                {resetsIn(window.resetsAt, now)}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="border-t border-border px-3 py-2.5">
      <div class="flex items-center gap-2">
        <IconDollar class="size-3.5 text-muted-foreground" />
        <span class="text-micro font-medium">opencode</span>
        <span class="ml-auto text-micro tabular-nums text-muted-foreground">
          {#if spend}
            {usd(spend.today)} today · {usd(spend.total)} total
          {:else}
            —
          {/if}
        </span>
      </div>
    </div>

    <a
      href="/usage"
      class="flex items-center justify-between border-t border-border px-3 py-2
             text-micro font-medium text-primary
             transition-colors duration-150 ease-out hover:bg-muted"
    >
      Open full usage
      <span aria-hidden="true">→</span>
    </a>
  </Popover.Content>
</Popover.Root>

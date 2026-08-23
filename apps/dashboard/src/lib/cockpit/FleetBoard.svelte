<script lang="ts">
  /**
   * The fleet board — every session across every machine as one ledger table,
   * with the four counts that say whether the fleet needs you above it.
   * Built from the design source (mocks/v2-fleet.html · mocks/v5-*.html) on
   * shadcn-svelte primitives, token-dressed in the Quiet Ledger system: the
   * stat row is a shadcn Card recessed-well, the filter bar is ui/input +
   * ui/select, the status column is ui/badge, the eight-column ledger is
   * ui/table, and paging is ui/pagination.
   *
   * Live and stored sessions are the same kind of row here. A stored session
   * whose transcript is already running somewhere is dropped — the live row is
   * the same conversation, and it is the one that can still be spoken to.
   */
  import type { Component } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { SDKSessionInfo } from '@cockpit/core';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Select from '$lib/components/ui/select';
  import * as Table from '$lib/components/ui/table';
  import * as Pagination from '$lib/components/ui/pagination';
  import SpawnPanel from '$lib/cockpit/SpawnPanel.svelte';
  import {
    cockpit,
    isFailed,
    isResumable,
    reconnectNow,
    resumeSession,
    setPeeked,
    type InstanceRow,
  } from './client.svelte';
  import { markHue, sessionSprite, type MarkHue } from './mark';
  import { machineLabel } from './machine';
  import { sessionTitle, transcriptHref } from './links';
  import { formatDistanceToNow } from '$lib/utils/time';
  import {
    IconDownload,
    IconExternal,
    IconHistory,
    IconMaximize,
    IconPlay,
    IconPlus,
    IconSearch,
  } from '$lib/icons';

  let { active }: { active: boolean } = $props();

  const PAGE_SIZE = 12;

  type PillStatus = 'live' | 'attn' | 'fail' | 'idle';

  interface Row {
    key: string;
    title: string;
    machineId: string;
    machine: string;
    harness: string;
    harnessLabel: string;
    hue: MarkHue;
    sprite: Component;
    status: PillStatus;
    stateLabel: string;
    turns: number | null;
    contextPct: number | null;
    cost: number | null;
    at: number | undefined;
    href: string;
    instance: InstanceRow | null;
    stored: SDKSessionInfo | null;
    cwd: string;
  }

  function harnessLabelOf(harness: string): string {
    switch (harness) {
      case 'claude':
        return 'Claude Code';
      case 'opencode':
        return 'OpenCode';
      case 'pi':
        return 'pi';
      default:
        return harness;
    }
  }

  function liveState(instance: InstanceRow): { status: PillStatus; label: string } {
    if (isFailed(instance)) return { status: 'fail', label: 'Failed' };
    switch (cockpit.activityOf(instance.id)) {
      case 'blocked':
        return { status: 'attn', label: 'Needs you' };
      case 'working':
        return { status: 'live', label: 'Working' };
      default:
        return { status: 'idle', label: 'Idle' };
    }
  }

  const rows = $derived.by<Row[]>(() => {
    const live = cockpit.runningInstances.map((instance): Row => {
      const stats = cockpit.statsOf(instance.id);
      const state = liveState(instance);
      const machine = cockpit.machines.find((m) => m.machineId === instance.machineId);
      const harness = instance.harness ?? 'claude';
      return {
        key: instance.id,
        title: instance.title ?? 'untitled session',
        machineId: instance.machineId,
        machine: machine ? machineLabel(machine.hostname) : instance.machineId,
        harness,
        harnessLabel: harnessLabelOf(harness),
        hue: markHue(instance.cwd || instance.machineId),
        sprite: sessionSprite(instance.id),
        status: state.status,
        stateLabel: state.label,
        turns: stats.turns,
        contextPct: stats.contextPct,
        cost: stats.cost,
        at: cockpit.pulseAt(instance.id),
        href: `/session/${instance.id}`,
        instance,
        stored: null,
        cwd: instance.cwd,
      };
    });

    const running = new Set(live.map((row) => row.instance?.sessionId).filter(Boolean));
    const stored = cockpit.machines.flatMap((machine) =>
      cockpit
        .catalogOf(machine.machineId)
        .filter((info) => !running.has(info.sessionId))
        .map(
          (info): Row => ({
            key: `${machine.machineId}:${info.sessionId}`,
            title: sessionTitle(info),
            machineId: machine.machineId,
            machine: machineLabel(machine.hostname),
            harness: info.harness,
            harnessLabel: harnessLabelOf(info.harness),
            hue: markHue(info.cwd || machine.machineId),
            sprite: sessionSprite(info.sessionId),
            status: 'idle',
            stateLabel: 'Idle',
            turns: null,
            contextPct: null,
            cost: null,
            at: info.lastModified,
            href: transcriptHref(machine.machineId, info),
            instance: null,
            stored: info,
            cwd: info.cwd ?? '',
          })
        )
    );

    return [...live, ...stored].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  });

  const spend = $derived(
    cockpit.runningInstances.reduce((sum, row) => sum + (cockpit.statsOf(row.id).cost ?? 0), 0)
  );

  /* ---- filters ------------------------------------------------------- */

  let search = $state('');
  /** '' is "All machines"; otherwise a machineId. */
  let machineFilter = $state('');
  const STATES: { value: PillStatus | ''; label: string }[] = [
    { value: '', label: 'All states' },
    { value: 'live', label: 'Working' },
    { value: 'attn', label: 'Needs you' },
    { value: 'idle', label: 'Idle' },
  ];
  let stateFilter = $state<PillStatus | ''>('');
  const SORTS: { value: 'recent' | 'name'; label: string }[] = [
    { value: 'recent', label: 'Last active' },
    { value: 'name', label: 'Name (A–Z)' },
  ];
  let sortBy = $state<'recent' | 'name'>('recent');
  let pageNo = $state(1);

  const machineName = $derived(
    machineFilter
      ? (rows.find((row) => row.machineId === machineFilter)?.machine ?? machineFilter)
      : 'All machines'
  );
  const stateName = $derived(STATES.find((s) => s.value === stateFilter)?.label ?? 'All states');
  /** The blocked list only means "nothing needs you" while the socket is live. */
  const hubLive = $derived(cockpit.hub === 'connected');
  const sortName = $derived(SORTS.find((s) => s.value === sortBy)?.label ?? 'Last active');

  const filtered = $derived(
    rows.filter((row) => {
      const needle = search.trim().toLowerCase();
      if (needle && !row.title.toLowerCase().includes(needle)) return false;
      if (machineFilter && row.machineId !== machineFilter) return false;
      if (stateFilter && row.status !== stateFilter) return false;
      return true;
    })
  );

  const sorted = $derived(
    sortBy === 'name'
      ? [...filtered].sort((a, b) => a.title.localeCompare(b.title))
      : [...filtered].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  );

  const pageCount = $derived(Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)));
  const paged = $derived(sorted.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE));

  // A filter that shrinks the list out from under the current page leaves it
  // showing nothing at all; the first page always has rows.
  $effect(() => {
    if (pageNo > pageCount) pageNo = 1;
  });

  /* ---- actions ------------------------------------------------------- */

  let spawnOpen = $state(false);
  let spawnPrefill = $state<{ machineId?: string; cwd?: string } | undefined>(undefined);

  // "Spawn here" from anywhere else in the app arrives as a query on the board's
  // own URL. It is consumed once and cleared, so a reload is not a second spawn.
  $effect(() => {
    if (!active) return;
    const machineId = page.url.searchParams.get('machine');
    if (!machineId) return;
    spawnPrefill = { machineId, cwd: page.url.searchParams.get('cwd') ?? undefined };
    spawnOpen = true;
    void goto('/session', { replaceState: true });
  });

  function startSession() {
    spawnPrefill = undefined;
    spawnOpen = true;
  }

  function resume(row: Row) {
    const sessionId = row.instance?.sessionId ?? row.stored?.sessionId;
    if (!sessionId) return;
    const id = resumeSession({
      machineId: row.machineId,
      cwd: row.cwd,
      sessionId,
      harness: row.harness as never,
    });
    void goto(`/session/${id}`);
  }

  function exportCsv() {
    const head = ['Session', 'Machine', 'Harness', 'Turns', 'Context', 'Last activity', 'State'];
    const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const body = filtered.map((row) =>
      [
        row.title,
        row.machine,
        row.harnessLabel,
        row.turns === null ? '' : String(row.turns),
        row.contextPct === null ? '' : `${Math.round(row.contextPct)}%`,
        row.at ? new Date(row.at).toISOString() : '',
        row.stateLabel,
      ]
        .map(cell)
        .join(',')
    );
    const blob = new Blob([[head.map(cell).join(','), ...body].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fleet-sessions.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ---- cells --------------------------------------------------------- */

  const contextClass = (pct: number | null) =>
    pct === null ? '' : pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '';

  // The stat tile IS the recessed-well signature: a shadcn Card (raised) whose
  // body is a sunken hairline well — a number sits *in* something, never on it.
  // tailwind-merge drops the stock bg-card / ring defaults.
  const tileClass =
    'h-full gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--c-card-pad)] shadow-[var(--shadow-lifted)] ring-0';

  // The status column, dressed on ui/badge: a light tint carries the meaning,
  // deepened ink carries the legibility. Idle carries no fill — absence is idle.
  const pillBase =
    'h-[var(--c-pill-h)] gap-[var(--c-pill-gap)] rounded-[var(--radius-pill)] border-transparent px-[10px] [font-size:var(--c-pill-fs)] [font-weight:var(--weight-strong)] whitespace-nowrap';
  const pillTint: Record<PillStatus, string> = {
    live: 'bg-[var(--status-live-bg)] text-[var(--status-live-ink)]',
    attn: 'bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]',
    fail: 'bg-[var(--status-fail-bg)] text-[var(--status-fail-ink)]',
    idle: 'bg-transparent px-0 text-[var(--ink-muted)] [font-weight:var(--weight-medium)]',
  };
</script>

<div class="board">
  <div class="inner">
    <div class="head">
      <div>
        <h1>Fleet</h1>
        <p>Every agent across your machines, and what needs you.</p>
      </div>
      <Button onclick={startSession}>
        <IconPlus />
        Start session
      </Button>
    </div>

    {#snippet stat(label: string, value: string | number, unit?: string)}
      <Card.Root class={tileClass}>
        <div class="well">
          <span class="k">{label}</span>
          <span class="v">{value}</span>
          {#if unit}<span class="u">{unit}</span>{/if}
        </div>
      </Card.Root>
    {/snippet}

    <div class="stats">
      {@render stat('Sessions', cockpit.runningInstances.length)}

      <!-- Needs you is not a readout. It names this surface's job, so it is the
           control that reaches it (DESIGN.md §Open questions): pressing it
           filters the board down to exactly the sessions it counts.

           And it never says "0" on a guess. cockpit.blocked is only true when
           the socket is live; while the hub is connecting or unreachable an
           empty list means "not read yet", and printing 0 there is a false
           all-clear — the one failure the Switch interview names by hand. -->
      <button
        type="button"
        class="attn-tile"
        aria-pressed={stateFilter === 'attn'}
        aria-label={hubLive
          ? `Needs you: ${cockpit.blocked.length}. Show only sessions that need you.`
          : 'Needs you: unknown while reconnecting. Show only sessions that need you.'}
        onclick={() => {
          stateFilter = stateFilter === 'attn' ? '' : 'attn';
          pageNo = 1;
        }}
      >
        <Card.Root class={tileClass}>
          <div class="well">
            <span class="k">Needs you</span>
            {#if hubLive}
              <span class="v">{cockpit.blocked.length}</span>
            {:else}
              <span class="v unknown" title="Unknown while reconnecting">—</span>
              <span class="u">unknown while reconnecting</span>
            {/if}
          </div>
        </Card.Root>
      </button>

      {@render stat('Machines', cockpit.onlineMachines.length, `of ${cockpit.machines.length}`)}
      {@render stat('Spend today', `$${spend.toFixed(2)}`)}
    </div>

    <div class="panel">
      {#if cockpit.hub === 'unreachable'}
        <div class="empty">
          <b>Can't reach the hub</b>
          <p>Nothing on the fleet can be read until the connection is back.</p>
          <Button variant="outline" onclick={() => reconnectNow()}>Retry</Button>
        </div>
      {:else if cockpit.machines.length === 0}
        <div class="empty">
          <b>No machines yet</b>
          <p>Run <code>cockpit</code> on a machine and it joins this board by itself.</p>
        </div>
      {:else if rows.length === 0}
        <div class="empty">
          <b>{cockpit.onlineMachines.length} machines online, no sessions running.</b>
          <Button onclick={startSession}>
            <IconPlus />
            Start session
          </Button>
        </div>
      {:else}
        <div class="bar">
          <div class="search">
            <span class="lead"><IconSearch /></span>
            <Input
              class="search-input"
              bind:value={search}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              oninput={() => (pageNo = 1)}
            />
          </div>

          <Select.Root
            type="single"
            value={machineFilter || 'all'}
            onValueChange={(v) => ((machineFilter = v === 'all' ? '' : v), (pageNo = 1))}
          >
            <Select.Trigger class="min-w-[168px]">{machineName}</Select.Trigger>
            <Select.Content>
              <Select.Item value="all" label="All machines">All machines</Select.Item>
              {#each cockpit.machines as m (m.machineId)}
                <Select.Item value={m.machineId} label={machineLabel(m.hostname)}>
                  {machineLabel(m.hostname)}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>

          <Select.Root
            type="single"
            value={stateFilter || 'all'}
            onValueChange={(v) => (
              (stateFilter = (v === 'all' ? '' : v) as PillStatus | ''), (pageNo = 1)
            )}
          >
            <Select.Trigger class="min-w-[140px]">{stateName}</Select.Trigger>
            <Select.Content>
              {#each STATES as s (s.label)}
                <Select.Item value={s.value || 'all'} label={s.label}>{s.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>

          <Select.Root
            type="single"
            value={sortBy}
            onValueChange={(v) => (sortBy = v as 'recent' | 'name')}
          >
            <Select.Trigger class="min-w-[150px]">{sortName}</Select.Trigger>
            <Select.Content>
              {#each SORTS as s (s.value)}
                <Select.Item value={s.value} label={s.label}>{s.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>

          <Button variant="outline" class="ml-auto max-[900px]:ml-0" onclick={exportCsv}>
            <IconDownload />
            Export CSV
          </Button>
        </div>

        <div class="tbl">
          <Table.Root class="min-w-[860px]">
            <Table.Header>
              <Table.Row>
                <Table.Head class="s-name">Session</Table.Head>
                <Table.Head>Machine</Table.Head>
                <Table.Head>Harness</Table.Head>
                <Table.Head class="num">Turns</Table.Head>
                <Table.Head class="num">Context</Table.Head>
                <Table.Head>Last activity</Table.Head>
                <Table.Head>State</Table.Head>
                <Table.Head class="s-act">Action</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each paged as row (row.key)}
                {@const Sprite = row.sprite}
                <Table.Row>
                  <Table.Cell>
                    <div class="nm">
                      <span
                        class="mark"
                        style="background-color: var(--mark-{row.hue});"
                        aria-hidden="true"
                      >
                        <Sprite />
                      </span>
                      <a href={row.href}>{row.title}</a>
                    </div>
                  </Table.Cell>
                  <Table.Cell class="mut">{row.machine}</Table.Cell>
                  <Table.Cell class="mut">{row.harnessLabel}</Table.Cell>
                  <Table.Cell class="num">{row.turns ?? '—'}</Table.Cell>
                  <Table.Cell class={cn('num', contextClass(row.contextPct))}>
                    {row.contextPct === null ? '—' : `${Math.round(row.contextPct)}%`}
                  </Table.Cell>
                  <Table.Cell>
                    <span class="when">
                      <IconHistory />
                      {row.at ? formatDistanceToNow(new Date(row.at)) : '—'}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge class={cn(pillBase, pillTint[row.status])}>{row.stateLabel}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <div class="act">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        href={row.href}
                        aria-label="Open {row.title}"
                      >
                        <IconExternal />
                      </Button>
                      {#if row.instance}
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Peek {row.title}"
                          onclick={() => setPeeked(row.instance!.id)}
                        >
                          <IconMaximize />
                        </Button>
                      {/if}
                      {#if row.stored || (row.instance && isResumable(row.instance))}
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Resume {row.title}"
                          onclick={() => resume(row)}
                        >
                          <IconPlay />
                        </Button>
                      {/if}
                    </div>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>

        <div class="foot">
          Showing {paged.length} of {filtered.length}
          <div class="pager">
            <Pagination.Root count={filtered.length} perPage={PAGE_SIZE} bind:page={pageNo} class="w-fit">
              {#snippet children({ pages, currentPage })}
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.PrevButton />
                  </Pagination.Item>
                  {#each pages as p (p.key)}
                    {#if p.type === 'ellipsis'}
                      <Pagination.Item>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    {:else}
                      <Pagination.Item>
                        <Pagination.Link page={p} isActive={currentPage === p.value}>
                          {p.value}
                        </Pagination.Link>
                      </Pagination.Item>
                    {/if}
                  {/each}
                  <Pagination.Item>
                    <Pagination.NextButton />
                  </Pagination.Item>
                </Pagination.Content>
              {/snippet}
            </Pagination.Root>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<SpawnPanel open={spawnOpen} prefill={spawnPrefill} onclose={() => (spawnOpen = false)} />

<style>
  .board {
    flex: 1 1 auto;
    min-width: 0;
    overflow: auto;
    background: var(--surface-field);
  }
  .inner {
    padding: 0 var(--space-6) var(--space-7) var(--space-7);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-6) 0 var(--space-5);
  }
  .head > div:first-child {
    margin-right: auto;
    min-width: 0;
  }
  h1 {
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    line-height: var(--leading-ui);
    color: var(--ink-strong);
  }
  .head p {
    font-size: var(--text-md);
    color: var(--ink-muted);
    margin-top: var(--space-1);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }

  /* The Needs-you tile is a real button wrapping the same card, so it keeps
     the grid cell's geometry and picks up keyboard focus for free. */
  .attn-tile {
    display: block;
    height: 100%;
    text-align: left;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: var(--radius-panel);
    transition: transform 100ms var(--ease-out-expo);
  }
  .attn-tile:active {
    transform: scale(0.99);
  }
  .attn-tile:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .attn-tile:hover .well,
  .attn-tile[aria-pressed='true'] .well {
    border-color: var(--status-attn-ink);
  }
  .attn-tile[aria-pressed='true'] .well {
    background: var(--status-attn-bg);
  }
  .attn-tile[aria-pressed='true'] .v {
    color: var(--status-attn-ink);
  }
  /* An unread count is muted: it is an absence of knowledge, not a number. */
  .v.unknown {
    color: var(--ink-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .attn-tile,
    .attn-tile:active {
      transition: none;
      transform: none;
    }
  }

  /* the recessed well inside each raised stat card */
  .well {
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-well);
    padding: var(--c-card-pad);
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    justify-content: center;
    flex: 1 1 auto;
    min-height: 0;
  }
  .k {
    color: var(--ink-label);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .v {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-numeric);
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .u {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .panel {
    background: var(--surface-raised);
    border-radius: var(--radius-panel);
    margin-top: var(--space-6);
    padding: var(--space-3);
    box-shadow: var(--shadow-lifted);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
  }
  .search {
    position: relative;
    width: 237px;
  }
  .search .lead {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    color: var(--ink-muted);
    pointer-events: none;
  }
  .search .lead :global(svg) {
    width: 16px;
    height: 16px;
  }
  .search :global(.search-input) {
    padding-left: calc(var(--space-3) + 16px + var(--space-2));
  }

  /* ui/table, dressed as the ledger grid */
  .tbl :global([data-slot='table-head']) {
    height: var(--space-8);
    padding: 0 var(--space-3);
    background: var(--surface-sunken);
    text-align: left;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--track-caps);
    text-transform: uppercase;
    color: var(--ink-label);
    vertical-align: middle;
  }
  .tbl :global([data-slot='table-head']:first-child) {
    border-radius: var(--radius-tile) 0 0 var(--radius-tile);
  }
  .tbl :global([data-slot='table-head']:last-child) {
    border-radius: 0 var(--radius-tile) var(--radius-tile) 0;
  }
  .tbl :global([data-slot='table-head'].s-name) {
    width: 290px;
  }
  .tbl :global([data-slot='table-head'].s-act) {
    width: 140px;
  }
  .tbl :global([data-slot='table-header'] tr),
  .tbl :global([data-slot='table-row']) {
    border-bottom: 0;
  }
  .tbl :global(tbody [data-slot='table-cell']) {
    height: 44px;
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--border-divider);
    font-size: var(--text-base);
    color: var(--ink-row);
    vertical-align: middle;
  }
  .tbl :global(tbody tr:last-child [data-slot='table-cell']) {
    border-bottom: 0;
  }
  .tbl :global(.num) {
    font-variant-numeric: tabular-nums;
  }
  .tbl :global(.mut) {
    color: var(--ink-muted);
  }
  .tbl :global(.warn) {
    color: var(--data-warn);
  }
  .tbl :global(.bad) {
    color: var(--data-bad);
  }

  .mark {
    width: var(--c-mark);
    height: var(--c-mark);
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
  }
  .mark :global(svg) {
    width: var(--c-mark-glyph);
    height: var(--c-mark-glyph);
    display: block;
    color: var(--mark-glyph);
  }

  .nm {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .nm a {
    font-weight: var(--weight-strong);
    color: var(--ink-row);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nm a:hover {
    text-decoration: underline;
  }
  .when {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .when :global(svg) {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }
  .act {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 55px;
    padding: 0 var(--space-3);
    border-top: 1px solid var(--border-hairline);
    font-size: var(--text-base);
    color: var(--ink-muted);
  }
  .pager {
    margin-left: auto;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-5);
    text-align: center;
  }
  .empty b {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .empty p {
    font-size: var(--text-base);
    color: var(--ink-muted);
  }

  @media (max-width: 900px) {
    .inner {
      padding: 0 var(--space-4) var(--space-8);
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }
    .v {
      font-size: var(--text-2xl);
    }
    .bar {
      flex-wrap: wrap;
    }
    .search {
      width: 100%;
    }
  }
</style>

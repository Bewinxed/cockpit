<script lang="ts">
  /**
   * The fleet board — every session across every machine as one ledger table,
   * with the four counts that say whether the fleet needs you above it.
   * Ported from mocks/v2-fleet.html (`<main>`): stat row, filter bar, the
   * eight-column table, pagination.
   *
   * Live and stored sessions are the same kind of row here. A stored session
   * whose transcript is already running somewhere is dropped — the live row is
   * the same conversation, and it is the one that can still be spoken to.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { SDKSessionInfo } from '@cockpit/core';
  import {
    Button,
    FilterSelect,
    ItemMark,
    Pagination,
    StatCard,
    StatusPill,
    TextField,
  } from '$lib/outpost';
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
  import { markHue, harnessGlyphPath, type MarkHue } from './mark';
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
    glyph: string;
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
        glyph: harnessGlyphPath(harness),
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
            glyph: harnessGlyphPath(info.harness),
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
  /** '' is "All machines"; otherwise a machineId. Cycled by the select. */
  let machineFilter = $state('');
  const STATES: { value: PillStatus | ''; label: string }[] = [
    { value: '', label: 'All states' },
    { value: 'live', label: 'Working' },
    { value: 'attn', label: 'Needs you' },
    { value: 'idle', label: 'Idle' },
  ];
  let stateFilter = $state(0);
  let pageNo = $state(1);

  const machineName = $derived(
    machineFilter
      ? (rows.find((row) => row.machineId === machineFilter)?.machine ?? machineFilter)
      : 'All machines'
  );

  function cycleMachine() {
    const ids = cockpit.machines.map((machine) => machine.machineId);
    const next = ids.indexOf(machineFilter) + 1;
    machineFilter =
      next > 0 && next < ids.length ? ids[next] : machineFilter ? '' : (ids[0] ?? '');
    pageNo = 1;
  }

  function cycleState() {
    stateFilter = (stateFilter + 1) % STATES.length;
    pageNo = 1;
  }

  const filtered = $derived(
    rows.filter((row) => {
      const needle = search.trim().toLowerCase();
      if (needle && !row.title.toLowerCase().includes(needle)) return false;
      if (machineFilter && row.machineId !== machineFilter) return false;
      const want = STATES[stateFilter].value;
      if (want && row.status !== want) return false;
      return true;
    })
  );

  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const paged = $derived(filtered.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE));

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
</script>

<div class="board">
  <div class="inner">
    <div class="head">
      <div>
        <h1>Fleet</h1>
        <p>Every agent across your machines, and what needs you.</p>
      </div>
      <Button variant="primary" onclick={startSession}>
        <IconPlus />
        Start session
      </Button>
    </div>

    <div class="stats">
      <StatCard label="Sessions" value={cockpit.runningInstances.length} />
      <StatCard label="Needs you" value={cockpit.blocked.length} />
      <StatCard
        label="Machines"
        value={cockpit.onlineMachines.length}
        unit="of {cockpit.machines.length}"
      />
      <StatCard label="Spend today" value="${spend.toFixed(2)}" />
    </div>

    <div class="panel">
      {#if cockpit.hub === 'unreachable'}
        <div class="empty">
          <b>Can't reach the hub</b>
          <p>Nothing on the fleet can be read until the connection is back.</p>
          <Button onclick={() => reconnectNow()}>Retry</Button>
        </div>
      {:else if cockpit.machines.length === 0}
        <div class="empty">
          <b>No machines yet</b>
          <p>Run <code>cockpit</code> on a machine and it joins this board by itself.</p>
        </div>
      {:else if rows.length === 0}
        <div class="empty">
          <b>{cockpit.onlineMachines.length} machines online, no sessions running.</b>
          <Button variant="primary" onclick={startSession}>
            <IconPlus />
            Start session
          </Button>
        </div>
      {:else}
        <div class="bar">
          <TextField
            class="search"
            bind:value={search}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            oninput={() => (pageNo = 1)}
          >
            {#snippet lead()}<IconSearch />{/snippet}
          </TextField>
          <FilterSelect label={machineName} onclick={cycleMachine} />
          <FilterSelect label={STATES[stateFilter].label} onclick={cycleState} />
          <FilterSelect label="Last active" />
          <Button class="exp" onclick={exportCsv}>
            <IconDownload />
            Export CSV
          </Button>
        </div>

        <div class="tscroll">
          <table>
            <thead>
              <tr>
                <th class="s-name">Session</th>
                <th>Machine</th>
                <th>Harness</th>
                <th class="num">Turns</th>
                <th class="num">Context</th>
                <th>Last activity</th>
                <th>State</th>
                <th class="s-act">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each paged as row (row.key)}
                <tr>
                  <td>
                    <div class="nm">
                      <ItemMark hue={row.hue}>
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d={row.glyph}
                            stroke="currentColor"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </ItemMark>
                      <a href={row.href}>{row.title}</a>
                    </div>
                  </td>
                  <td class="mut">{row.machine}</td>
                  <td class="mut">{row.harnessLabel}</td>
                  <td class="num">{row.turns ?? '—'}</td>
                  <td class="num {contextClass(row.contextPct)}">
                    {row.contextPct === null ? '—' : `${Math.round(row.contextPct)}%`}
                  </td>
                  <td>
                    <span class="when">
                      <IconHistory />
                      {row.at ? formatDistanceToNow(new Date(row.at)) : '—'}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={row.status}>{row.stateLabel}</StatusPill>
                  </td>
                  <td>
                    <div class="act">
                      <Button size="icon-sm" href={row.href} aria-label="Open {row.title}">
                        <IconExternal />
                      </Button>
                      {#if row.instance}
                        <Button
                          size="icon-sm"
                          aria-label="Peek {row.title}"
                          onclick={() => setPeeked(row.instance!.id)}
                        >
                          <IconMaximize />
                        </Button>
                      {/if}
                      {#if row.stored || (row.instance && isResumable(row.instance))}
                        <Button
                          size="icon-sm"
                          aria-label="Resume {row.title}"
                          onclick={() => resume(row)}
                        >
                          <IconPlay />
                        </Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="foot">
          Showing {paged.length} of {filtered.length}
          <Pagination bind:page={pageNo} total={pageCount} />
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
    margin-top: 3px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .stats :global(> *) {
    display: block;
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
  .bar :global(.search) {
    width: 237px;
  }
  .bar :global(.exp) {
    margin-left: auto;
  }

  .tscroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 860px;
    border-collapse: collapse;
  }
  thead th {
    background: var(--surface-sunken);
    height: 32px;
    padding: 0 12px;
    text-align: left;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--track-caps);
    text-transform: uppercase;
    color: var(--ink-label);
  }
  thead th:first-child {
    border-radius: 6px 0 0 6px;
  }
  thead th:last-child {
    border-radius: 0 6px 6px 0;
  }
  th.s-name {
    width: 290px;
  }
  th.s-act {
    width: 140px;
  }
  tbody td {
    height: 44px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border-divider);
    font-size: var(--text-base);
    color: var(--ink-row);
    vertical-align: middle;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .mut {
    color: var(--ink-muted);
  }
  .warn {
    color: var(--data-warn);
  }
  .bad {
    color: var(--data-bad);
  }
  .nm {
    display: flex;
    align-items: center;
    gap: 10px;
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
    gap: 6px;
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
    gap: 6px;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 55px;
    padding: 0 12px;
    border-top: 1px solid var(--border-hairline);
    font-size: var(--text-base);
    color: var(--ink-muted);
  }
  .foot :global(.pager) {
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
    .bar {
      flex-wrap: wrap;
    }
    .bar :global(.search) {
      width: 100%;
    }
    .bar :global(.exp) {
      margin-left: 0;
    }
  }
</style>

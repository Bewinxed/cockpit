<script lang="ts">
  import type { SDKSessionInfo } from "@whiffle/core";
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
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Card from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Pagination from "$lib/components/ui/pagination";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Select from "$lib/components/ui/select";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Table from "$lib/components/ui/table";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    IconDownload,
    IconExternal,
    IconHistory,
    IconMaximize,
    IconPlay,
    IconPlus,
    IconSearch,
  } from "$lib/icons";
  import { cn } from "$lib/utils";
  import { formatDistanceToNow } from "$lib/utils/time";
  import AttentionQueue from "$lib/whiffle/AttentionQueue.svelte";
  import LiveSessionRow from "$lib/whiffle/LiveSessionRow.svelte";
  import MachineCard from "$lib/whiffle/MachineCard.svelte";
  import SpawnPanel from "$lib/whiffle/SpawnPanel.svelte";
  import StatTile from "$lib/whiffle/StatTile.svelte";
  import {
    type InstanceRow,
    isFailed,
    isResumable,
    isStale,
    reconnectNow,
    resumeSession,
    setPeeked,
    whiffle,
  } from "./client.svelte";
  import HarnessGlyph from "./HarnessGlyph.svelte";
  import { sessionTitle, transcriptHref } from "./links";
  import { machineLabel } from "./machine";
  import { type MarkHue, markHue } from "./mark";

  let { active }: { active: boolean } = $props();

  const PAGE_SIZE = 12;

  type PillStatus = "live" | "attn" | "fail" | "idle";

  interface Row {
    at: number | undefined;
    contextPct: number | null;
    cost: number | null;
    cwd: string;
    harness: string;
    harnessLabel: string;
    href: string;
    // the mark draws the vendor glyph from `harness`; the hue tells sessions apart
    hue: MarkHue;
    instance: InstanceRow | null;
    key: string;
    machine: string;
    machineId: string;
    stateLabel: string;
    status: PillStatus;
    stored: SDKSessionInfo | null;
    title: string;
    turns: number | null;
  }

  function harnessLabelOf(harness: string): string {
    switch (harness) {
      case "claude":
        return "Claude Code";
      case "opencode":
        return "OpenCode";
      case "pi":
        return "pi";
      default:
        return harness;
    }
  }

  function liveState(instance: InstanceRow): {
    status: PillStatus;
    label: string;
  } {
    if (isFailed(instance)) {
      return { status: "fail", label: "Failed" };
    }
    switch (whiffle.activityOf(instance.id)) {
      case "blocked":
        return { status: "attn", label: "Needs you" };
      case "working":
        return { status: "live", label: "Working" };
      default:
        return { status: "idle", label: "Idle" };
    }
  }

  const rows = $derived.by<Row[]>(() => {
    const live = whiffle.runningInstances.map((instance): Row => {
      const stats = whiffle.statsOf(instance.id);
      const state = liveState(instance);
      const machine = whiffle.machines.find(
        (m) => m.machineId === instance.machineId
      );
      const harness = instance.harness ?? "claude";
      return {
        key: instance.id,
        title: instance.title ?? "untitled session",
        machineId: instance.machineId,
        machine: machine ? machineLabel(machine.hostname) : instance.machineId,
        harness,
        harnessLabel: harnessLabelOf(harness),
        hue: markHue(instance.cwd || instance.machineId),
        status: state.status,
        stateLabel: state.label,
        turns: stats.turns,
        contextPct: stats.contextPct,
        cost: stats.cost,
        at: whiffle.pulseAt(instance.id),
        href: `/session/${instance.id}`,
        instance,
        stored: null,
        cwd: instance.cwd,
      };
    });

    const running = new Set(
      live.map((row) => row.instance?.sessionId).filter(Boolean)
    );
    const stored = whiffle.machines.flatMap((machine) =>
      whiffle
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
            status: "idle",
            stateLabel: "Idle",
            turns: null,
            contextPct: null,
            cost: null,
            at: info.lastModified,
            href: transcriptHref(info),
            instance: null,
            stored: info,
            cwd: info.cwd ?? "",
          })
        )
    );

    return [...live, ...stored].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  });

  const spend = $derived(
    whiffle.runningInstances.reduce(
      (sum, row) => sum + (whiffle.statsOf(row.id).cost ?? 0),
      0
    )
  );

  /** Listed rows with no live process — asleep or unreachable. Shown apart from
   *  the roster above (staleInstances' own doc comment): "never as live work",
   *  so it stays out of the Sessions stat and out of the live/idle/attn filters. */
  const notRunning = $derived(
    whiffle.listedInstances.filter((row) => isResumable(row) || isStale(row))
  );

  /* ---- filters ------------------------------------------------------- */

  let search = $state("");
  let showAllNotRunning = $state(false);
  /** '' is "All machines"; otherwise a machineId. */
  let machineFilter = $state("");
  const STATES: { value: PillStatus | ""; label: string }[] = [
    { value: "", label: "All states" },
    { value: "live", label: "Working" },
    { value: "attn", label: "Needs you" },
    { value: "idle", label: "Idle" },
  ];
  let stateFilter = $state<PillStatus | "">("");
  const SORTS: { value: "recent" | "name"; label: string }[] = [
    { value: "recent", label: "Last active" },
    { value: "name", label: "Name (A–Z)" },
  ];
  let sortBy = $state<"recent" | "name">("recent");
  let pageNo = $state(1);

  const machineName = $derived(
    machineFilter
      ? (rows.find((row) => row.machineId === machineFilter)?.machine ??
          machineFilter)
      : "All machines"
  );
  const stateName = $derived(
    STATES.find((s) => s.value === stateFilter)?.label ?? "All states"
  );
  /** The blocked list only means "nothing needs you" while the socket is live. */
  const hubLive = $derived(whiffle.hub === "connected");
  const sortName = $derived(
    SORTS.find((s) => s.value === sortBy)?.label ?? "Last active"
  );

  const filtered = $derived(
    rows.filter((row) => {
      const needle = search.trim().toLowerCase();
      if (needle && !row.title.toLowerCase().includes(needle)) {
        return false;
      }
      if (machineFilter && row.machineId !== machineFilter) {
        return false;
      }
      if (stateFilter && row.status !== stateFilter) {
        return false;
      }
      return true;
    })
  );

  const sorted = $derived(
    sortBy === "name"
      ? [...filtered].sort((a, b) => a.title.localeCompare(b.title))
      : [...filtered].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  );

  const pageCount = $derived(Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)));
  const paged = $derived(
    sorted.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE)
  );

  // A filter that shrinks the list out from under the current page leaves it
  // showing nothing at all; the first page always has rows.
  $effect(() => {
    if (pageNo > pageCount) {
      pageNo = 1;
    }
  });

  /* ---- actions ------------------------------------------------------- */

  let spawnOpen = $state(false);
  let spawnPrefill = $state<{ machineId?: string; cwd?: string } | undefined>(
    undefined
  );

  // "Spawn here" from anywhere else in the app arrives as a query on the board's
  // own URL. It is consumed once and cleared, so a reload is not a second spawn.
  $effect(() => {
    if (!active) {
      return;
    }
    const machineId = page.url.searchParams.get("machine");
    if (!machineId) {
      return;
    }
    spawnPrefill = {
      machineId,
      cwd: page.url.searchParams.get("cwd") ?? undefined,
    };
    spawnOpen = true;
    // biome-ignore lint/complexity/noVoid: fire-and-forget — the panel is already open, the URL cleanup is a courtesy
    void goto("/session", { replaceState: true });
  });

  function startSession() {
    spawnPrefill = undefined;
    spawnOpen = true;
  }

  function resume(row: Row) {
    const sessionId = row.instance?.sessionId ?? row.stored?.sessionId;
    if (!sessionId) {
      return;
    }
    const id = resumeSession({
      machineId: row.machineId,
      cwd: row.cwd,
      sessionId,
      harness: row.harness as never,
    });
    // biome-ignore lint/complexity/noVoid: fire-and-forget — the session is already resuming, navigation doesn't need to be awaited
    void goto(`/session/${id}`);
  }

  function exportCsv() {
    const head = [
      "Session",
      "Machine",
      "Harness",
      "Turns",
      "Context",
      "Last activity",
      "State",
    ];
    const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const body = filtered.map((row) =>
      [
        row.title,
        row.machine,
        row.harnessLabel,
        row.turns === null ? "" : String(row.turns),
        row.contextPct === null ? "" : `${Math.round(row.contextPct)}%`,
        row.at ? new Date(row.at).toISOString() : "",
        row.stateLabel,
      ]
        .map(cell)
        .join(",")
    );
    const blob = new Blob([[head.map(cell).join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fleet-sessions.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ---- cells --------------------------------------------------------- */

  const contextClass = (pct: number | null): string => {
    if (pct === null) {
      return "";
    }
    if (pct >= 90) {
      return "bad";
    }
    return pct >= 70 ? "warn" : "";
  };

  // The machine-convergence list, dressed the same as every other fleet panel's
  // raised list (FleetAgents.svelte / FleetMemory.svelte's own `panelList`):
  // a raised card at zero padding, each row drawing its own top hairline.
  const machinesPanelClass =
    "gap-0 overflow-hidden rounded-[var(--radius-panel)] border-0 bg-[var(--surface-raised)] p-0 shadow-[var(--shadow-lifted)] ring-1 ring-[var(--border-hairline)] mt-[var(--space-6)]";

  // The status column, dressed on ui/badge: a light tint carries the meaning,
  // deepened ink carries the legibility. Idle carries no fill — absence is idle.
  const pillBase =
    "h-[var(--c-pill-h)] gap-[var(--c-pill-gap)] rounded-[var(--radius-pill)] border-transparent px-[10px] [font-size:var(--c-pill-fs)] [font-weight:var(--weight-strong)] whitespace-nowrap";
  const pillTint: Record<PillStatus, string> = {
    live: "bg-[var(--status-live-bg)] text-[var(--status-live-ink)]",
    attn: "bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]",
    fail: "bg-[var(--status-fail-bg)] text-[var(--status-fail-ink)]",
    idle: "bg-transparent px-0 text-[var(--ink-muted)] [font-weight:var(--weight-medium)]",
  };
</script>

<div class="board">
  <div class="inner">
    <div class="head">
      <p>Every agent across your machines, and what needs you.</p>
      <Button onclick={startSession}>
        <IconPlus />
        Start session
      </Button>
    </div>

    <div class="stats">
      <StatTile
        label="Sessions"
        value={String(whiffle.runningInstances.length)}
      />

      <!-- Needs you is not a readout. It names this surface's job, so it is the
           control that reaches it (DESIGN.md §Open questions): pressing it
           filters the board down to exactly the sessions it counts.

           And it never says "0" on a guess. whiffle.blocked is only true when
           the socket is live; while the hub is connecting or unreachable an
           empty list means "not read yet", and printing 0 there is a false
           all-clear — the one failure the Switch interview names by hand. -->
      <button
        aria-label={hubLive
          ? `Needs you: ${whiffle.blocked.length}. Show only sessions that need you.`
          : 'Needs you: unknown while reconnecting. Show only sessions that need you.'}
        aria-pressed={stateFilter === 'attn'}
        class="attn-tile"
        onclick={() => {
          stateFilter = stateFilter === 'attn' ? '' : 'attn';
          pageNo = 1;
        }}
        type="button"
      >
        <StatTile
          label="Needs you"
          tone="attn"
          unit={hubLive ? undefined : 'unknown while reconnecting'}
          value={hubLive ? String(whiffle.blocked.length) : '—'}
        />
      </button>

      <StatTile
        label="Machines"
        unit="of {whiffle.machines.length}"
        value={String(whiffle.onlineMachines.length)}
      />
      <StatTile label="Spend today" value={`$${spend.toFixed(2)}`} />
    </div>

    <!-- Every machine's convergence with the rest of the fleet (leaf C2 —
         .unlazy-liveness/gates/c2.md): the data was always in this frame,
         the Mac's 21-day silence is what happens when nothing renders it.
         Shown above the queue for the same reason the queue sits above the
         roster — this is a fact about the fleet, not about one session. -->
    {#if whiffle.machines.length > 0}
      <!-- MachineCard's badges carry tooltips (Tooltip.Root needs an ancestor
           Provider or it throws on mount — see tools/+page.svelte's own note);
           the board otherwise never needed one, so it is scoped to here. -->
      <Tooltip.Provider>
        <Card.Root class={machinesPanelClass}>
          <ul class="machine-list">
            {#each whiffle.machines as machine (machine.machineId)}
              <MachineCard hubBuild={whiffle.hubBuild} {machine} />
            {/each}
          </ul>
        </Card.Root>
      </Tooltip.Provider>
    {/if}

    <!-- JOURNEY §1 block 3. Everything parked on a human sits above the roster,
         longest wait first, with the answer one tap away — the roster below is
         for choosing a session, this is for unblocking one. It renders itself
         away when nothing is waiting. -->
    <div class="queue">
      <AttentionQueue />
    </div>

    <!-- Asleep and unreachable rows never reach the roster below (it is
         `runningInstances` only, by design — see the Sessions stat), so a
         sleeping or unknown session would otherwise be absent from the whole
         board. Shown apart, never folded into live work or its counts. -->
    {#if notRunning.length > 0}
      {@const CAP = 20}
      {@const capped = showAllNotRunning ? notRunning : notRunning.slice(0, CAP)}
      <div class="not-running">
        <div class="sec">Not running ({notRunning.length})</div>
        <div class="not-running-rows">
          {#each capped as row (row.id)}
            <LiveSessionRow instance={row} />
          {/each}
        </div>
        {#if !showAllNotRunning && notRunning.length > CAP}
          <button
            class="show-all"
            onclick={() => {
              showAllNotRunning = true;
            }}
            type="button"
          >
            Show all {notRunning.length} sessions
          </button>
        {/if}
      </div>
    {/if}

    <div class="panel">
      {#if whiffle.hub === 'unreachable'}
        <div class="empty">
          <b>Can't reach the hub</b>
          <p>Nothing on the fleet can be read until the connection is back.</p>
          <Button onclick={() => reconnectNow()} variant="outline"
            >Retry</Button
          >
        </div>
      {:else if whiffle.machines.length === 0}
        <div class="empty">
          <b>No machines yet</b>
          <p>
            Run <code>whiffle</code> on a machine and it joins this board by
            itself.
          </p>
        </div>
      {:else if rows.length === 0}
        <div class="empty">
          <b
            >{whiffle.onlineMachines.length}
            machines online, no sessions running.</b
          >
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
              aria-label="Search sessions"
              class="search-input"
              oninput={() => {
                pageNo = 1;
              }}
              placeholder="Search sessions…"
              bind:value={search}
            />
          </div>

          <Select.Root
            onValueChange={(v) => {
              machineFilter = v === 'all' ? '' : v;
              pageNo = 1;
            }}
            type="single"
            value={machineFilter || 'all'}
          >
            <Select.Trigger class="min-w-[168px]">{machineName}</Select.Trigger>
            <Select.Content>
              <Select.Item label="All machines" value="all"
                >All machines</Select.Item
              >
              {#each whiffle.machines as m (m.machineId)}
                <Select.Item
                  label={machineLabel(m.hostname)}
                  value={m.machineId}
                >
                  {machineLabel(m.hostname)}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>

          <Select.Root
            onValueChange={(v) => {
              stateFilter = (v === 'all' ? '' : v) as PillStatus | '';
              pageNo = 1;
            }}
            type="single"
            value={stateFilter || 'all'}
          >
            <Select.Trigger class="min-w-[140px]">{stateName}</Select.Trigger>
            <Select.Content>
              {#each STATES as s (s.label)}
                <Select.Item label={s.label} value={s.value || 'all'}
                  >{s.label}</Select.Item
                >
              {/each}
            </Select.Content>
          </Select.Root>

          <Select.Root
            onValueChange={(v) => {
              sortBy = v as 'recent' | 'name';
            }}
            type="single"
            value={sortBy}
          >
            <Select.Trigger class="min-w-[150px]">{sortName}</Select.Trigger>
            <Select.Content>
              {#each SORTS as s (s.value)}
                <Select.Item label={s.label} value={s.value}
                  >{s.label}</Select.Item
                >
              {/each}
            </Select.Content>
          </Select.Root>

          <Button
            class="ml-auto max-[900px]:ml-0"
            onclick={exportCsv}
            variant="outline"
          >
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
                <Table.Row>
                  <Table.Cell>
                    <div class="nm">
                      <span aria-hidden="true" class="mark m{row.hue}">
                        <HarnessGlyph harness={row.harness} />
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
                    <Badge class={cn(pillBase, pillTint[row.status])}
                      >{row.stateLabel}</Badge
                    >
                  </Table.Cell>
                  <Table.Cell>
                    <div class="act">
                      <Button
                        aria-label="Open {row.title}"
                        href={row.href}
                        size="icon-sm"
                        variant="outline"
                      >
                        <IconExternal />
                      </Button>
                      {#if row.instance}
                        {@const instance = row.instance}
                        <Button
                          aria-label="Peek {row.title}"
                          onclick={() => setPeeked(instance.id)}
                          size="icon-sm"
                          variant="outline"
                        >
                          <IconMaximize />
                        </Button>
                      {/if}
                      {#if row.stored || (row.instance && isResumable(row.instance))}
                        <Button
                          aria-label="Resume {row.title}"
                          onclick={() => resume(row)}
                          size="icon-sm"
                          variant="outline"
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
            <Pagination.Root
              class="w-fit"
              count={filtered.length}
              perPage={PAGE_SIZE}
              bind:page={pageNo}
            >
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
                        <Pagination.Link
                          isActive={currentPage === p.value}
                          page={p}
                        >
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

<SpawnPanel
  onclose={() => {
    spawnOpen = false;
  }}
  open={spawnOpen}
  prefill={spawnPrefill}
/>

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
  .head p {
    margin-right: auto;
    min-width: 0;
    font-size: var(--text-md);
    color: var(--ink-muted);
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
    transition: transform 100ms var(--e-in);
  }
  .attn-tile:active {
    transform: scale(0.99);
  }
  .attn-tile:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .attn-tile:hover :global(.st-well),
  .attn-tile[aria-pressed="true"] :global(.st-well) {
    border-color: var(--status-attn-ink);
  }
  .attn-tile[aria-pressed="true"] :global(.st-well) {
    background: var(--status-attn-bg);
  }
  .attn-tile[aria-pressed="true"] :global(.st-value) {
    color: var(--status-attn-ink);
  }
  @media (prefers-reduced-motion: reduce) {
    .attn-tile,
    .attn-tile:active {
      transition: none;
      transform: none;
    }
  }

  /* The wrapper is layout-transparent, so an empty queue leaves no gap behind:
     the spacing belongs to the card, which only exists when something waits. */
  .queue {
    display: contents;
  }
  .queue > :global(*) {
    margin-top: var(--space-6);
  }

  .panel {
    background: var(--surface-raised);
    border-radius: var(--radius-panel);
    margin-top: var(--space-6);
    padding: var(--space-3);
    box-shadow: var(--shadow-lifted);
  }

  .machine-list {
    display: flex;
    flex-direction: column;
  }

  /* Asleep/unreachable rows, kept in their own well rather than the roster's
     table — that roster is `runningInstances` by design (the Sessions stat
     above it counts the same set), so this is a second, clearly separate
     surface rather than a state this board's live table can also carry. */
  .not-running {
    background: var(--surface-raised);
    border-radius: var(--radius-panel);
    margin-top: var(--space-6);
    padding: var(--space-3);
    box-shadow: var(--shadow-lifted);
  }
  .not-running .sec {
    font-size: var(--text-xs);
    color: var(--ink-muted);
    font-weight: var(--weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
    /* 1rem, not --space-4 (14px): LiveSessionRow's own inset is Tailwind's
       plain px-4 (16px), so the heading matches that, not the --space scale. */
    padding: 0 1rem;
    margin: var(--space-1) 0 var(--space-2);
  }
  .not-running-rows {
    display: flex;
    flex-direction: column;
  }
  .show-all {
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    background: none;
    border: 1px dashed var(--border-hairline);
    border-radius: var(--radius-control);
    cursor: pointer;
    margin-top: var(--space-2);
  }
  .show-all:hover {
    color: var(--ink-strong);
    border-color: var(--border-control);
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
  .tbl :global([data-slot="table-head"]) {
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
  .tbl :global([data-slot="table-head"]:first-child) {
    border-radius: var(--radius-tile) 0 0 var(--radius-tile);
  }
  .tbl :global([data-slot="table-head"]:last-child) {
    border-radius: 0 var(--radius-tile) var(--radius-tile) 0;
  }
  .tbl :global([data-slot="table-head"].s-name) {
    width: 290px;
  }
  .tbl :global([data-slot="table-head"].s-act) {
    width: 140px;
  }
  .tbl :global([data-slot="table-header"] tr),
  .tbl :global([data-slot="table-row"]) {
    border-bottom: 0;
  }
  .tbl :global(tbody [data-slot="table-cell"]) {
    height: 44px;
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--border-divider);
    font-size: var(--text-base);
    color: var(--ink-row);
    vertical-align: middle;
  }
  .tbl :global(tbody tr:last-child [data-slot="table-cell"]) {
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
    background-color: var(--mark-1);
  }
  /* biome-ignore lint/style/noDescendingSpecificity: never matches the same element as .search .lead :global(svg) — different subtree */
  .mark :global(svg) {
    width: var(--c-mark-glyph);
    height: var(--c-mark-glyph);
    display: block;
    color: var(--mark-glyph);
  }
  .mark.m2 {
    background-color: var(--mark-2);
  }
  .mark.m3 {
    background-color: var(--mark-3);
  }
  .mark.m4 {
    background-color: var(--mark-4);
  }
  .mark.m5 {
    background-color: var(--mark-5);
  }
  .mark.m6 {
    background-color: var(--mark-6);
  }
  .mark.m7 {
    background-color: var(--mark-7);
  }
  .mark.m8 {
    background-color: var(--mark-8);
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
  /* biome-ignore lint/style/noDescendingSpecificity: never matches the same element as .search .lead :global(svg) — different subtree */
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
    .bar {
      flex-wrap: wrap;
    }
    .search {
      width: 100%;
    }
  }
</style>

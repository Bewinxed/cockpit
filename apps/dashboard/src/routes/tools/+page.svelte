<script lang="ts">
  import type { FleetAgent, FleetConfig, FleetSkillMeta } from "@whiffle/core";
  /**
   * What the fleet's machines carry: MCP servers, skills, subagents, memory,
   * and hooks — one panel visible at a time behind a labelled tab selector,
   * held in the URL (?tab=), with a fleet status line and "needs attention"
   * strip above the tabs so fleet-wide failures are visible without hunting
   * through panels. (JOURNEY.md §4)
   */
  import { onMount, untrack } from "svelte";
  import { page } from "$app/state";
  import * as Card from "$lib/components/ui/card";
  import * as Tabs from "$lib/components/ui/tabs";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    IconBoltDuo,
    IconBookDuo,
    IconHookDuo,
    IconSubagentDuo,
    IconToolGeneric,
    IconToolMcp,
  } from "$lib/icons";
  import { whiffle } from "$lib/whiffle/client.svelte";
  import FleetAgents from "$lib/whiffle/FleetAgents.svelte";
  import FleetHooks from "$lib/whiffle/FleetHooks.svelte";
  import FleetMcp from "$lib/whiffle/FleetMcp.svelte";
  import FleetMemory from "$lib/whiffle/FleetMemory.svelte";
  import FleetSkills from "$lib/whiffle/FleetSkills.svelte";
  import FleetTrouble from "$lib/whiffle/FleetTrouble.svelte";
  import type { FleetMemoryDocRow, FleetMemoryRow } from "$lib/whiffle/fleet";
  import type { FleetHook } from "$lib/whiffle/hooks";
  import { orderMachines } from "$lib/whiffle/rail.svelte";
  import ToolMatrix from "$lib/whiffle/ToolMatrix.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const machines = $derived(orderMachines(whiffle.machines));
  const online = $derived(
    machines.filter((one) => one.status === "online").length
  );

  /**
   * The hub's desired state, re-seeded when `data` changes (e.g. on navigation)
   * while still letting local mutations win between loads.
   */
  let config = $state<FleetConfig>(untrack(() => data.config));
  let skills = $state<FleetSkillMeta[]>(untrack(() => data.skills));
  let agents = $state<FleetAgent[]>(untrack(() => data.agents));
  let memory = $state<FleetMemoryRow | null>(untrack(() => data.memory));
  let memoryDocs = $state<FleetMemoryDocRow[]>(untrack(() => data.memoryDocs));
  let hooks = $state<FleetHook[]>(untrack(() => data.hooks));

  /** Re-seed from the load when `data` changes on navigation. The identity of
   *  `data.config` is new on every load, so it doubles as a change token.
   *  The latch is $state.raw: a plain $state latch would store a proxy of
   *  `data.config`, the !== check would never settle, and the effect would
   *  loop forever (state_proxy_equality_mismatch — see NEW.md drift log). */
  let seeded = $state.raw(untrack(() => data.config));
  $effect(() => {
    if (data.config !== seeded) {
      seeded = data.config;
      config = data.config;
      skills = data.skills;
      agents = data.agents;
      memory = data.memory;
      memoryDocs = data.memoryDocs;
      hooks = data.hooks;
    }
  });

  let settling = $state(true);
  onMount(() => {
    const timer = setTimeout(() => (settling = false), 600);
    return () => clearTimeout(timer);
  });

  const TAB_ORDER = ["tools", "mcp", "skills", "agents", "memory", "hooks"];
  const activeTab = $derived(page.url.searchParams.get("tab") ?? "tools");
  let tabDir = $state<"left" | "right">("right");

  function switchTab(value: string) {
    const fromIdx = TAB_ORDER.indexOf(activeTab);
    const toIdx = TAB_ORDER.indexOf(value);
    tabDir = toIdx > fromIdx ? "right" : "left";

    const url = new URL(location.href);
    url.searchParams.set("tab", value);
    history.replaceState(history.state, "", url);
  }

  /* Dress shadcn Card as the Quiet Ledger raised panel (--surface-raised,
     --radius-panel, --shadow-lifted) — never the stock bg-card/ring
     shadcn ships. tailwind-merge drops the defaults these override. */
  const panelClass =
    "gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-lifted)] ring-0";
</script>

<svelte:head>
  <title>Tools &middot; Whiffle</title>
</svelte:head>

<!-- The fleet panels all reach for a tooltip; without an ancestor provider they
     throw on the server, which is what used to leave /tools a 500 on a cold load. -->
<Tooltip.Provider>
  <div class="page">
    <div class="col">
      <p class="sub">{online} of {machines.length} machines reported</p>

      <Card.Root class="scroll-mt-6 {panelClass}" id="fleet-trouble">
        <header class="phead">
          <h2>Needs attention</h2>
          <span class="psub"
            >Everything the fleet could not fetch or could not apply</span
          >
        </header>
        <div class="pbody">
          <FleetTrouble
            {machines}
            plugins={config.plugins}
            {settling}
            {skills}
          />
        </div>
      </Card.Root>

      <Tabs.Root
        data-tab-dir={tabDir}
        onValueChange={switchTab}
        value={activeTab}
      >
        <Tabs.List class="tab-strip" variant="line">
          <Tabs.Trigger value="tools">
            <IconToolGeneric class="tab-icon" />
            <span class="tab-label">Tools</span>
            <span class="badge">{data.catalog.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="mcp">
            <IconToolMcp class="tab-icon" /><span class="tab-label">MCP</span>
            <span class="badge">{config.mcp.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="skills">
            <IconBoltDuo class="tab-icon" />
            <span class="tab-label">Skills</span>
            <span class="badge">{skills.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="agents">
            <IconSubagentDuo class="tab-icon" />
            <span class="tab-label">Agents</span>
            <span class="badge">{agents.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="memory">
            <IconBookDuo class="tab-icon" />
            <span class="tab-label">Memory</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="hooks">
            <IconHookDuo class="tab-icon" /><span class="tab-label">Hooks</span>
            <span class="badge">{hooks.length}</span>
          </Tabs.Trigger>
        </Tabs.List>

        <!-- Only render the active panel. The old code rendered all 6 panels
           (242KB of hidden HTML including 106KB for Skills alone), blocking the
           main thread for 243ms on mount. {#if} defers rendering until the
           tab is selected. -->
        {#if activeTab === 'tools'}
          <Tabs.Content value="tools">
            <Card.Root class={panelClass}>
              <header class="phead">
                <h2>Tool matrix</h2>
                <span class="psub">Workflow CLIs, machine by machine</span>
              </header>
              <div class="pbody">
                <ToolMatrix
                  catalog={data.catalog}
                  error={data.toolsError}
                  {machines}
                  policies={data.policies}
                  {settling}
                />
              </div>
            </Card.Root>
          </Tabs.Content>
        {/if}

        {#if activeTab === 'mcp'}
          <Tabs.Content value="mcp">
            <Card.Root class="scroll-mt-6 {panelClass}" id="fleet-mcp">
              <header class="phead">
                <h2>MCP servers</h2>
                <span class="psub"
                  >Written to every machine, online now or when it returns</span
                >
              </header>
              <div class="pbody">
                <FleetMcp
                  error={data.fleetError}
                  {machines}
                  servers={config.mcp}
                  {settling}
                />
              </div>
            </Card.Root>
          </Tabs.Content>
        {/if}

        {#if activeTab === 'skills'}
          <Tabs.Content value="skills">
            <Card.Root class="scroll-mt-6 {panelClass}" id="fleet-skills">
              <header class="phead">
                <h2>Skills &amp; plugins</h2>
                <span class="psub"
                  >Fetched once for the fleet, or cloned from a
                  marketplace</span
                >
              </header>
              <div class="pbody">
                <FleetSkills
                  {config}
                  error={data.fleetError}
                  {machines}
                  {settling}
                  {skills}
                />
              </div>
            </Card.Root>
          </Tabs.Content>
        {/if}

        {#if activeTab === 'agents'}
          <Tabs.Content value="agents">
            <Card.Root class={panelClass}>
              <header class="phead">
                <h2>Subagents</h2>
                <span class="psub"
                  >Markdown files that land in ~/.claude/agents everywhere</span
                >
              </header>
              <div class="pbody">
                <FleetAgents
                  {agents}
                  error={data.fleetError}
                  {machines}
                  {settling}
                />
              </div>
            </Card.Root>
          </Tabs.Content>
        {/if}

        {#if activeTab === 'memory'}
          <Tabs.Content value="memory">
            <Card.Root class="scroll-mt-6 {panelClass}" id="fleet-memory">
              <header class="phead">
                <h2>Memory</h2>
                <span class="psub"
                  >The user CLAUDE.md the whole fleet reads</span
                >
              </header>
              <div class="pbody">
                <FleetMemory
                  error={data.fleetError}
                  {machines}
                  {settling}
                  bind:docs={memoryDocs}
                  bind:memory
                />
              </div>
            </Card.Root>
          </Tabs.Content>
        {/if}

        {#if activeTab === 'hooks'}
          <Tabs.Content value="hooks">
            <Card.Root class="scroll-mt-6 {panelClass}" id="fleet-hooks">
              <header class="phead">
                <h2>Hooks</h2>
                <span class="psub"
                  >Scripts and calls run on a session's own lifecycle
                  events</span
                >
              </header>
              <div class="pbody">
                <FleetHooks
                  error={data.hooksError}
                  {hooks}
                  {machines}
                  {settling}
                />
              </div>
            </Card.Root>
          </Tabs.Content>
        {/if}
      </Tabs.Root>
    </div>
  </div>
</Tooltip.Provider>

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
  .sub {
    max-width: 68ch;
    font-size: var(--text-base);
    color: var(--ink-muted);
  }
  /* Tab strip: horizontally scrollable on narrow viewports with next tab
     peeking past the edge (JOURNEY.md §4 mobile reflow). */
  :global(.tab-strip) {
    width: 100% !important;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    border-bottom: 1px solid var(--border-hairline);
    background: transparent;
  }
  :global(.tab-strip::-webkit-scrollbar) {
    display: none;
  }
  :global(.tab-icon) {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.6;
  }
  :global([data-state="active"] .tab-icon) {
    opacity: 1;
  }
  .badge {
    color: var(--ink-label);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  /* On narrow viewports, hide tab labels — icon + badge is enough.
     The tab strip scrolls horizontally with the next tab peeking
     past the edge (JOURNEY.md §4 mobile reflow). */
  @media (max-width: 639px) {
    .tab-label {
      display: none;
    }
    :global(.tab-icon) {
      width: 18px;
      height: 18px;
    }
  }
  /* Tables inside panels must not overflow the viewport. */
  .pbody {
    overflow-x: auto;
  }
  .pbody :global(table) {
    min-width: 500px;
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
  .pbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Tab content slides horizontally on switch, keyed to tab order. */
  :global([data-tab-dir="right"] [data-state="active"][role="tabpanel"]) {
    animation: tab-slide-from-right 150ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }
  :global([data-tab-dir="left"] [data-state="active"][role="tabpanel"]) {
    animation: tab-slide-from-left 150ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }

  @keyframes tab-slide-from-right {
    from {
      transform: translateX(4%);
      opacity: 0;
    }
  }
  @keyframes tab-slide-from-left {
    from {
      transform: translateX(-4%);
      opacity: 0;
    }
  }
</style>

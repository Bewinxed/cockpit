<script lang="ts">
  /**
   * The management rail: what the fleet is, which boxes it runs on, the projects
   * it groups work under, and what is running right now. Ported from
   * mocks/v5-workspace.html (`aside`) — a sunken rail whose only raised things
   * are the active nav item, the primary action, and the cards at the foot.
   *
   * The rail is also the project index (JOURNEY §Projects rail / Flow 4): every
   * project is listed whether or not it has live work, with the creation control
   * beside its label, and running sessions fold under the project they belong to
   * — Linear/Slack-style grouping. Sessions no project claims stay flat under
   * "Running now". This is the same rail the phone opens as a sheet, so the
   * "New session" action lives here rather than in a bottom bar.
   */
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import {
    IconBoxDuo,
    IconChevronRight,
    IconFolderDuo,
    IconHook,
    IconPlus,
    IconRules,
    IconSubagent,
    IconTools,
    IconUsage,
  } from '$lib/icons';
  import {
    ACTIVITY_LABEL,
    SLEEPING_HINT,
    SLEEPING_LABEL,
    UNKNOWN_HINT,
    UNKNOWN_LABEL,
    type Activity,
  } from './activity';
  import {
    cockpit,
    isResumable,
    isStale,
    type InstanceRow,
    type ProjectRow,
  } from './client.svelte';
  import { machineLabel } from './machine';
  import { markHue, sessionSprite } from './mark';
  import { rail } from './rail.svelte';
  import FolderMenu from './FolderMenu.svelte';
  import MachineMenu from './MachineMenu.svelte';
  import NewProjectPopover from './NewProjectPopover.svelte';
  import OsMark from './OsMark.svelte';
  import SpawnPanel from './SpawnPanel.svelte';
  import UsageMeter from './UsageMeter.svelte';

  const path = $derived(page.url.pathname);

  /* ---- spawn ---------------------------------------------------------- */

  let spawnOpen = $state(false);
  let spawnPrefill = $state<{ machineId?: string; cwd?: string; projectId?: string } | undefined>(
    undefined
  );

  function newSession(prefill?: { machineId?: string; cwd?: string; projectId?: string }) {
    spawnPrefill = prefill;
    spawnOpen = true;
  }

  /* ---- projects ------------------------------------------------------- */

  /** Projects the reader has folded shut in the rail, by id. Expanded default. */
  let collapsed = $state<Set<string>>(new Set());

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  function collapseOthers(id: string) {
    collapsed = new Set(orderedProjects.filter((p) => p.id !== id).map((p) => p.id));
  }

  /** A running session belongs to a project by explicit link, or by living
   *  inside its checkout on the same machine — mirrors the hub's own `under`. */
  const inProject = (row: InstanceRow, project: ProjectRow): boolean =>
    row.projectId === project.id ||
    (row.machineId === project.machineId &&
      !!row.cwd &&
      (row.cwd === project.cwd || row.cwd.startsWith(`${project.cwd}/`)));

  const running = $derived(cockpit.runningInstances);

  /** Pinned projects first (giving the pin action a visible effect), then A–Z. */
  const orderedProjects = $derived.by(() =>
    [...cockpit.projects].sort((a, b) => {
      const pa = rail.isPinned('project', a.id) ? 0 : 1;
      const pb = rail.isPinned('project', b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    })
  );

  const sessionsOf = (project: ProjectRow): InstanceRow[] =>
    running.filter((row) => inProject(row, project));

  /** Live sessions no listed project claims — the flat "Running now" tail. */
  const ungrouped = $derived(
    running.filter((row) => !cockpit.projects.some((project) => inProject(row, project)))
  );

  /** Listed rows with no live process — asleep or unreachable. `running` above
   *  (and the Fleet pill's count) never includes these, so they get their own
   *  flat section rather than hiding inside a project's live-work count. */
  const notRunning = $derived(
    cockpit.listedInstances.filter((row) => isResumable(row) || isStale(row))
  );

  const notRunningLabel = (row: InstanceRow): string =>
    isResumable(row) ? SLEEPING_LABEL : UNKNOWN_LABEL;
  const notRunningHint = (row: InstanceRow): string =>
    isResumable(row) ? SLEEPING_HINT : UNKNOWN_HINT;

  /* ---- helpers -------------------------------------------------------- */

  /** The rail's own wording for a session that never carried a title. */
  const sessionName = (row: InstanceRow): string =>
    row.title?.trim() || row.cwd.split('/').filter(Boolean).pop() || row.id.slice(0, 8);

  /** Blocked wins the Fleet pill: it is the only count anyone acts on. */
  const fleetCount = $derived(cockpit.blockedCount || cockpit.runningInstances.length);

  const online = $derived(new Set(cockpit.onlineMachines.map((machine) => machine.machineId)));

  const PILL: Record<Activity, 'live' | 'attn' | 'idle'> = {
    working: 'live',
    blocked: 'attn',
    idle: 'idle',
  };

  /** StatusPill ported to ui/badge, token-dressed to the Quiet Ledger pill
   *  recipe: a tint carries live/attn, idle carries NO fill (bare muted label). */
  const PILL_FILL: Record<string, string> = {
    live: 'bg-[var(--status-live-bg)] text-[var(--status-live-ink)]',
    attn: 'bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]',
    done: 'bg-[var(--status-done-bg)] text-[var(--status-done-ink)]',
    fail: 'bg-[var(--status-fail-bg)] text-[var(--status-fail-ink)]',
  };
  function pillClass(status: 'live' | 'attn' | 'done' | 'fail' | 'idle' | 'stale'): string {
    const base =
      'h-[var(--c-pill-h)] rounded-[var(--radius-pill)] text-[length:var(--c-pill-fs)] leading-none whitespace-nowrap';
    if (status === 'idle')
      return `${base} border-0 gap-0 bg-transparent p-0 font-[450] text-[var(--status-idle-ink)]`;
    // Stale (`unknown`) carries an outline instead of a tint, same recipe as
    // LiveSessionRow: the hub has no fact to tint here, only the admission
    // that it lacks one.
    if (status === 'stale')
      return `${base} border border-[var(--border)] gap-[var(--c-pill-gap)] px-2.5 py-0 font-medium text-[var(--ink-muted)]`;
    return `${base} border-0 gap-[var(--c-pill-gap)] px-2.5 py-0 font-medium ${PILL_FILL[status]}`;
  }

  /** The NavItem count pill, as a token-dressed ui/badge: the fleet count on the
   *  live tint, or the attention tint while a session is blocked. */
  function countClass(attn: boolean): string {
    const tint = attn
      ? 'bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]'
      : 'bg-[var(--status-live-bg)] text-[var(--status-live-ink)]';
    return `ml-auto rounded-[var(--radius-pill)] border-0 px-[7px] py-[3px] text-[length:var(--text-sm)] font-medium leading-none ${tint}`;
  }
</script>

<div class="rail">
  <a class="brand" href="/session">
    <span class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <path d="M4 4h16v16H4z" />
        <path d="M4 4h8v16H4z" fill="currentColor" />
      </svg>
    </span>
    <b>Outpost</b>
  </a>

  <!-- The primary action, kept where both the desktop rail and the phone sheet
       reach it in one place — this is where the removed thumb bar's only unique
       control now lives. -->
  <div class="new">
    <Button class="new-btn" onclick={() => newSession()}>
      <IconPlus />
      New session
    </Button>
  </div>

  <div class="body">
    <div class="sec">Fleet</div>
    <nav aria-label="Fleet">
      {#snippet navItem(href: string, active: boolean, label: string, icon: import('svelte').Snippet, count?: number, attn = false)}
        <a class="nav-i" class:on={active} {href} aria-current={active ? 'page' : undefined}>
          <span class="ic">{@render icon()}</span>
          <span class="lbl">{label}</span>
          {#if count !== undefined && count !== null}
            <Badge class={countClass(attn)}>{count}</Badge>
          {/if}
        </a>
      {/snippet}
      {#snippet boxIcon()}<IconBoxDuo />{/snippet}
      {#snippet toolsIcon()}<IconTools />{/snippet}
      {#snippet rulesIcon()}<IconRules />{/snippet}
      {#snippet hooksIcon()}<IconHook />{/snippet}
      {#snippet delegatesIcon()}<IconSubagent />{/snippet}
      {#snippet usageIcon()}<IconUsage />{/snippet}
      {@render navItem(
        '/session',
        path.startsWith('/session'),
        'Fleet',
        boxIcon,
        fleetCount || undefined,
        cockpit.blockedCount > 0
      )}
      {@render navItem('/tools', path.startsWith('/tools'), 'Tools', toolsIcon)}
      {@render navItem('/rules', path.startsWith('/rules'), 'Rules', rulesIcon)}
      {@render navItem('/hooks', path.startsWith('/hooks'), 'Hooks', hooksIcon)}
      {@render navItem('/delegates', path.startsWith('/delegates'), 'Delegates', delegatesIcon)}
      {@render navItem('/usage', path.startsWith('/usage'), 'Usage', usageIcon)}
    </nav>

    {#if cockpit.machines.length > 0}
      <div class="sec">Machines</div>
      <div class="rows" role="list">
        {#each cockpit.machines as machine (machine.machineId)}
          <MachineMenu {machine}>
            <div class="row machine" role="listitem">
              <OsMark os={machine.os} class="os" />
              <span class="nm">{machineLabel(machine.hostname)}</span>
              <span
                class="dot {online.has(machine.machineId) ? 'up' : ''}"
                title={online.has(machine.machineId) ? 'Online' : 'Offline'}
              ></span>
            </div>
          </MachineMenu>
        {/each}
      </div>
    {/if}

    <!-- Projects — the rail's project index. A label, the creation control
         beside it, and every project as a foldable group of its live work. -->
    <div class="sec sec-row">
      <span>Projects</span>
      <NewProjectPopover />
    </div>
    {#if orderedProjects.length === 0}
      <p class="hint">
        {#if cockpit.machines.length === 0}
          Run <code>cockpit</code> on a machine, then group its checkouts here.
        {:else}
          No projects yet — name a checkout to group its sessions.
        {/if}
      </p>
    {:else}
      <div class="rows" role="list">
        {#each orderedProjects as project (project.id)}
          {@const sessions = sessionsOf(project)}
          {@const open = !collapsed.has(project.id)}
          <FolderMenu
            name={project.name}
            cwd={project.cwd}
            {project}
            onnew={() =>
              newSession({ projectId: project.id, machineId: project.machineId, cwd: project.cwd })}
            oncollapseothers={() => collapseOthers(project.id)}
          >
            <div class="folder" role="listitem">
              <button
                type="button"
                class="folder-h"
                class:on={path === `/project/${project.id}`}
                aria-expanded={open}
                onclick={() => toggle(project.id)}
              >
                <span class="tw" class:open aria-hidden="true"><IconChevronRight /></span>
                <span class="mark m{markHue(project.cwd)}"><IconFolderDuo /></span>
                <span class="nm">{project.name}</span>
                {#if sessions.length > 0}<span class="cnt">{sessions.length}</span>{/if}
              </button>
            </div>
          </FolderMenu>
          {#if open}
            <div class="sub">
              {#each sessions as row (row.id)}
                {@const Sprite = sessionSprite(row.id)}
                {@const activity = cockpit.activityOf(row.id)}
                <a class="row sub-i" class:on={path === `/session/${row.id}`} href="/session/{row.id}">
                  <span class="mark m{markHue(row.cwd || row.machineId)}">
                    <Sprite aria-hidden="true" />
                  </span>
                  <span class="nm">{sessionName(row)}</span>
                  <Badge class={pillClass(PILL[activity])}>{ACTIVITY_LABEL[activity]}</Badge>
                </a>
              {:else}
                <button
                  type="button"
                  class="row sub-i empty"
                  onclick={() =>
                    newSession({
                      projectId: project.id,
                      machineId: project.machineId,
                      cwd: project.cwd,
                    })}
                >
                  <span class="nm dim">No sessions — start one</span>
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    {#if ungrouped.length > 0}
      <div class="sec">Running now</div>
      <div class="rows">
        {#each ungrouped as row (row.id)}
          {@const activity = cockpit.activityOf(row.id)}
          {@const Sprite = sessionSprite(row.id)}
          <a class="row" class:on={path === `/session/${row.id}`} href="/session/{row.id}">
            <span class="mark m{markHue(row.cwd || row.machineId)}">
              <Sprite aria-hidden="true" />
            </span>
            <span class="nm">{sessionName(row)}</span>
            <Badge class={pillClass(PILL[activity])}>{ACTIVITY_LABEL[activity]}</Badge>
          </a>
        {/each}
      </div>
    {/if}

    <!-- Asleep and unreachable rows never join `running` above, so without
         this the rail — the first place the operator looks — would show
         nothing for them at all. Kept in its own section, never folded into
         the Fleet pill or the "Running now" live tail. -->
    {#if notRunning.length > 0}
      <div class="sec">Not running</div>
      <div class="rows">
        {#each notRunning as row (row.id)}
          {@const Sprite = sessionSprite(row.id)}
          <a
            class="row"
            class:on={path === `/session/${row.id}`}
            href="/session/{row.id}"
            title={notRunningHint(row)}
          >
            <span class="mark m{markHue(row.cwd || row.machineId)}" style="opacity:0.6">
              <Sprite aria-hidden="true" />
            </span>
            <span class="nm">{sessionName(row)}</span>
            <Badge class={pillClass('stale')}>{notRunningLabel(row)}</Badge>
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <div class="foot">
    <UsageMeter />
    <div class="me">
      <span class="av" aria-hidden="true">bw</span>
      <span class="who">
        <span class="nm">bewinxed</span>
        <span class="em">{cockpit.machines.length} machines</span>
      </span>
    </div>
  </div>
</div>

<SpawnPanel open={spawnOpen} prefill={spawnPrefill} onclose={() => (spawnOpen = false)} />

<style>
  .rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--surface-sunken);
    overflow: hidden;
  }

  .brand {
    height: 57px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 var(--space-4);
    text-decoration: none;
    color: var(--ink-strong);
  }
  .logo {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-well);
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .logo svg {
    width: 15px;
    height: 15px;
    display: block;
  }
  .brand b {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
  }

  /* The primary action reads as the one lifted control in the sunken rail. */
  .new {
    flex-shrink: 0;
    padding: 0 10px var(--space-2);
  }
  .new :global(.new-btn) {
    width: 100%;
    justify-content: center;
    gap: var(--space-2);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--space-4);
  }

  .sec {
    font-size: var(--text-xs);
    color: var(--ink-muted);
    font-weight: var(--weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
    padding: 0 var(--space-6);
    margin: var(--space-4) 0 var(--space-2);
  }
  /* The Projects label carries its creation control at the trailing edge. */
  .sec-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-right: 10px;
  }

  .hint {
    padding: 0 var(--space-6);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    color: var(--ink-muted);
  }
  .hint code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-body);
  }

  nav,
  .rows {
    padding: 0 10px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* NavItem ported to a token-styled anchor matching mock .nav-i (ui/sidebar's
     sidebar-menu-button needs a SidebarProvider this rail does not mount, so the
     token anchor is the clean fit). Active = raised fill on the sunken rail. */
  .nav-i {
    height: var(--c-nav-h);
    border-radius: var(--radius-control);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    font-size: var(--text-md);
    color: var(--ink-body);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }
  .nav-i .ic {
    width: 18px;
    flex: 0 0 auto;
    color: var(--ink-muted);
    display: grid;
    place-items: center;
  }
  .nav-i .ic :global(svg) {
    width: 16px;
    height: 16px;
    display: block;
  }
  .nav-i .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nav-i.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    box-shadow: var(--shadow-tile);
    font-weight: var(--weight-strong);
  }
  .nav-i.on .ic {
    color: var(--ink-body);
  }
  @media (hover: hover) and (pointer: fine) {
    .nav-i:hover {
      background: var(--surface-hover);
    }
    .nav-i.on:hover {
      background: var(--surface-raised);
    }
    .nav-i:active {
      background: var(--surface-active);
    }
  }
  .nav-i:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-control);
  }

  .row {
    height: 30px;
    border-radius: var(--radius-tile);
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 10px;
    font-size: var(--text-base);
    color: var(--ink-body);
    font-weight: var(--weight-medium);
    text-decoration: none;
    min-width: 0;
  }
  .row.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: var(--weight-strong);
    box-shadow: var(--shadow-tile);
  }
  .row .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row :global(.os) {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--ink-muted);
  }

  /* ---- projects group -------------------------------------------------- */

  .folder {
    display: flex;
  }
  .folder-h {
    flex: 1 1 auto;
    height: 30px;
    border: 0;
    background: none;
    /* Outer radius = the inner mark's radius + its inset, so the fill sits
       concentric with the mark rather than sharing one radius. */
    border-radius: var(--radius-tile);
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 10px 0 6px;
    min-width: 0;
    cursor: pointer;
    color: var(--ink-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    /* Only the surface transitions, and it stays interruptible. */
    transition: background var(--motion-fast) var(--ease-toggle);
  }
  .folder-h .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .folder-h.on {
    color: var(--ink-strong);
    font-weight: var(--weight-strong);
  }
  .tw {
    width: 14px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    color: var(--ink-muted);
    /* The static cue for open/closed is the direction the chevron points; the
       rotation is only the transition between those two static states. */
    transition: transform var(--motion-fast) var(--ease-toggle);
  }
  .tw.open {
    transform: rotate(90deg);
  }
  .tw :global(svg) {
    width: 13px;
    height: 13px;
    display: block;
  }
  .cnt {
    flex: 0 0 auto;
    font-size: var(--text-sm);
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  /* Sessions sit indented under their folder header, aligned past the twist. */
  .sub {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sub-i {
    padding-left: 29px;
  }
  .sub-i.empty {
    border: 0;
    background: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font: inherit;
  }
  .sub-i .dim {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
  @media (hover: hover) and (pointer: fine) {
    .folder-h:hover,
    .sub-i.empty:hover {
      background: var(--surface-hover);
    }
  }
  .folder-h:focus-visible,
  .sub-i.empty:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  /* Tactile press on the rail's own buttons; suppressed for reduced motion. */
  .folder-h:active,
  .tw:active,
  .sub-i.empty:active {
    transform: scale(0.98);
  }
  .tw:active {
    /* the twist keeps its rotation cue while dipping under the press */
    transform: rotate(0deg) scale(0.98);
  }
  .tw.open:active {
    transform: rotate(90deg) scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .folder-h,
    .tw {
      transition: none;
    }
    .folder-h:active,
    .sub-i.empty:active {
      transform: none;
    }
    .tw:active {
      transform: rotate(0deg);
    }
    .tw.open:active {
      transform: rotate(90deg);
    }
  }

  /* Item mark — inlined token primitive (17px running-now recipe): identity hue
     square carrying the per-session duotone sprite (or the folder glyph), with
     the top-light / bottom-shade overlay. Sized ~10px, optically centred by the
     grid, white-glyph convention. Kept identical across the sidebar cluster. */
  .mark {
    width: 17px;
    height: 17px;
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .mark :global(svg) {
    width: 11px;
    height: 11px;
    display: block;
    color: var(--mark-glyph);
  }
  .mark.m2 { background-color: var(--mark-2); }
  .mark.m3 { background-color: var(--mark-3); }
  .mark.m4 { background-color: var(--mark-4); }
  .mark.m5 { background-color: var(--mark-5); }
  .mark.m6 { background-color: var(--mark-6); }
  .mark.m7 { background-color: var(--mark-7); }
  .mark.m8 { background-color: var(--mark-8); }
  @media (hover: hover) and (pointer: fine) {
    .row:hover {
      background: var(--surface-hover);
    }
  }
  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .machine {
    cursor: default;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    flex: 0 0 auto;
    background: var(--border-control);
  }
  .dot.up {
    background: var(--status-done-ink);
  }

  .foot {
    flex: 0 0 auto;
    padding: 0 10px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .me {
    border-top: 1px solid var(--border-hairline);
    height: 60px;
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: var(--space-1);
  }
  .av {
    width: 31px;
    height: 31px;
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    box-shadow: var(--shadow-tile);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--ink-body);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .me .nm {
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    line-height: 1.25;
    color: var(--ink-strong);
  }
  .me .em {
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
</style>

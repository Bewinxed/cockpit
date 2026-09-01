<script module lang="ts">
  /**
   * One clock for the whole board. A row that ticked for itself would put a
   * timer per session on a card of thirty, and they all read the same second.
   */
  let now = $state(Date.now());
  let watchers = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  function watchClock(): () => void {
    if (watchers++ === 0) ticker = setInterval(() => (now = Date.now()), 1000);
    return () => {
      if (--watchers === 0) clearInterval(ticker);
    };
  }
</script>

<script lang="ts">
  /** One live session, as the session index and a project home both list it. */
  import { onMount } from 'svelte';
  import { dragSession } from './workspace/dnd.svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { Badge } from '$lib/components/ui/badge';
  import { markHue, sessionSprite } from './mark';
  import { formatDuration } from '$lib/utils/time';
  import { ACTIVITY_LABEL, SLEEPING_HINT, UNKNOWN_HINT } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import { whiffle, isFailed, isResumable, isStale, type InstanceRow } from './client.svelte';
  import { identityVar } from './folder-prefs.svelte';
  import { sessionTitle } from './links';
  import LiveSessionMenu from './LiveSessionMenu.svelte';
  import TaskRing from './TaskRing.svelte';
  import { taskProgress, tasksOf } from './tasks.svelte';

  interface Props {
    instance: InstanceRow;
    /** The card's own path, where it has one: a row in it repeating that path
     *  says nothing, so the row keeps quiet and the card speaks for it. */
    groupCwd?: string;
  }

  let { instance, groupCwd }: Props = $props();

  const showCwd = $derived(Boolean(instance.cwd) && instance.cwd !== groupCwd);

  // The per-session identity sprite: distinct per session (seeded by the
  // instance id), so two sessions in one project are told apart by SHAPE, not
  // only by the project hue. markHue below still carries the project colour.
  const Sprite = $derived(sessionSprite(instance.id));

  const activity = $derived(whiffle.activityOf(instance.id));
  const tool = $derived(whiffle.currentToolOf(instance.id));
  const sleeping = $derived(isResumable(instance));
  const failed = $derived(isFailed(instance));
  /** The hub can't reach this row's machine — distinct from idle and asleep. */
  const stale = $derived(isStale(instance));
  const quest = $derived(instance.kind === 'scratch');
  /** Sleeping and stale no longer get a word here — `ActivityDot` carries
   *  both as its own glyph now (leaf Y1), so this label is only ever seen as
   *  a `Badge`'s text, for the states that still get one. */
  const label = $derived(failed ? 'Failed' : ACTIVITY_LABEL[activity]);

  /** The Quiet Ledger status the row's state pill wears: fail red, needs-you
   *  amber, working blue-live, everything else at rest bare-idle. */
  const pillStatus = $derived(
    failed
      ? 'fail'
      : activity === 'blocked'
        ? 'attn'
        : activity === 'working'
          ? 'live'
          : 'idle'
  );

  /** StatusPill ported to ui/badge, token-dressed to the Quiet Ledger pill
   *  recipe: a tint carries live/attn/done/fail, idle carries NO fill (bare
   *  muted label). */
  const PILL_FILL: Record<string, string> = {
    live: 'bg-[var(--status-live-bg)] text-[var(--status-live-ink)]',
    attn: 'bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]',
    done: 'bg-[var(--status-done-bg)] text-[var(--status-done-ink)]',
    fail: 'bg-[var(--status-fail-bg)] text-[var(--status-fail-ink)]',
  };
  function pillClass(status: 'live' | 'attn' | 'done' | 'fail' | 'idle'): string {
    const base =
      'h-[var(--c-pill-h)] rounded-[var(--radius-pill)] border-0 text-[length:var(--c-pill-fs)] leading-none whitespace-nowrap';
    if (status === 'idle')
      return `${base} gap-0 bg-transparent p-0 font-[450] text-[var(--status-idle-ink)]`;
    return `${base} gap-[var(--c-pill-gap)] px-2.5 py-0 font-medium ${PILL_FILL[status]}`;
  }

  // What the session is about, not where it runs: the SDK's own title for the
  // transcript this instance is writing. A quest is tagged out of the catalog,
  // and a session that has not spoken yet is not in it either, so both land on
  // the fallback with the path beside them to say the rest.
  // Read only — the board sweeps the fleet's ledgers once on arrival and the
  // frames keep them current. A row that fetched for itself would make a card
  // of thirty sessions thirty round trips in one frame.
  const plan = $derived(tasksOf(instance.id));
  const progress = $derived(plan && plan.tasks.length > 0 ? taskProgress(plan) : null);

  /**
   * A session running an open-ended ask writes no plan, and a run of any length
   * still owes the reader a reading. What it gets is the honest one: a ring that
   * turns to say the session is alive, and how long it has been on the step it
   * is on. No fraction is invented — there is nothing to take a fraction of.
   */
  const unmeasured = $derived(!progress && !failed && !sleeping && !stale && activity === 'working');

  $effect(() => {
    if (!unmeasured) return;
    return watchClock();
  });

  // The daemon stamps the pulse from its own clock, so a machine a few seconds
  // out from this browser must not read as a run that started in the future.
  const pulseAt = $derived(whiffle.pulseAt(instance.id));
  const onStepFor = $derived(
    unmeasured && pulseAt !== undefined ? formatDuration(Math.max(0, now - pulseAt)) : null
  );

  const title = $derived.by(() => {
    const info = instance.sessionId
      ? whiffle.catalogOf(instance.machineId).find((row) => row.sessionId === instance.sessionId)
      : undefined;
    if (info) return sessionTitle(info);
    // What its spawn said it is for — a delegate's brief, first line — before
    // the fallback, since a delegate is never in the catalog to begin with.
    return instance.title ?? 'untitled session';
  });

  // The label swaps only when the session's state actually changes — a row that
  // simply appears with the page has nothing to announce.
  let painted = $state(false);
  onMount(() => void (painted = true));
</script>

<LiveSessionMenu {instance}>
  <a
    use:dragSession={{ sessionId: instance.id, from: null }}
    href="/session/{instance.id}"
    title={sleeping ? SLEEPING_HINT : stale ? UNKNOWN_HINT : undefined}
    class="group flex min-h-9 flex-col justify-center gap-0.5 rounded-[var(--radius-control)] px-4 py-1.5
      transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground
      {failed || activity === 'blocked' ? 'bg-error/10' : ''}"
  >
    <!-- The row's band is the card's full width, so the whole strip is the
         hover target; what it *says* stops at a scannable measure, or an
         ultrawide track leaves the state word a screen away from the name. -->
    <span class="flex max-w-3xl items-center gap-3">
      <!-- The card's lead column: the header's 20px mark sits in the same one,
           so a card has a single title column rather than a header set in from
           the rows it heads. -->
      <span
        class="flex shrink-0 items-center justify-center {sleeping || stale ? 'opacity-60' : ''}"
        style="--c-mark:20px;--c-mark-glyph:11px"
      >
        <span class="mark m{markHue(instance.cwd || instance.machineId)}">
          <Sprite aria-hidden="true" />
        </span>
      </span>
      <!-- `max-w-lg`: a title that runs on — a pasted URL, usually — stops at a
           readable measure instead of crushing the path beside it. -->
      <span class="min-w-0 max-w-lg truncate text-[13px]">{title}</span>
      <!-- A quest is named beside its title rather than glyphed in front of it:
           the lead slot belongs to state, and the titles keep their column. -->
      {#if quest}
        <Badge variant="secondary" class="shrink-0 text-micro font-normal">side quest</Badge>
      {/if}
      <!-- Where it runs, second — and beside the title rather than in a column
           of its own: on a wide track a path pinned right sits half a card away
           from the name it belongs to, and the two stop reading as one row.
           Under pressure it yields three times as readily as the title, and
           what it keeps it gives up from the left — the leaf is what tells two
           checkouts apart. -->
      {#if showCwd}
        <span
          class="hidden min-w-24 shrink-[3] truncate font-mono text-micro text-muted-foreground [direction:rtl] sm:block"
          title={instance.cwd}
        ><bdi>{instance.cwd}</bdi></span>
      {/if}
      <!-- How far its plan has got, at a glance and nothing more: the row is
           already a link, and a control inside one is two targets sharing a
           36px band. It takes the right cluster's `ml-auto` when it is here,
           so the state word beside it keeps reading as one group. -->
      {#if progress}
        <span
          class="ml-auto flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground tabular-nums"
          data-tabular
        >
          <span class="identity-ink flex items-center" style={identityVar(instance.cwd)}>
            <TaskRing done={progress.done} total={progress.total} size="sm" />
          </span>
          {progress.done}/{progress.total}
        </span>
        <!-- No plan to measure, but the session is running: a turning arc and how
             long it has been on this step, which is what is actually known. -->
      {:else if unmeasured}
        <span
          class="ml-auto flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground tabular-nums"
          data-tabular
          title={onStepFor
            ? `Working — no task plan; ${onStepFor} on this step`
            : 'Working — no task plan'}
        >
          <span class="identity-ink flex items-center" style={identityVar(instance.cwd)}>
            <TaskRing indeterminate size="sm" />
          </span>
          {#if onStepFor}{onStepFor}{/if}
        </span>
      {/if}
      <!-- The state: sleeping and stale get `ActivityDot`'s own glyph, not a
           second word beside it (leaf Y1 — that word was "Sleeping" or
           "Unknown" on 176 identical rows). Every other state keeps the
           Quiet Ledger status pill: a tint carries working / needs-you /
           failed, and idle carries no fill (bare muted label). -->
      <span
        class="inline-grid shrink-0 justify-items-end {progress || unmeasured ? 'ml-2' : 'ml-auto'}"
      >
        {#if sleeping || stale}
          <ActivityDot {activity} {sleeping} {stale} />
        {:else}
          {#key label}
            <span
              class="col-start-1 row-start-1"
              in:fly={{ y: 5, duration: painted ? 180 : 0, easing: quintOut }}
              out:fly={{ y: -5, duration: painted ? 140 : 0, easing: quintOut }}
            >
              <Badge class={pillClass(pillStatus)}>{label}</Badge>
            </span>
          {/key}
        {/if}
      </span>
    </span>
    {#if activity === 'working' && tool}
      <span class="flex max-w-3xl items-baseline gap-2 pl-8 text-micro text-muted-foreground">
        <span class="shrink-0">{tool.name}</span>
        <span class="truncate font-mono">{tool.glance}</span>
      </span>
    {/if}
  </a>
</LiveSessionMenu>

<style>
  /* Item mark — inlined token primitive (identity hue + harness glyph, top-light
     overlay). No clean shadcn equivalent; kept identical in recipe across the
     four sidebar-cluster files. Size comes from --c-mark / --c-mark-glyph set on
     the wrapper. */
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
  .mark :global(svg) {
    width: var(--c-mark-glyph);
    height: var(--c-mark-glyph);
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
</style>

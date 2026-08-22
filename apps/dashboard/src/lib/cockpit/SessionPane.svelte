<script lang="ts">
  /**
   * One conversation, whole: the identity header, the transcript (Chat) or its
   * graph (Flow), and the floating composer with any parked permission or
   * question stacked above it. Held per open tab by the session layout, so its
   * scroll offset and half-typed message survive a switch — nothing here
   * unmounts on navigation.
   */
  import { untrack } from 'svelte';
  import type { EffortLevel, PermissionMode } from '@cockpit/core';
  import {
    cockpit,
    openSession,
    openTranscript,
    backfillSession,
    sendOrRevive,
    interrupt,
    loadMcpServers,
    loadCommands,
    setModel,
    setPermissionMode,
    setEffort,
    relaunchSession,
    type PendingPermission,
    type SendExtras,
    type TranscriptOutcome,
  } from './client.svelte';
  import { PERMISSION_MODES } from './permission-modes';
  import { effortStops, hasEffortScale } from './effort-levels';
  import { covers, ensureModels, models } from './models.svelte';
  import { routedToParent } from './frames';
  import { delegateHandle, resolveSessionTitle } from './links';
  import SessionHeader from './transcript/SessionHeader.svelte';
  import Transcript from './transcript/Transcript.svelte';
  import Composer, { type Mention } from './transcript/Composer.svelte';
  import Prompt from './transcript/Prompt.svelte';
  import FlowView from '$lib/components/features/flow/FlowView.svelte';

  let {
    viewId,
    browsing,
    browsingCwd,
    browsingHarness,
    active,
  }: {
    viewId: string;
    browsing: string | null;
    browsingCwd: string;
    browsingHarness: string;
    active: boolean;
  } = $props();

  /** Why this pane has nothing to show, when it has nothing to show. */
  let failure = $state<{ reason: 'offline' | 'failed'; message: string } | null>(null);
  /** Bumped by Retry: the one thing that re-runs the read after it has failed. */
  let attempt = $state(0);

  // Bring the conversation into being: a stored session reads its transcript
  // back, a live one is opened (subscribed) and backfilled with what it said
  // before this tab joined.
  //
  // Deliberately untracked around the store. Both calls read AND write the
  // session's own `messages` / `loading`, so a plainly-tracked effect re-runs
  // itself on the transcript it just published; the URL this pane was opened
  // with, plus an explicit retry, are the only things that should start a read.
  $effect(() => {
    const id = viewId;
    const machineId = browsing;
    const cwd = browsingCwd;
    const harness = browsingHarness;
    void attempt;
    if (!id) return;
    // Retry the read once the hub can actually answer. On a reload the effect
    // first runs while the socket is still reconnecting — a live session's
    // machineId isn't known yet (backfill bails) and a stored read can't reach
    // the socket. Tracking the connection and the live session's machineId
    // (neither written by the read below) re-runs this the moment it becomes
    // answerable, so the transcript backfills instead of staying empty.
    void cockpit.status;
    void cockpit.session(id)?.machineId;
    untrack(() => {
      failure = null;
      if (machineId) {
        void openTranscript({
          viewId: id,
          machineId,
          sessionId: id,
          cwd,
          harness: harness as never,
        }).then((outcome: TranscriptOutcome) => {
          if (!outcome.ok) failure = { reason: outcome.reason, message: outcome.message };
        });
      } else {
        openSession(id);
        void backfillSession(id);
      }
    });
  });

  const session = $derived(cockpit.session(viewId));
  const machineId = $derived(session?.machineId ?? '');

  /**
   * A live session addressed by id alone that the hub has never heard of. There
   * is nothing to subscribe to and nothing to read back — without the machine
   * and stored-session id a transcript link carries, this pane can only sit
   * empty, so it says so instead.
   */
  const unaddressable = $derived(
    !browsing &&
      !!session &&
      !session.machineId &&
      session.messages.length === 0 &&
      // Only once the hub has answered. Before that every id is unknown, and
      // saying so would flash an error over a session that is merely loading.
      cockpit.hub === 'connected' &&
      cockpit.instances.length > 0
  );

  // The header's MCP count wants a reading, and the composer's `/` menu wants
  // the descriptions; only a live session answers either.
  $effect(() => {
    if (session && !browsing && machineId) {
      void loadMcpServers(viewId, machineId);
      void loadCommands(viewId, machineId);
    }
  });

  const HARNESS_LABEL: Record<string, string> = {
    claude: 'Claude Code',
    opencode: 'opencode',
    code: 'opencode',
    pi: 'pi',
  };
  const agentName = $derived(HARNESS_LABEL[session?.harness ?? ''] ?? (session?.harness ?? 'Agent'));

  const machineName = $derived(
    cockpit.machines.find((m) => m.machineId === machineId)?.hostname ?? machineId
  );

  /**
   * What this conversation is called. The same helper the tab strip uses, so
   * the tab and the bar under it are never naming two different sessions.
   */
  const title = $derived(
    resolveSessionTitle({
      title: cockpit.instances.find((i) => i.id === viewId)?.title,
      firstMessage: session?.messages.find((m) => m.type === 'user' && m.content.trim())?.content,
      cwd: session?.cwd || browsingCwd,
      id: viewId,
    })
  );

  const stats = $derived(cockpit.statsOf(viewId));
  const activity = $derived(cockpit.activityOf(viewId));

  // The session settings — model, permission mode, effort — are switchable from
  // the header now, so the same reference data the spawn form uses is derived
  // here and the store setters are the exact desktop path a change takes.
  const machineRow = $derived(cockpit.machines.find((m) => m.machineId === machineId) ?? null);
  const harnessReport = $derived(
    machineRow?.harnesses?.find((report) => report.harness === session?.harness) ?? null
  );
  /** The permission modes this session's harness can honour; empty hides the picker. */
  const offeredModes = $derived(
    harnessReport
      ? PERMISSION_MODES.filter((mode) =>
          harnessReport.capabilities.permissionModes.includes(mode.value)
        )
      : PERMISSION_MODES
  );
  /** The offered row for the model in force, which is what carries its scale. */
  const chosenModel = $derived(
    session?.model ? (models.offered.find((row) => covers(row, session.model!)) ?? null) : null
  );
  /** Whether the harness runs at an effort at all — the row is named either way. */
  const harnessEffort = $derived(harnessReport?.capabilities.effort !== false);
  /** Only drawn when the harness and the model both report an effort scale. */
  const showEffort = $derived(harnessEffort && hasEffortScale(chosenModel));
  const effortStopsForModel = $derived(effortStops(chosenModel));

  // Populate the model list so the effort scale can be read even before the
  // picker is opened; a session with nothing to ask just leaves it empty.
  $effect(() => {
    ensureModels();
  });

  /** What `@` can name: the other conversations in the strip, and the machines. */
  const mentions = $derived<Mention[]>([
    ...cockpit.instances
      .filter((row) => row.id !== viewId)
      .slice(0, 40)
      .map((row) => ({
        handle: delegateHandle(row),
        label: delegateHandle(row),
        detail: row.title?.trim() || row.cwd,
      })),
    ...cockpit.machines.map((machine) => ({
      handle: machine.hostname || machine.machineId,
      label: machine.hostname || machine.machineId,
      detail: machine.status,
    })),
  ]);

  const commands = $derived(cockpit.commandsOf(viewId));

  function onmodel(model: string): void {
    if (!machineId) return;
    void setModel(viewId, machineId, model).catch(() => {});
  }

  function onpermission(mode: PermissionMode): void {
    if (!machineId) return;
    // bypassPermissions is a launch decision the SDK refuses to switch into, so
    // that one mode relaunches the session in place; the rest switch live.
    const apply =
      mode === 'bypassPermissions'
        ? relaunchSession(viewId, machineId, mode)
        : setPermissionMode(viewId, machineId, mode);
    void apply.catch(() => {});
  }

  function oneffort(level: EffortLevel): void {
    if (!machineId) return;
    void setEffort(viewId, machineId, level).catch(() => {});
  }

  // A delegate's ask belongs to its parent, never the reader's queue.
  const parked = $derived<PendingPermission[]>(
    (session?.pending ?? []).filter((p) => !routedToParent(p))
  );

  let view = $state<'chat' | 'flow'>('chat');
  let draft = $state('');

  const flowSubagents = $derived(new Map(Object.entries(session?.subagents ?? {})));

  function onsubmit(text: string, extras: SendExtras = {}): void {
    if (!machineId) return;
    void sendOrRevive(viewId, machineId, text, extras);
  }

  function onstop(): void {
    if (machineId) interrupt(viewId, machineId);
  }
</script>

<div class="pane">
  {#if session}
    <SessionHeader
      {title}
      seed={session.cwd || browsingCwd || viewId}
      spriteSeed={viewId}
      harness={session.harness}
      {machineName}
      cwd={session.cwd || browsingCwd}
      {activity}
      model={session.model}
      permissionMode={session.permissionMode}
      effort={session.effort}
      mcpCount={session.mcp?.length ?? null}
      turns={stats.turns}
      totalTokens={stats.totalTokens}
      maxTokens={stats.maxTokens}
      cost={stats.cost}
      {view}
      onview={(v) => (view = v)}
      {offeredModes}
      effortStops={effortStopsForModel}
      {showEffort}
      {harnessEffort}
      {onmodel}
      {onpermission}
      {oneffort}
    />

    <div class="body">
      {#if failure}
        <!-- A valid URL that cannot be read says why. An empty scroller for a
             link that resolves is indistinguishable from a broken app. -->
        <div class="stateful">
          <h2>
            {failure.reason === 'offline'
              ? 'This machine is offline'
              : "This transcript couldn't be read"}
          </h2>
          <p>{failure.message}</p>
          <button type="button" onclick={() => (attempt += 1)}>Try again</button>
        </div>
      {:else if unaddressable}
        <div class="stateful">
          <h2>This session isn't running here</h2>
          <p>
            The hub has no record of <code>{viewId}</code>. Open it from its machine's stored
            sessions, and the link will carry the machine and folder its transcript is filed under.
          </p>
          <a href="/session">Back to the fleet</a>
        </div>
      {:else if view === 'flow'}
        <FlowView
          instanceId={viewId}
          messages={session.messages}
          subagents={flowSubagents}
          streamingToolId={session.currentTool?.toolId}
          totalCostUsd={session.totalCost}
        />
      {:else}
        <Transcript {session} {agentName} {active} />
      {/if}

      {#if !failure && !unaddressable}
        <Composer
          bind:value={draft}
          busy={session.busy}
          {commands}
          {mentions}
          {onsubmit}
          {onstop}
        >
          {#snippet prompts()}
            {#each parked as request (request.requestId)}
              <Prompt {request} {machineId} />
            {/each}
          {/snippet}
        </Composer>
      {/if}
    </div>
  {:else}
    <div class="loading">Opening session…</div>
  {/if}
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    background: var(--surface-field);
  }
  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .loading {
    display: grid;
    place-items: center;
    flex: 1 1 auto;
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  /* A named state, not an empty pane: what happened, in one line, and the one
     thing that can be done about it. */
  .stateful {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    max-width: 46ch;
    margin: auto;
    padding: var(--space-6);
  }
  .stateful h2 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
  }
  .stateful p {
    font-size: var(--text-base);
    line-height: var(--leading-body);
    color: var(--ink-muted);
  }
  .stateful code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .stateful button,
  .stateful a {
    height: 34px;
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-body);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    display: inline-grid;
    place-items: center;
    text-decoration: none;
    cursor: pointer;
    transition:
      background-color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  @media (hover: hover) and (pointer: fine) {
    .stateful button:hover,
    .stateful a:hover {
      background: var(--surface-hover);
    }
  }
  .stateful button:active,
  .stateful a:active {
    transform: scale(0.96);
  }
  @media (pointer: coarse) {
    .stateful button,
    .stateful a {
      height: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stateful button,
    .stateful a {
      transition: none;
    }
    .stateful button:active,
    .stateful a:active {
      transform: none;
    }
  }
</style>

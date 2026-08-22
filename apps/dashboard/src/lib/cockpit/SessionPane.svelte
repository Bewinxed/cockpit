<script lang="ts">
  /**
   * One conversation, whole: the identity header, the transcript (Chat) or its
   * graph (Flow), and the floating composer with any parked permission or
   * question stacked above it. Held per open tab by the session layout, so its
   * scroll offset and half-typed message survive a switch — nothing here
   * unmounts on navigation.
   */
  import type { EffortLevel, PermissionMode } from '@cockpit/core';
  import {
    cockpit,
    openSession,
    openTranscript,
    backfillSession,
    sendOrRevive,
    interrupt,
    loadMcpServers,
    setModel,
    setPermissionMode,
    setEffort,
    relaunchSession,
    type PendingPermission,
    type SendExtras,
  } from './client.svelte';
  import { PERMISSION_MODES } from './permission-modes';
  import { effortStops, hasEffortScale } from './effort-levels';
  import { covers, ensureModels, models } from './models.svelte';
  import { routedToParent } from './frames';
  import SessionHeader from './transcript/SessionHeader.svelte';
  import Transcript from './transcript/Transcript.svelte';
  import Composer from './transcript/Composer.svelte';
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

  // Bring the conversation into being: a stored session reads its transcript
  // back, a live one is opened (subscribed) and backfilled with what it said
  // before this tab joined.
  $effect(() => {
    const id = viewId;
    if (!id) return;
    if (browsing) {
      void openTranscript({
        viewId: id,
        machineId: browsing,
        sessionId: id,
        cwd: browsingCwd,
        harness: browsingHarness as never,
      });
    } else {
      openSession(id);
      void backfillSession(id);
    }
  });

  const session = $derived(cockpit.session(viewId));
  const machineId = $derived(session?.machineId ?? '');

  // The header's MCP count wants a reading, and only a live session answers.
  $effect(() => {
    if (session && !browsing && machineId) void loadMcpServers(viewId, machineId);
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

  const title = $derived.by(() => {
    // The hub's session title (the harness's own summary) is exactly what the tab
    // strip shows, so the header names the same session the reader clicked —
    // otherwise a first-message-derived header reads as an unrelated conversation.
    const named = cockpit.instances.find((i) => i.id === viewId)?.title?.trim();
    if (named) return named;
    const first = session?.messages.find((m) => m.type === 'user' && m.content.trim());
    if (first) {
      const raw = first.content;
      // A slash command's first message is the harness echo, which wraps the
      // invocation in <command-message>/<command-name>. Show the command, not
      // the raw XML tag. Otherwise strip any wrapping markup and take line one.
      const command = /<command-(?:message|name)>([\s\S]*?)<\/command-(?:message|name)>/
        .exec(raw)?.[1]
        ?.trim();
      const cleaned = (command ?? raw.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) return cleaned.slice(0, 80);
    }
    const leaf = (session?.cwd ?? browsingCwd).split('/').filter(Boolean).pop();
    return leaf || 'session';
  });

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
  /** Only drawn when the harness and the model both report an effort scale. */
  const showEffort = $derived(
    harnessReport?.capabilities.effort === true && hasEffortScale(chosenModel)
  );
  const effortStopsForModel = $derived(effortStops(chosenModel));

  // Populate the model list so the effort scale can be read even before the
  // picker is opened; a session with nothing to ask just leaves it empty.
  $effect(() => {
    ensureModels();
  });

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
      harness={session.harness}
      seed={session.cwd || viewId}
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
      {onmodel}
      {onpermission}
      {oneffort}
    />

    <div class="body">
      {#if view === 'flow'}
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

      <Composer
        bind:value={draft}
        busy={session.busy}
        {onsubmit}
        {onstop}
      >
        {#snippet prompts()}
          {#each parked as request (request.requestId)}
            <Prompt {request} {machineId} />
          {/each}
        {/snippet}
      </Composer>
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
</style>

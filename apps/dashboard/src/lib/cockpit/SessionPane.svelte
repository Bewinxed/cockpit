<script lang="ts">
  /**
   * One conversation, whole: the identity header, the transcript (Chat) or its
   * graph (Flow), and the floating composer with any parked permission or
   * question stacked above it. Held per open tab by the session layout, so its
   * scroll offset and half-typed message survive a switch — nothing here
   * unmounts on navigation.
   */
  import {
    cockpit,
    openSession,
    openTranscript,
    backfillSession,
    sendOrRevive,
    interrupt,
    loadMcpServers,
    type PendingPermission,
  } from './client.svelte';
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
    const first = session?.messages.find((m) => m.type === 'user' && m.content.trim());
    if (first) return first.content.split('\n')[0].slice(0, 80);
    const leaf = (session?.cwd ?? browsingCwd).split('/').filter(Boolean).pop();
    return leaf || 'session';
  });

  const stats = $derived(cockpit.statsOf(viewId));
  const activity = $derived(cockpit.activityOf(viewId));

  // A delegate's ask belongs to its parent, never the reader's queue.
  const parked = $derived<PendingPermission[]>(
    (session?.pending ?? []).filter((p) => !routedToParent(p))
  );

  let view = $state<'chat' | 'flow'>('chat');
  let draft = $state('');

  const flowSubagents = $derived(new Map(Object.entries(session?.subagents ?? {})));

  function onsubmit(text: string): void {
    if (!machineId) return;
    void sendOrRevive(viewId, machineId, text);
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
      mcpCount={session.mcp?.length ?? null}
      turns={stats.turns}
      totalTokens={stats.totalTokens}
      maxTokens={stats.maxTokens}
      cost={stats.cost}
      {view}
      onview={(v) => (view = v)}
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

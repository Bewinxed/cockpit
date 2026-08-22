<script lang="ts" module>
  /** Which session the board is peeking, and where a dive would land. */
  export interface PeekTarget {
    /** The id the store keys this session's view state under. */
    viewId: string;
    /** Where Enter and a double-click go. */
    href: string;
    /** Set when the row is a stored transcript rather than a live instance. */
    browsing?: { machineId: string; cwd: string };
  }
</script>

<script lang="ts">
  /**
   * The middle step of the board's loop: glance at the fleet, peek at one
   * session, dive into it. A peek answers "what is this one actually doing"
   * without leaving the board, so it shows the tail of the conversation rather
   * than the conversation — the last handful of turns, rendered flat, with the
   * live text still arriving. Anything that needs reading properly is a dive.
   *
   * It reads the same session state the route does and hydrates it the same
   * way, so peeking a session and then opening it costs one transcript read
   * between them, not two.
   */
  import { onMount, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { IconClose, IconExternal, IconFolderDuo, IconFork, IconStop } from '$lib/icons';
  import { smoothText } from '$lib/utils/smooth-text.svelte';
  import { getToolGlance } from '$lib/utils/tool-display';
  import { ACTIVITY_LABEL, SLEEPING_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import ContextMeter from './ContextMeter.svelte';
  import OsMark from './OsMark.svelte';
  import {
    backfillSession,
    cockpit,
    forkSession,
    isFailed,
    isResumable,
    openSession,
    openTranscript,
    permissionAnswer,
    refreshContext,
    resolvePermission,
    setPeeked,
    stopSession,
    type PendingPermission,
    type PermissionAnswer,
  } from './client.svelte';
  import { identityVar } from './folder-prefs.svelte';
  import { sessionTitle } from './links';
  import { machineLabel } from './machine';
  import { permissionSummary } from './permission-summary';
  import { questionsOf } from './question';
  import TaskPanel from './TaskPanel.svelte';
  import { refreshTasks, taskProgress, tasksOf } from './tasks.svelte';
  import type { Message } from './types';

  interface Props {
    /** The peeked row, or nothing while the board is only being glanced at. */
    target: PeekTarget | null;
    /** Puts the pane back to its resting state — the board keeps the selection. */
    onclose: () => void;
  }

  let { target, onclose }: Props = $props();

  // A peek is a live view, so it subscribes for frames exactly like an open tab
  // and unsubscribes the moment the pane rests again.
  $effect(() => {
    setPeeked(target?.viewId ?? null);
  });

  // Opening writes to the store, so it stays in an effect and the reads below
  // stay derived — the route's bargain, for the same reason: the fields this
  // writes are ones the store reads back, and tracking them would loop.
  $effect(() => {
    const next = target;
    if (!next) return;
    untrack(() => {
      if (next.browsing) {
        void openTranscript({
          viewId: next.viewId,
          machineId: next.browsing.machineId,
          sessionId: next.viewId,
          cwd: next.browsing.cwd,
          harness: cockpit.session(next.viewId)?.harness ?? 'claude',
        });
      } else {
        openSession(next.viewId);
      }
      // A peek is the one moment a stopped or stored session is looked at, and
      // no frame is coming to say its plan moved while nobody was watching.
      refreshTasks(next.viewId);
    });
  });

  // A live session the board never opened has already said everything it has
  // said, and frames only carry what comes next — so the tail is empty until
  // the transcript is read back. Re-arms on `sessionId`, which arrives late.
  $effect(() => {
    const id = target?.viewId;
    if (!id || target?.browsing || !cockpit.session(id)?.sessionId) return;
    untrack(() => void backfillSession(id));
  });

  const session = $derived(target ? cockpit.session(target.viewId) : null);
  const row = $derived(
    target ? (cockpit.instances.find((instance) => instance.id === target.viewId) ?? null) : null
  );

  const failed = $derived(row ? isFailed(row) : false);
  const sleeping = $derived(row ? isResumable(row) : false);
  const running = $derived(row?.status === 'running' || row?.status === 'starting');
  const activity = $derived(target ? cockpit.activityOf(target.viewId) : 'idle');
  const stateLabel = $derived(
    failed ? 'Failed' : sleeping ? SLEEPING_LABEL : ACTIVITY_LABEL[activity]
  );
  const tool = $derived(target ? cockpit.currentToolOf(target.viewId) : null);

  /** What the session is about, from the SDK's own title for its transcript. */
  const title = $derived.by(() => {
    const machineId = session?.machineId || target?.browsing?.machineId;
    const sessionId = target?.browsing ? target.viewId : (session?.sessionId ?? null);
    const info =
      sessionId && machineId
        ? cockpit.catalogOf(machineId).find((entry) => entry.sessionId === sessionId)
        : undefined;
    return info ? sessionTitle(info) : 'untitled session';
  });

  const machine = $derived.by(() => {
    const machineId = session?.machineId || target?.browsing?.machineId || '';
    return cockpit.machines.find((entry) => entry.machineId === machineId) ?? null;
  });

  const host = $derived(
    machine
      ? machineLabel(machine.hostname)
      : session?.machineId || target?.browsing?.machineId || ''
  );

  const cwd = $derived(session?.cwd || target?.browsing?.cwd || '');

  /** The SDK session a fork branches from: the stored one, or the live one's. */
  const forkable = $derived(target?.browsing ? target.viewId : (session?.sessionId ?? null));

  async function fork() {
    if (!forkable || !machine) return;
    const instanceId = forkSession({
      machineId: machine.machineId,
      cwd,
      sessionId: forkable,
      harness: session?.harness ?? 'claude',
      history: session?.messages ?? [],
    });
    await goto(`/session/${instanceId}`);
  }

  /**
   * A permission parked by a process that has since died cannot be answered —
   * the reply reaches a daemon with no such session. A dead one shows none.
   */
  const answerable = $derived.by((): PendingPermission[] => {
    if (!row || !running) return [];
    return session?.pending ?? [];
  });

  // Only a live session has a window to report on, and only one that has been
  // asked has a number; asking once per peek is what makes the meter say
  // something rather than sit at a dash.
  $effect(() => {
    const id = target?.viewId;
    const machineId = session?.machineId;
    if (!id || !machineId || !running) return;
    untrack(() => void refreshContext(id, machineId));
  });

  const plan = $derived(target ? tasksOf(target.viewId) : null);
  const progress = $derived(plan && plan.tasks.length > 0 ? taskProgress(plan) : null);

  /** How much conversation a peek is: enough to see what it is up to. */
  const TAIL = 10;

  /** What a tail says. The rest is chrome the transcript renders and this does not. */
  const SPOKEN = new Set<Message['type']>([
    'user',
    'user.peer',
    'assistant',
    'tool.use',
    'tool.handoff',
    'result.error',
  ]);

  const tail = $derived(
    (session?.messages ?? [])
      .filter((message) => SPOKEN.has(message.type) && message.content.trim().length > 0)
      .slice(-TAIL)
  );

  const stream = smoothText(() => session?.streaming ?? '');

  const glanceOf = (message: Message): string =>
    getToolGlance(message.metadata?.toolInput as Record<string, unknown> | undefined);

  function answer(request: PendingPermission, kind: PermissionAnswer): void {
    if (!session) return;
    resolvePermission(
      session.instanceId,
      session.machineId,
      request.requestId,
      permissionAnswer(request, kind)
    );
  }

  let tailEl = $state<HTMLDivElement | null>(null);

  // The tail grows by whole turns and by streamed characters, and follows
  // either: what a peek is for is the last thing said, not the first.
  $effect(() => {
    if (!tailEl || tail.length + stream.text.length === 0) return;
    tailEl.scrollTop = tailEl.scrollHeight;
  });

  // The pane crossfades between sessions, but it does not announce itself on
  // arrival — the board it sits beside did not either.
  let painted = $state(false);
  onMount(() => void (painted = true));
</script>

<!-- The card is the session, not the column: with nothing peeked there is
     nothing for a surface to hold, and a card-sized blank reads as a pane that
     failed to load rather than one waiting to be used. -->
<div
  class="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)]
    transition-[background-color,box-shadow] duration-200 ease-out {target
    ? 'bg-card shadow-md'
    : ''}"
>
  <!-- One cell, two occupants while the swap runs: the outgoing session fades
       under the incoming one instead of the pane jumping to a new height. -->
  <div class="grid min-h-0 flex-1">
    {#key target?.viewId ?? ''}
      <div
        class="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col"
        in:fade={{ duration: painted ? 180 : 0 }}
        out:fade={{ duration: painted ? 140 : 0 }}
      >
        {#if !target}
          <p class="m-auto max-w-[28ch] px-6 text-center text-caption">
            Pick a session to see what it is doing. Enter or a double-click opens it.
          </p>
        {:else}
          <ContextMenu.Root>
            <ContextMenu.Trigger class="contents">
              <header class="flex items-start gap-2 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <h2 class="flex min-w-0 items-center gap-2 text-body font-semibold">
                    <!-- The directory's hue, the same one the card it was
                         picked from wears: the peek belongs to a project. -->
                    {#if cwd}
                      <IconFolderDuo class="identity-ink size-4 shrink-0" style={identityVar(cwd)} />
                    {/if}
                    <span class="truncate">{title}</span>
                  </h2>
                  <p class="flex items-baseline gap-2 text-micro text-muted-foreground">
                    <span class="flex shrink-0 items-center gap-1.5">
                      {#if machine}
                        <OsMark os={machine.os} class="size-3.5" />
                      {/if}
                      {host}
                    </span>
                    {#if cwd}
                      <!-- Truncated from the left, as every path in the app is: the
                           leaf is what tells two checkouts apart. -->
                      <span class="min-w-0 truncate font-mono [direction:rtl]" title={cwd}>
                        <bdi>{cwd}</bdi>
                      </span>
                    {/if}
                  </p>
                </div>
                <Button size="sm" variant="ghost" href={target.href} class="-mr-1.5 shrink-0">
                  Open
                </Button>
              </header>
            </ContextMenu.Trigger>

            <ContextMenu.Content>
              <ContextMenu.Item onSelect={() => goto(target.href)}>
                <IconExternal />
                Open
              </ContextMenu.Item>
              <ContextMenu.Item disabled={!forkable || !machine} onSelect={fork}>
                <IconFork />
                Fork
              </ContextMenu.Item>
              {#if running && row}
                <ContextMenu.Item onSelect={() => stopSession(row.id, row.machineId)}>
                  <IconStop />
                  Stop
                </ContextMenu.Item>
              {/if}
              <ContextMenu.Separator />
              <ContextMenu.Item onSelect={onclose}>
                <IconClose />
                Close peek
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>

          <div class="flex items-center gap-2 px-4 pb-3 text-micro">
            {#if failed}
              <span class="size-2 shrink-0 rounded-full bg-error"></span>
            {:else if sleeping}
              <span class="size-2 shrink-0 rounded-full bg-muted-foreground/40"></span>
            {:else}
              <ActivityDot {activity} />
            {/if}
            <span
              class="shrink-0 {failed || activity === 'blocked'
                ? 'font-medium text-error'
                : 'text-muted-foreground'}">{stateLabel}</span
            >
            {#if activity === 'working' && tool}
              <span class="flex min-w-0 items-baseline gap-1.5 text-muted-foreground">
                <span class="shrink-0">{tool.name}</span>
                <span class="shrink-0">·</span>
                <span class="truncate font-mono">{tool.glance}</span>
              </span>
            {/if}
            {#if running}
              <span class="ml-auto flex shrink-0 items-center gap-1">
                <ContextMeter
                  usage={session?.context ?? null}
                  status={session?.sdkStatus ?? null}
                  compaction={session?.lastCompaction ?? null}
                  onrefresh={() =>
                    session && void refreshContext(session.instanceId, session.machineId)}
                />
              </span>
            {/if}
          </div>

          <!-- What the session is parked on comes before what it was saying:
               the tail scrolls, and this must not be somewhere in it. -->
          {#each answerable as request (request.requestId)}
            {@const question = Boolean(questionsOf(request.toolName, request.input))}
            <div class="flex flex-col gap-2 border-t border-border/50 bg-error/10 px-4 py-3">
              <p class="text-body">
                {question ? 'asked a question' : permissionSummary(request.toolName, request.input)}
              </p>
              <div class="flex items-center justify-end gap-1.5">
                {#if question}
                  <!-- A question wants a real choice, which is made on its own
                       card in the session — never guessed at from out here. -->
                  <Button size="sm" href={target.href}>Answer</Button>
                {:else}
                  <Button size="sm" onclick={() => answer(request, 'allow')}>Allow</Button>
                  <Button size="sm" variant="ghost" onclick={() => answer(request, 'deny')}>
                    Deny
                  </Button>
                {/if}
              </div>
            </div>
          {/each}

          {#if failed}
            <p class="border-t border-border/50 bg-error/10 px-4 py-3 text-caption text-error">
              {row?.lastError || 'Failed without saying why.'}
            </p>
          {/if}

          <!-- What it set out to do, before what it last said about doing it.
               Capped, because a peek is a glance — a forty-task plan scrolls
               inside its own section rather than pushing the tail off. -->
          {#if progress}
            <div class="flex flex-col border-t border-border/50 pb-2">
              <p class="px-4 pt-3 pb-1 text-caption">
                Tasks · {progress.done} of {progress.total}
              </p>
              <div class="max-h-48 overflow-y-auto px-2">
                <TaskPanel viewId={target.viewId} dense />
              </div>
            </div>
          {/if}

          <div
            bind:this={tailEl}
            class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-border/50 px-4 py-3"
          >
            {#if session?.loading && tail.length === 0}
              <p class="text-caption">Reading…</p>
            {:else if tail.length === 0 && !session?.streaming}
              <p class="text-caption">Nothing said yet.</p>
            {:else}
              {#each tail as message, index (message.id ?? index)}
                {#if message.type === 'tool.use' || message.type === 'tool.handoff'}
                  <p class="flex items-baseline gap-1.5 text-micro text-muted-foreground">
                    <span class="shrink-0">{message.metadata?.toolName ?? message.content}</span>
                    {#if glanceOf(message)}
                      <span class="shrink-0">·</span>
                      <span class="truncate font-mono">{glanceOf(message)}</span>
                    {/if}
                  </p>
                {:else if message.type === 'user' || message.type === 'user.peer'}
                  <!-- The one voice worth tinting: what the session was asked. -->
                  <p
                    class="line-clamp-4 rounded-[var(--radius-card)] bg-primary/10 px-3 py-2 text-body break-words whitespace-pre-wrap"
                  >
                    {message.content}
                  </p>
                {:else if message.type === 'result.error'}
                  <p class="line-clamp-3 text-body break-words text-error">{message.content}</p>
                {:else}
                  <p class="line-clamp-6 text-body break-words whitespace-pre-wrap">{message.content}</p>
                {/if}
              {/each}
              {#if session?.streaming}
                <p class="text-body break-words whitespace-pre-wrap">
                  {stream.text}<span
                    class="inline-block h-4 w-[3px] animate-pulse rounded-[var(--radius-mark)] bg-primary/60 align-text-bottom"
                  ></span>
                </p>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/key}
  </div>
</div>

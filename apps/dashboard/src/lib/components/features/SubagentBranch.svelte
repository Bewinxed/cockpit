<script lang="ts">
  /**
   * One subagent's whole run, folded out of the main transcript into a branch
   * the reader opens on purpose (NEW.md §1). Collapsed it answers "what is it
   * doing"; expanded it is the same renderers the main thread uses.
   */
  import { IconChevronRight, IconSuccess, IconError, IconSpinner, IconSkill } from '$lib/icons';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { branchActivity } from '$lib/cockpit/frames';
  import { modelLabel } from '$lib/cockpit/models.svelte';
  import type { Message } from '$lib/cockpit/types';
  import type { SubagentState } from '$lib/utils/flow-types';
  import ChatMessage from './ChatMessage.svelte';
  import { standsAlone } from './message-renderers';
  import ToolGroup from './ToolGroup.svelte';

  interface Props {
    branch: SubagentState;
    /** The Task tool.use that spawned it, for the input the user approved. */
    spawn: Message;
  }

  let { branch, spawn }: Props = $props();

  let open = $state(false);

  /**
   * The rail links straight at one branch (`#subagent-<toolUseId>`), but the
   * card it lands on is collapsed — so following the link appeared to do
   * nothing at all. Opening on the hash is what makes that link mean "show me
   * this subagent's transcript" rather than "go to the session it is in".
   */
  const anchor = $derived(`#subagent-${branch.toolUseId}`);
  function openIfTargeted() {
    if (typeof location === 'undefined' || location.hash !== anchor) return;
    open = true;
    // The transcript is virtualised, so the browser's own jump can land on a
    // node that does not exist yet; scroll once the card is actually here.
    void tick().then(() => {
      document.getElementById(`subagent-${branch.toolUseId}`)?.scrollIntoView({ block: 'center' });
    });
  }
  onMount(openIfTargeted);

  const running = $derived(branch.status === 'starting' || branch.status === 'running');
  const activity = $derived(branchActivity(branch));

  /**
   * How long it has been going, ticking while it runs and frozen once it stops.
   * A spinner says "something is happening"; it does not say whether that has
   * been true for four seconds or forty minutes, which is the difference
   * between waiting and going to look.
   */
  let now = $state(Date.now());
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const elapsed = $derived.by(() => {
    const started = branch.startedAt?.getTime();
    if (!started) return '';
    const end = running ? now : (branch.completedAt?.getTime() ?? now);
    const seconds = Math.max(0, Math.round((end - started) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  });

  /** What it is doing, without the clock — this is what the swap animates on. */
  const statusLine = $derived.by(() => {
    if (branch.status === 'error') return branch.error ? `Failed · ${branch.error}` : 'Failed';
    if (branch.status === 'complete') return 'Done';
    if (branch.status === 'starting') return 'Starting…';
    return activity || 'Working';
  });

  /**
   * The clock is deliberately *not* part of what the swap keys on. Fold the
   * seconds into that string and the line re-animates once a second forever —
   * a card that flickers is worse than one that says nothing. The phase changes
   * rarely and animates; the duration ticks in place beside it.
   */
  const showsClock = $derived(Boolean(elapsed) && branch.status !== 'starting');
  const label = $derived(branch.subagentType || spawn.metadata?.subagentType || 'subagent');
  const description = $derived(branch.description || spawn.metadata?.subagentDescription);
  const model = $derived(branch.model ?? spawn.metadata?.subagentModel);

  // Grouped the way the main thread groups it, standalone renderers included:
  // a subagent writing the plan down reads as a line here too.
  const isTool = (message: Message) =>
    (message.type === 'tool.use' || message.type === 'tool.result') && !standsAlone(message);

  // The branch's own transcript, grouped the way the main thread groups it.
  const groups = $derived.by(() => {
    const result: Array<
      { kind: 'single'; message: Message } | { kind: 'tools'; messages: Message[]; at: number }
    > = [];
    let i = 0;
    while (i < branch.messages.length) {
      if (!isTool(branch.messages[i])) {
        result.push({ kind: 'single', message: branch.messages[i] });
        i++;
        continue;
      }
      const at = i;
      const tools: Message[] = [];
      while (i < branch.messages.length && isTool(branch.messages[i])) {
        tools.push(branch.messages[i]);
        i++;
      }
      result.push({ kind: 'tools', messages: tools, at });
    }
    return result;
  });
</script>

<div class="w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
  <Collapsible.Root {open} onOpenChange={() => (open = !open)}>
    <Collapsible.Trigger class="w-full text-left">
      <div class="flex cursor-pointer items-start gap-2 px-3 py-2.5 transition-colors hover:bg-muted/30">
        <IconChevronRight
          class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 {open
            ? 'rotate-90'
            : ''}"
        />

        <div
          class="flex size-6 shrink-0 items-center justify-center rounded-md
            {branch.status === 'error' ? 'bg-destructive/10 text-destructive' : running ? 'bg-primary/10 text-primary' : 'bg-success/10'}"
        >
          <IconSkill
            class="size-3.5 {branch.status === 'error'
              ? 'text-destructive'
              : running
                ? 'text-primary'
                : 'text-success'}"
          />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-foreground">{label}</span>
            {#if model}
              <span class="shrink-0 font-mono text-xs text-muted-foreground/70">{modelLabel(model)}</span>
            {/if}
            {#if description}
              <span class="truncate text-xs text-muted-foreground">{description}</span>
            {/if}
          </div>
          <!-- Swapped rather than rewritten in place: a line that changes
               silently is a line nobody notices changing, and "what is it doing
               now" is the only question this card exists to answer. The old
               state leaves upward as the new one arrives from below, both
               blurred through the crossing, so the eye follows the change
               instead of re-reading the row. -->
          <div class="mt-1 flex items-baseline gap-1.5 text-xs">
            <span class="relative block h-4 min-w-0 flex-1 overflow-hidden">
              {#key statusLine}
                <span
                  class="absolute inset-x-0 block truncate {branch.status === 'error'
                    ? 'text-destructive'
                    : running
                      ? 'text-muted-foreground'
                      : 'text-success'}"
                  in:fly={{ y: 8, duration: 200, easing: quintOut }}
                  out:fly={{ y: -8, duration: 150, easing: quintOut }}
                >
                  {statusLine}
                </span>
              {/key}
            </span>
            {#if showsClock}
              <span class="shrink-0 tabular-nums text-muted-foreground/70">{elapsed}</span>
            {/if}
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          {#if branch.messages.length > 0}
            <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {branch.messages.length}
            </span>
          {/if}
          {#if branch.status === 'error'}
            <IconError class="size-4 text-destructive" />
          {:else if running}
            <IconSpinner class="size-4 animate-spin text-primary" />
          {:else}
            <IconSuccess class="size-4 text-success" />
          {/if}
        </div>
      </div>
    </Collapsible.Trigger>

    <Collapsible.Content>
      <div class="ml-[22px] space-y-3 border-t border-l border-border py-3 pr-3 pl-4">
        {#each groups as group (group.kind === 'tools' ? `tools-${group.at}` : group.message.id)}
          {#if group.kind === 'tools'}
            <ToolGroup tools={group.messages} />
          {:else}
            <ChatMessage message={group.message} instanceId={branch.instanceId} />
          {/if}
        {:else}
          <p class="text-xs text-muted-foreground">No messages forwarded yet.</p>
        {/each}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</div>

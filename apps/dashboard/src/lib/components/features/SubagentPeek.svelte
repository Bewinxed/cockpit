<script lang="ts">
  /**
   * The subagent equivalent of PeekPane: a popover anchored to a sidebar row
   * that answers "what did this subagent actually do" without leaving the rail.
   * Header shows state, body shows the tail of the branch transcript (or the
   * report when done), and a dive affordance opens the full card in the session.
   */
  import { IconExternal, IconSuccess, IconError, IconSpinner, IconSkill } from '$lib/icons';
  import { Markdown } from '$lib/components/ui/markdown';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
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
    instanceId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The trigger content, receiving popover props to spread onto the anchor. */
    children: import('svelte').Snippet<[{ props: Record<string, unknown> }]>;
  }

  let { branch, instanceId, open, onOpenChange, children }: Props = $props();

  const running = $derived(branch.status === 'starting' || branch.status === 'running');
  const settled = $derived(branch.status === 'complete' || branch.status === 'error');
  const activity = $derived(branchActivity(branch));

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

  const statusLine = $derived.by(() => {
    if (branch.status === 'error') return branch.error ? `Failed · ${branch.error}` : 'Failed';
    if (branch.status === 'complete') return 'Done';
    if (branch.status === 'starting') return 'Starting…';
    return activity || 'Working';
  });

  const showsClock = $derived(Boolean(elapsed) && branch.status !== 'starting');
  const realType = $derived(branch.subagentType !== 'subagent' ? branch.subagentType : '');
  const label = $derived(realType || branch.subagentType);
  const description = $derived(branch.description);
  const model = $derived(branch.model);
  const hasMessages = $derived(branch.messages.length > 0);
  const hasResult = $derived(Boolean(branch.result));

  const TAIL = 8;

  const isTool = (message: Message) =>
    (message.type === 'tool.use' || message.type === 'tool.result') && !standsAlone(message);

  const tail = $derived.by(() => {
    const messages = branch.messages.slice(-TAIL * 3);
    const result: Array<
      { kind: 'single'; message: Message } | { kind: 'tools'; messages: Message[]; at: number }
    > = [];
    let i = 0;
    while (i < messages.length) {
      if (!isTool(messages[i])) {
        result.push({ kind: 'single', message: messages[i] });
        i++;
        continue;
      }
      const at = i;
      const tools: Message[] = [];
      while (i < messages.length && isTool(messages[i])) {
        tools.push(messages[i]);
        i++;
      }
      result.push({ kind: 'tools', messages: tools, at });
    }
    return result.slice(-TAIL);
  });

  const diveHref = $derived(`/session/${instanceId}#subagent-${branch.toolUseId}`);

  let bodyEl = $state<HTMLElement | null>(null);

  // Follow the tail as new messages arrive, mirroring PeekPane.
  $effect(() => {
    if (!bodyEl || tail.length + (branch.streaming?.length ?? 0) === 0) return;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  });
</script>

<Popover.Root {open} {onOpenChange}>
  <Popover.Trigger>
    {#snippet child({ props })}
      {@render children({ props })}
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    side="right"
    align="start"
    sideOffset={8}
    class="w-96 max-h-[min(520px,80vh)] flex flex-col !p-0"
  >
    <!-- Header -->
    <header class="flex items-start gap-2 px-4 pt-3 pb-2">
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
          <span class="text-caption font-medium text-foreground">{label}</span>
          {#if model}
            <span class="shrink-0 font-mono text-micro text-faint">{modelLabel(model)}</span>
          {/if}
        </div>
        {#if description}
          <p class="mt-0.5 text-caption text-muted-foreground line-clamp-2">{description}</p>
        {/if}
        <div class="mt-1 flex items-baseline gap-1.5 text-micro">
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
            <span class="shrink-0 tabular-nums text-faint">{elapsed}</span>
          {/if}
          {#if branch.status === 'error'}
            <IconError class="size-4 shrink-0 text-destructive" />
          {:else if running}
            <IconSpinner class="size-4 shrink-0 animate-spin text-primary" />
          {:else}
            <IconSuccess class="size-4 shrink-0 text-success" />
          {/if}
        </div>
      </div>
    </header>

    <!-- Body -->
    <div
      bind:this={bodyEl}
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-border/50 px-4 py-3"
    >
      {#if hasMessages}
        {#each tail as group (group.kind === 'tools' ? `tools-${group.at}` : group.message.id)}
          {#if group.kind === 'tools'}
            <ToolGroup tools={group.messages} />
          {:else}
            <ChatMessage message={group.message} instanceId={branch.instanceId} />
          {/if}
        {/each}
      {/if}

      {#if branch.streaming}
        <div class="max-w-[min(65ch,100%)] min-w-0 text-body leading-relaxed text-foreground break-words">
          <Markdown source={branch.streaming} /><span class="inline-block w-[3px] h-4 rounded-sm bg-primary/60 align-text-bottom animate-pulse"></span>
        </div>
      {/if}

      {#if !hasMessages && !branch.streaming}
        {#if running}
          <p class="text-caption">Waiting for the first message…</p>
        {:else if settled && hasResult}
          <!-- Report section below covers this -->
        {:else if settled}
          <p class="text-caption">Transcript detail is only streamed live.</p>
        {/if}
      {/if}

      {#if settled && hasResult}
        <div class="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
          <span class="text-micro font-medium text-muted-foreground">Report</span>
          <div class="mt-1 max-w-[min(65ch,100%)] min-w-0 text-caption text-foreground break-words">
            <Markdown source={branch.result ?? ''} />
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer: dive affordance -->
    <div class="border-t border-border/50 px-3 py-2">
      <Button
        size="sm"
        variant="ghost"
        href={diveHref}
        class="w-full justify-start gap-2 text-micro text-muted-foreground"
        onclick={() => onOpenChange(false)}
      >
        <IconExternal class="size-3.5" />
        Open in session
      </Button>
    </div>
  </Popover.Content>
</Popover.Root>

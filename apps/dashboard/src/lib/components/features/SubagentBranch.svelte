<script lang="ts">
  /**
   * One subagent's whole run, folded out of the main transcript into a branch
   * the reader opens on purpose (NEW.md §1). Collapsed it answers "what is it
   * doing"; expanded it is the same renderers the main thread uses.
   */
  import { IconChevronRight, IconSuccess, IconError, IconSpinner, IconSkill } from '$lib/icons';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { Markdown } from '$lib/components/ui/markdown';
  import { onMount, tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { branchActivity } from '$lib/cockpit/frames';
  import { modelLabel } from '$lib/cockpit/models.svelte';
  import type { Message } from '$lib/cockpit/types';
  import type { SubagentState } from '$lib/utils/flow-types';
  import ChatMessage from './ChatMessage.svelte';
  import { standsAlone } from './message-renderers';
  import ToolGroup from './ToolGroup.svelte';
  import OutputBlock from './tool-cards/OutputBlock.svelte';

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
  onMount(() => {
    openIfTargeted();
    // A dive from the sidebar while this session is already showing changes
    // only the hash; without this the card stays closed because onMount has
    // already fired.
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  });

  const running = $derived(branch.status === 'starting' || branch.status === 'running');
  const settled = $derived(branch.status === 'complete' || branch.status === 'error');

  // Computed once at mount so the card only slides in when it is genuinely new,
  // not every time the virtualizer recycles its DOM node on scroll.
  const entering = untrack(() => branch.status === 'starting' || branch.status === 'running');

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

  const showsClock = $derived(Boolean(elapsed) && branch.status !== 'starting');

  // The label prefers the real type over the branchFor default of 'subagent'.
  const realType = $derived(
    branch.subagentType !== 'subagent' ? branch.subagentType : ''
  );
  const label = $derived(
    realType || spawn.metadata?.subagentType || branch.subagentType
  );
  const description = $derived(branch.description || spawn.metadata?.subagentDescription);
  const model = $derived(branch.model ?? spawn.metadata?.subagentModel);

  const hasMessages = $derived(branch.messages.length > 0);
  const hasResult = $derived(Boolean(branch.result));

  /**
   * Whether the final report reads as raw log output rather than prose. A real
   * subagent writes markdown; a tool task that surfaced as a branch dumps
   * `key=value` runs, timestamps and command echoes. Rendered as markdown, those
   * fold into an unreadable wall — so a log-shaped result goes to a mono `<pre>`
   * instead. Majority-of-lines log shapes, and no markdown tokens anywhere.
   */
  const MARKDOWN_SIGNAL =
    /(^|\n)\s{0,3}#{1,6}\s|```|\*\*|__|\[[^\]]+\]\([^)]*\)|(^|\n)\s*[-*+]\s+/;
  const LOG_LINE =
    /^\S+=\S+(\s+\S+=\S+)*$|^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\d{2}:\d{2}:\d{2}|^[\[(]\d{4}-\d{2}-\d{2}|^[$>→]\s|^\[?(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\]?\b/i;
  const reportIsLog = $derived.by(() => {
    const text = branch.result ?? '';
    if (!text || MARKDOWN_SIGNAL.test(text)) return false;
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    const logLines = lines.filter((line) => LOG_LINE.test(line));
    return logLines.length >= lines.length * 0.6;
  });

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

<div
  class="w-full overflow-hidden rounded-xl bg-card shadow-sm motion-reduce:transition-none"
  in:fly={{ y: entering ? 10 : 0, duration: entering ? 250 : 0, easing: quintOut }}
>
  <Collapsible.Root {open} onOpenChange={() => (open = !open)}>
    <Collapsible.Trigger class="group/branch w-full text-left">
      <div class="flex cursor-pointer items-start gap-2 px-4 py-3 transition-colors hover:bg-muted/30">
        <span class="relative size-6 shrink-0">
          <div
            class="flex size-6 shrink-0 items-center justify-center rounded-md transition-opacity duration-150 md:group-hover/branch:opacity-0 md:group-focus-within/branch:opacity-0
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
          <IconChevronRight
            class="absolute inset-0 m-auto size-4 text-muted-foreground opacity-0 transition-all duration-240 ease-expo md:group-hover/branch:opacity-100 md:group-focus-within/branch:opacity-100 {open
              ? 'rotate-90'
              : ''}"
          />
        </span>

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
          <!-- Swapped rather than rewritten in place: a line that changes
               silently is a line nobody notices changing, and "what is it doing
               now" is the only question this card exists to answer. -->
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
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          {#if hasMessages}
            <span class="rounded-4xl bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
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
      <div class="space-y-3 border-t border-border/50 px-4 py-3 pl-[calc(1rem+22px)]">
        <!-- Live transcript messages -->
        {#each groups as group (group.kind === 'tools' ? `tools-${group.at}` : group.message.id)}
          {#if group.kind === 'tools'}
            <ToolGroup tools={group.messages} />
          {:else}
            <ChatMessage message={group.message} instanceId={branch.instanceId} />
          {/if}
        {/each}

        <!-- Live streaming buffer -->
        {#if branch.streaming}
          <div class="max-w-[min(65ch,100%)] min-w-0 text-body leading-relaxed text-foreground break-words">
            <Markdown source={branch.streaming} /><span class="inline-block w-[3px] h-4 rounded-sm bg-primary/60 align-text-bottom animate-pulse"></span>
          </div>
        {/if}

        <!-- Empty states and final report -->
        {#if !hasMessages && !branch.streaming}
          {#if running}
            <p class="text-caption">Waiting for the first message…</p>
          {:else if settled && hasResult}
            <!-- Done, no transcript, but a result was captured -->
          {:else if settled}
            <p class="text-caption">Transcript detail is only streamed live.</p>
          {/if}
        {/if}

        <!-- Final report: shown whenever the branch is done and has one -->
        {#if settled && hasResult}
          <div class="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
            <span class="text-micro font-medium text-muted-foreground">Report</span>
            {#if reportIsLog}
              <!-- A log dump, not prose: capped and scrollable, mono, line breaks
                   preserved, so the lines stay lines instead of a folded wall. -->
              <div class="mt-1.5">
                <OutputBlock text={branch.result ?? ''} />
              </div>
            {:else}
              <div
                class="mt-1 max-h-80 max-w-[min(65ch,100%)] min-w-0 overflow-y-auto text-caption text-foreground break-words"
              >
                <Markdown source={branch.result ?? ''} />
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</div>

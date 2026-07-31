<script lang="ts">
  /**
   * One subagent's whole run, folded out of the main transcript into a branch
   * the reader opens on purpose (NEW.md §1). Collapsed it answers "what is it
   * doing"; expanded it is the same renderers the main thread uses.
   */
  import { IconChevronRight, IconSuccess, IconError, IconSpinner, IconSkill } from '$lib/icons';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { branchActivity } from '$lib/cockpit/frames';
  import type { Message } from '$lib/cockpit/types';
  import type { SubagentState } from '$lib/utils/flow-types';
  import ChatMessage from './ChatMessage.svelte';
  import ToolGroup from './ToolGroup.svelte';

  interface Props {
    branch: SubagentState;
    /** The Task tool.use that spawned it, for the input the user approved. */
    spawn: Message;
  }

  let { branch, spawn }: Props = $props();

  let open = $state(false);

  const running = $derived(branch.status === 'starting' || branch.status === 'running');
  const activity = $derived(branchActivity(branch));
  const label = $derived(branch.subagentType || spawn.metadata?.subagentType || 'subagent');
  const description = $derived(branch.description || spawn.metadata?.subagentDescription);

  const isTool = (message: Message) => message.type === 'tool.use' || message.type === 'tool.result';

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
            {branch.status === 'error' ? 'bg-destructive text-destructive-foreground/10' : running ? 'bg-primary text-primary-foreground/10' : 'bg-success/10'}"
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
            {#if description}
              <span class="truncate text-xs text-muted-foreground">{description}</span>
            {/if}
          </div>
          {#if activity}
            <div class="mt-1 truncate text-xs text-muted-foreground/70">{activity}</div>
          {/if}
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          {#if branch.messages.length > 0}
            <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
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
      <div class="ml-[22px] space-y-3 border-t border-l-2 border-border/50 py-3 pr-3 pl-4">
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

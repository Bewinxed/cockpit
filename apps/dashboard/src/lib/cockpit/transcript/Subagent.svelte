<script lang="ts">
  /**
   * A subagent (a delegate is a separate session, folded here as a branch) on
   * the rail — a fold, not a box. The head names it and its harness/steps; the
   * body carries its present-tense line or its final report. Ported from the
   * mock's `.branch`.
   */
  import type { Message } from '../types';
  import type { SubagentState } from '$lib/utils/flow-types';
  import { IconSubagent } from '$lib/icons';
  import { formatDuration } from '$lib/utils/time';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import MessageBody from './MessageBody.svelte';

  let { branch, spawn }: { branch: SubagentState; spawn: Message } = $props();

  const steps = $derived(branch.messages.filter((m) => m.type === 'tool.use').length);
  const running = $derived(branch.status === 'running' || branch.status === 'starting');
  const elapsed = $derived(
    formatDuration(
      (branch.completedAt?.getTime() ?? Date.now()) - branch.startedAt.getTime()
    )
  );

  const title = $derived(
    branch.description || spawn.metadata?.subagentDescription || branch.subagentType
  );
  const body = $derived(branch.error || branch.result || branch.summary || branch.streaming);
</script>

<div class="branch">
  <Collapsible.Root>
    <Collapsible.Trigger class="bhead">
      <span class="tag"><IconSubagent />subagent</span>
      <span class="tk">{title}</span>
      <span class="arg">{branch.model ?? branch.subagentType}{#if steps} · {steps} step{steps === 1 ? '' : 's'}{/if}</span>
      <span class="t" class:live={running}>{running ? 'running' : elapsed}</span>
    </Collapsible.Trigger>
    {#if body}
      <p class="bmsg" class:err={!!branch.error}>{body}</p>
    {/if}
    <Collapsible.Content>
      <div class="inner">
        {#each branch.messages as m (m.id ?? m.sdkUuid)}
          {#if m.type === 'assistant' && m.content.trim()}
            <MessageBody source={m.content} />
          {/if}
        {/each}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</div>

<style>
  .branch {
    margin: 6px 0 0 7px;
    padding-left: 12px;
    background: var(--rail) left top / 2px 100% no-repeat;
  }
  :global(.branch .bhead) {
    min-height: 26px;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--accent-text);
    background: var(--accent-bg-subtle);
    border-radius: var(--radius-mark);
    padding: 2px 7px;
    flex: 0 0 auto;
  }
  .tag :global(svg) {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }
  .tk {
    font-family: var(--font-mono);
    color: var(--ink-strong);
    font-size: var(--text-sm);
    flex: 0 0 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }
  .arg {
    color: var(--ink-muted);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 auto;
  }
  .t {
    margin-left: auto;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
    font-size: var(--text-sm);
  }
  .t.live {
    color: var(--status-live-ink);
  }
  .bmsg {
    margin: 2px 0 0 22px;
    font-size: var(--text-sm);
    color: var(--ink-body);
    max-width: 68ch;
  }
  .bmsg.err {
    color: var(--status-fail-ink);
  }
  .inner {
    margin: 4px 0 0 22px;
  }
</style>

<script lang="ts">
  /**
   * The quiet ledger's non-turn lines: a command's output in a recessed well, a
   * system note folded on the rail, and a failure or refusal as a named card
   * with its handoff. Everything the transcript carries that is neither a turn
   * nor a tool call lands here.
   */
  import type { Message } from '../types';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { IconInfo, IconChevronRight } from '$lib/icons';

  let { message }: { message: Message } = $props();

  const type = $derived(message.type);
  const isOutput = $derived(type === 'ui.command_output');
  const isFail = $derived(
    type === 'ui.error' || type === 'ui.session_error' || type === 'result.error'
  );
  const isDelegateAsk = $derived(type === 'user.delegate_ask');
  const title = $derived(
    message.metadata?.errorTitle ?? message.metadata?.noteTitle ?? 'Note'
  );
</script>

{#if isOutput}
  <pre class="well">{message.content}</pre>
{:else if isFail}
  <div class="failcard">
    <b>{title}</b>
    <span class="handoff">{message.content}</span>
  </div>
{:else if isDelegateAsk}
  <div class="note">
    <span class="tag"><IconInfo /> {message.metadata?.askLabel ?? 'delegate'}</span>
    <span class="body">{message.content}</span>
  </div>
{:else}
  <div class="note fold">
    <Collapsible.Root>
      <Collapsible.Trigger class="ftrig">
        <IconChevronRight />
        <span class="ftitle">{message.content || title}</span>
      </Collapsible.Trigger>
      {#if message.metadata?.command}
        <Collapsible.Content>
          <pre class="well">{message.metadata.command}</pre>
        </Collapsible.Content>
      {/if}
    </Collapsible.Root>
  </div>
{/if}

<style>
  .well {
    background: var(--surface-sunken);
    border-radius: var(--radius-well);
    padding: var(--space-3);
    margin: var(--space-4) 0 0 var(--space-2);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    color: var(--ink-strong);
    white-space: pre-wrap;
  }
  .failcard {
    border-left: 3px solid var(--status-fail-ink);
    background: var(--status-fail-bg);
    color: var(--status-fail-ink);
    border-radius: var(--radius-control);
    padding: var(--space-3);
    margin: var(--space-4) 0 0;
  }
  .failcard b {
    display: block;
    font-weight: var(--weight-strong);
    margin-bottom: 2px;
  }
  .failcard .handoff {
    font-size: var(--text-sm);
    opacity: 0.92;
    white-space: pre-wrap;
  }
  .note {
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
    background: var(--rail) left top / 2px 100% no-repeat;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .note .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent-text);
    margin-right: var(--space-2);
  }
  .note :global(svg) {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }
  :global(.note .ftrig) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: 0;
    padding: 0;
    color: var(--ink-muted);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
  }
  .ftitle {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

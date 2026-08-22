<script lang="ts">
  /**
   * A run of tool calls as rail-led rows — never a nested card. The rail is a
   * 2px stripe; each row is a glyph, the verb, a mono argument, and whatever the
   * call measured out (`+14 −6`, `3 files`). Ported from the mock's `.tools` /
   * `.trow`.
   */
  import type { Message } from '../types';
  import { describeTool, type ToolDescriptor, type ToolStatus } from '$lib/components/features/tool-cards/descriptors';
  import { Badge } from '$lib/components/ui/badge';

  let { messages }: { messages: Message[] } = $props();

  /** shadcn Badge, dressed on the DESIGN.md scale rather than the stock ladder. */
  const chipClass =
    'h-auto rounded-[var(--radius-mark)] border-transparent bg-[var(--surface-sunken)] ' +
    'px-[var(--space-2)] py-px text-[length:var(--text-xs)] font-[var(--weight-body)] ' +
    'text-[color:var(--ink-muted)]';

  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;

  function describe(m: Message): ToolDescriptor {
    const meta = m.metadata ?? {};
    return describeTool(
      meta.toolName,
      (meta.toolInput ?? undefined) as Record<string, unknown> | undefined,
      asString(meta.toolResult),
      (meta.toolStatus ?? 'pending') as ToolStatus
    );
  }
</script>

<div class="tools">
  {#each messages as m (m.id ?? m.toolCallId)}
    {@const d = describe(m)}
    {@const Icon = d.icon}
    <div class="trow">
      <span class="ic"><Icon /></span>
      {#if d.label}<span class="tk">{d.label}</span>{/if}
      <span class="arg" title={[d.object, d.detail].filter(Boolean).join(' ') || undefined}>
        {#if d.object}{d.object}{/if}{#if d.detail}<span class="tail"> {d.detail}</span>{/if}
      </span>
      {#if d.chip}<Badge variant="secondary" class={chipClass}>{d.chip}</Badge>{/if}
      {#if d.fact}<span class="d" class:bad={d.factTone === 'error'}>{d.fact}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .tools {
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
    background: var(--rail) left top / 2px 100% no-repeat;
  }
  .trow {
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--ink-body);
  }
  .ic {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    color: var(--ink-muted);
  }
  .ic :global(svg) {
    width: 15px;
    height: 15px;
    display: block;
  }
  .tk {
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
    font-size: var(--text-sm);
    flex: 0 0 auto;
  }
  .arg {
    font-family: var(--font-mono);
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 auto;
  }
  .tail {
    color: var(--ink-muted);
    opacity: 0.7;
  }
  .trow :global([data-slot='badge']) {
    flex: 0 0 auto;
  }
  .d {
    color: var(--data-ok);
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
  }
  .d.bad {
    color: var(--data-bad);
  }
  @media (max-width: 900px) {
    .tools {
      margin-left: 0;
    }
  }
  @media (pointer: coarse) {
    .trow {
      min-height: 44px;
    }
  }
</style>

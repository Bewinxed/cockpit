<script lang="ts">
  /**
   * A run of tool calls as rail-led rows — never a nested card. The rail is a
   * 2px stripe; each row is a glyph, the verb, a mono argument, and whatever the
   * call measured out (`+14 −6`, `3 files`). Ported from the mock's `.tools` /
   * `.trow`.
   *
   * A one-line summary is not a record of what a tool did: the input it ran on
   * and the result it came back with live in the message metadata and were,
   * until now, unreachable. Every row that carries either opens — same anatomy
   * as Prompt.svelte's "What this touches" disclosure, so the two surfaces read
   * as one idea.
   */
  import type { Message } from '../types';
  import { describeTool, type ToolDescriptor, type ToolStatus } from '$lib/components/features/tool-cards/descriptors';
  import { Badge } from '$lib/components/ui/badge';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { IconChevronRight } from '$lib/icons';

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

  /* A result can be a megabyte of build log. The row shows the head of it and
     says how much it is not showing, rather than handing the virtualizer a row
     the height of a city block. */
  const RESULT_CAP = 20_000;

  interface Field {
    key: string;
    text: string;
  }

  const asText = (value: unknown): string =>
    typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value));

  function inputFields(raw: unknown): Field[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
      key,
      text: asText(value),
    }));
  }

  function resultText(raw: unknown): { text: string; more: number } | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = asText(raw);
    if (!text.trim()) return undefined;
    return text.length > RESULT_CAP
      ? { text: text.slice(0, RESULT_CAP), more: text.length - RESULT_CAP }
      : { text, more: 0 };
  }

  /* A diff fact is one string carrying two opposite meanings — `+14 −6` from an
     edit, a lone `+38` from a write. The descriptor's own `diff` tone is what
     licenses the coloring, not the shape of the string, so both rows agree on
     what green means: added. Whitespace is kept as its own token so the fact
     reads exactly as the descriptor wrote it. */
  type FactPart = { text: string; add: boolean; del: boolean };

  const ADDED = /^\+\d[\d,._]*$/;
  const REMOVED = /^[−-]\d[\d,._]*$/;

  const factParts = (fact: string): FactPart[] =>
    fact
      .split(/(\s+)/)
      .filter((token) => token !== '')
      .map((token) => ({ text: token, add: ADDED.test(token), del: REMOVED.test(token) }));
</script>

<div class="tools">
  {#each messages as m (m.id ?? m.toolCallId)}
    {@const d = describe(m)}
    {@const Icon = d.icon}
    {@const failed = m.metadata?.toolStatus === 'error'}
    {@const fields = inputFields(m.metadata?.toolInput)}
    {@const result = resultText(m.metadata?.toolResult)}
    {@const hasBody = fields.length > 0 || !!result}
    {#snippet line()}
      <span class="ic" class:err={failed}><Icon /></span>
      {#if d.label}<span class="tk">{d.label}</span>{/if}
      <span class="arg" title={[d.object, d.detail].filter(Boolean).join(' ') || undefined}>
        {#if d.object}{d.object}{/if}{#if d.detail}<span class="tail"> {d.detail}</span>{/if}
      </span>
      {#if d.chip}<Badge variant="secondary" class={chipClass}>{d.chip}</Badge>{/if}
      {#if d.fact}
        {#if d.factTone === 'diff'}
          <span class="d"
            >{#each factParts(d.fact) as part, i (i)}<span
              class:add={part.add}
              class:del={part.del}>{part.text}</span
            >{/each}</span
          >
        {:else}
          <span class="d" class:bad={d.factTone === 'error'}>{d.fact}</span>
        {/if}
      {/if}
    {/snippet}
    <div class="row" class:err={failed}>
      {#if hasBody}
        <Collapsible.Root>
          <Collapsible.Trigger class="trow">
            {@render line()}
            <span class="chev"><IconChevronRight /></span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div class="fields">
              {#each fields as f (f.key)}
                <div class="field">
                  <span class="k">{f.key}</span>
                  <pre class="v">{f.text}</pre>
                </div>
              {/each}
              {#if result}
                <div class="field">
                  <span class="k">result</span>
                  <pre class="v">{result.text}</pre>
                  {#if result.more}<span class="more">… {result.more.toLocaleString()} more chars</span>{/if}
                </div>
              {/if}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      {:else}
        <div class="trow flat">{@render line()}</div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .tools {
    margin: var(--space-4) 0 0 var(--space-2);
    padding-left: var(--space-3);
    background: var(--rail) left top / 2px 100% no-repeat;
  }
  /* The row's shape is shared by the plain <div> and the Collapsible trigger
     (a <button>, so it needs its chrome stripped back to the ledger's). */
  .trow,
  .row :global(.trow) {
    width: 100%;
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--ink-body);
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    text-align: left;
  }
  .row :global(button.trow) {
    cursor: pointer;
  }
  .row :global(.trow:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-mark);
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
  /* A failed call carries its state on the glyph — the completed row's done/failed
     cue, next to the running row's breathing glyph in the live tool. */
  .ic.err {
    color: var(--data-bad);
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
  .row :global([data-slot='badge']) {
    flex: 0 0 auto;
  }
  /* A fact is a measurement, not a verdict: it reads in --ink-stat, the ink
     that gives a number presence without passing judgement on it. Green is
     reserved for the added side of a `diff` fact — the one measurement that
     carries a direction — and every diff row agrees on that reading, whether
     it came back as `+38 −2` or a lone `+38`. */
  .d {
    color: var(--ink-stat);
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
  }
  .d.bad {
    color: var(--data-bad);
  }
  .add {
    color: var(--data-ok);
  }
  .del {
    color: var(--data-bad);
  }
  /* The affordance sits at the tail so the row's left anatomy is unchanged. */
  .chev {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    color: var(--ink-muted);
    transition: transform var(--c-100) var(--e-in);
  }
  .chev :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }
  .row :global(.trow[data-state='open'] .chev) {
    transform: rotate(90deg);
  }

  /* The disclosed payload — same anatomy as Prompt.svelte's "What this touches",
     indented past the glyph so it hangs under the row's text, not its icon. */
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-2) 0 var(--space-3) calc(15px + var(--space-2));
    padding: var(--space-3);
    border-radius: var(--radius-well);
    background: var(--surface-sunken);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .field .k {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--ink-muted);
  }
  .field .v {
    margin: 0;
    max-height: 300px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    color: var(--ink-body);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .field .more {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
  @media (max-width: 900px) {
    .tools {
      margin-left: 0;
    }
  }
  @media (pointer: coarse) {
    .trow,
    .row :global(.trow) {
      min-height: 44px;
    }
  }
</style>

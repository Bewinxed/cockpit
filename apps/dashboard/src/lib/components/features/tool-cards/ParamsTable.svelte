<script lang="ts">
  /**
   * The dignity floor for a tool nobody wrote a sentence for: its arguments
   * read as a table of names and values, and what came back reads as output.
   * A raw `JSON.stringify` of the input never reaches the screen again.
   */
  import OutputBlock from './OutputBlock.svelte';

  interface Props {
    input?: Record<string, unknown>;
    result?: string;
  }

  let { input, result }: Props = $props();

  /** Enough rows to recognise a call by; past this the reader wants the docs. */
  const MAX_ROWS = 8;
  const VALUE_CAP = 120;

  const entries = $derived(Object.entries(input ?? {}).filter(([, value]) => value !== undefined));
  const shown = $derived(entries.slice(0, MAX_ROWS));
  const hidden = $derived(entries.length - shown.length);

  /** Nested structure collapses to a mark: one level is a preview, two is a dump. */
  const flatten = (value: unknown): unknown =>
    value !== null && typeof value === 'object' ? (Array.isArray(value) ? '[…]' : '{…}') : value;

  function preview(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || typeof value !== 'object') return String(value);
    const shallow = Array.isArray(value)
      ? value.map(flatten)
      : Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, flatten(inner)]));
    const json = JSON.stringify(shallow);
    return json.length > VALUE_CAP ? `${json.slice(0, VALUE_CAP)}…` : json;
  }
</script>

<div class="space-y-2">
  {#if shown.length > 0}
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
      {#each shown as [key, value] (key)}
        {@const text = preview(value)}
        <dt class="text-caption">{key}</dt>
        <dd class="truncate font-mono text-micro text-foreground" title={text}>{text}</dd>
      {/each}
    </dl>
    {#if hidden > 0}
      <p class="text-caption">and {hidden} more</p>
    {/if}
  {/if}

  {#if result}
    <OutputBlock text={result} />
  {/if}
</div>

<script lang="ts">
  /**
   * A delegate's turn report body: prose or a raw log dump, rendered the same
   * way wherever it appears (the delegate card's Report section, or the
   * `user.peer` fallback bubble). A long report collapses by default to a few
   * lines with a "show all" expander that names its full size, so a 1500-line
   * number dump no longer fills the transcript as one giant card. Short
   * reports render whole, as they always did.
   */
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { IconChevronRight } from '$lib/icons';
  import { Markdown } from '$lib/components/ui/markdown';
  import OutputBlock from './OutputBlock.svelte';
  import {
    isLogReport,
    reportCollapses,
    reportLineCount,
    reportPreview,
  } from './report-body';

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  const isLog = $derived(isLogReport(text));
  const long = $derived(reportCollapses(text));
  const lineCount = $derived(reportLineCount(text));
  const preview = $derived(reportPreview(text));

  let expanded = $state(false);
</script>

{#if long}
  <div>
    <Collapsible.Root open={expanded} onOpenChange={() => (expanded = !expanded)}>
      {#if isLog}
        <OutputBlock text={expanded ? text : preview} />
      {:else}
        <Markdown source={expanded ? text : preview} />
      {/if}
      <Collapsible.Trigger
        class="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconChevronRight
          class="size-3 transition-transform duration-200 {expanded ? 'rotate-90' : ''}"
        />
        <span>{expanded ? 'Show less' : `Show all — ${lineCount} lines`}</span>
      </Collapsible.Trigger>
    </Collapsible.Root>
  </div>
{:else}
  {#if isLog}
    <OutputBlock text={text} />
  {:else}
    <Markdown source={text} />
  {/if}
{/if}

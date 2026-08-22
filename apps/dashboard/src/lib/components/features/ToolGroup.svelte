<script lang="ts">
  /**
   * A turn's tool calls as one card of sentences. The header says what kind of
   * work the turn was — the families it touched and how many steps — so the
   * reader can skip fourteen commands without reading fourteen rows.
   */
  import { IconError, IconSpinner, IconSuccess } from '$lib/icons';
  import type { Component } from 'svelte';
  import type { Message } from '$lib/cockpit/types';
  import DiffModal from './DiffModal.svelte';
  import ToolRow from './tool-cards/ToolRow.svelte';
  import {
    resultText,
    toolFamily,
    type FamilyId,
    type ToolFamily,
    type ToolStatus,
  } from './tool-cards/descriptors';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  interface Props {
    tools: Message[];
  }

  let { tools }: Props = $props();

  let expandedTools = new SvelteSet<string>();

  const errorCount = $derived(tools.filter((t) => t.metadata?.toolStatus === 'error').length);
  const pendingCount = $derived(tools.filter((t) => t.metadata?.toolStatus === 'pending').length);

  // A group read back from a stored transcript arrives already finished — only a
  // run that lands while you are watching earns the completion pop.
  const startedPending = untrack(() => tools.some((t) => t.metadata?.toolStatus === 'pending'));

  /** What kinds of work this turn was, heaviest first. */
  const families = $derived.by(() => {
    const counts = new Map<FamilyId, { family: ToolFamily; count: number }>();
    for (const tool of tools) {
      const family = toolFamily(tool.metadata?.toolName);
      const seen = counts.get(family.id);
      if (seen) seen.count += 1;
      else counts.set(family.id, { family, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  });

  /** Up to four glyphs, stacked. Two families can share one — show it once. */
  const glyphs = $derived.by(() => {
    const seen = new Set<Component>();
    const stack: ToolFamily[] = [];
    for (const { family } of families) {
      if (seen.has(family.icon)) continue;
      seen.add(family.icon);
      stack.push(family);
      if (stack.length === 4) break;
    }
    return stack;
  });

  /** Only worth saying when the turn did more than one kind of thing. */
  const summary = $derived(
    families.length > 1
      ? families
          .slice(0, 2)
          .map(({ family, count }) => `${count} ${count === 1 ? family.one : family.many}`)
          .join(' · ')
      : ''
  );

  function toggleTool(toolId: string) {
    if (expandedTools.has(toolId)) expandedTools.delete(toolId);
    else expandedTools.add(toolId);
  }

  // Diff modal state
  let diffModalOpen = $state(false);
  let diffModalData = $state<{ filePath: string; oldContent: string; newContent: string } | null>(
    null
  );

  function openDiffModal(filePath: string, oldContent: string, newContent: string) {
    diffModalData = { filePath, oldContent, newContent };
    diffModalOpen = true;
  }
</script>

<div class="ml-[7px] w-[calc(100%-7px)] pl-3" style="background:var(--rail) left top/2px 100% no-repeat">
  {#if tools.length > 1}
    <div
      class="flex items-center gap-2 px-3 py-2"
      in:fly={{ y: -4, duration: 160, easing: quintOut }}
    >
      <span class="flex shrink-0 -space-x-1">
        {#each glyphs as family (family.id)}
          {@const Glyph = family.icon}
          <span class="flex size-5 items-center justify-center rounded-full bg-card">
            <Glyph class="size-4 {family.color}" />
          </span>
        {/each}
      </span>

      <span class="text-caption">{tools.length} step{tools.length === 1 ? '' : 's'}</span>
      {#if summary}
        <span class="hidden truncate text-micro text-muted-foreground sm:inline">{summary}</span>
      {/if}

      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        {#if pendingCount > 0}
          <IconSpinner class="size-4 animate-spin text-warning motion-reduce:animate-none" />
          <span class="text-micro text-warning">{pendingCount} running</span>
        {:else if errorCount > 0}
          <IconError class="size-4 text-error" />
          <span class="text-micro text-error">{errorCount} failed</span>
        {:else}
          <span in:scale={{ duration: startedPending ? 260 : 0, start: 0.25, easing: quintOut }}>
            <IconSuccess class="size-4 text-success" />
          </span>
          <span class="text-micro text-success">Complete</span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="divide-y divide-border/50 {tools.length > 1 ? 'border-t border-border/50' : ''}">
    {#each tools as tool, i (tool.id)}
      {@const toolId = tool.id || `tool-${i}`}
      <ToolRow
        toolName={tool.metadata?.toolName}
        input={tool.metadata?.toolInput as Record<string, unknown> | undefined}
        result={resultText(tool.metadata?.toolResult)}
        status={(tool.metadata?.toolStatus ?? 'pending') as ToolStatus}
        open={expandedTools.has(toolId)}
        onToggle={() => toggleTool(toolId)}
        onOpenDiff={openDiffModal}
      />
    {/each}
  </div>
</div>

<!-- Diff Modal — the data outlives the close so the panel can animate out. -->
{#if diffModalOpen && diffModalData}
  <DiffModal
    filePath={diffModalData.filePath}
    oldContent={diffModalData.oldContent}
    newContent={diffModalData.newContent}
    onClose={() => (diffModalOpen = false)}
  />
{/if}

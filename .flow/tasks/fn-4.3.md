# fn-4.3 Add ThinkingBlock Renderer Component

## Description

Add a ThinkingBlock renderer component that shows Claude's reasoning in a collapsible format.

### Context
- Claude SDK can return `ThinkingBlock` content in assistant messages
- Format: `{ type: 'thinking', thinking: string, signature: string }`
- Currently not rendered at all - users can't see Claude's reasoning chain

### Target State
- ThinkingBlock renders as collapsible "Claude is thinking..." section
- Collapsed by default with summary (first ~100 chars or "Reasoning...")
- Expands to show full thinking content
- Styled distinctly from regular text (lighter, monospace or italic)

### Implementation Details

```svelte
<!-- apps/dashboard/src/lib/components/features/message-renderers/ThinkingBlock.svelte -->
<script lang="ts">
  interface Props {
    thinking: string;
    signature?: string;
    defaultExpanded?: boolean;
  }

  let { thinking, signature, defaultExpanded = false }: Props = $props();
  let expanded = $state(defaultExpanded);

  const summary = $derived(
    thinking.length > 100 ? thinking.slice(0, 100) + '...' : thinking
  );
</script>

<div class="thinking-block border-l-2 border-muted pl-3 my-2">
  <button
    class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    onclick={() => expanded = !expanded}
  >
    <ChevronRight class="size-4 transition-transform" class:rotate-90={expanded} />
    <span class="font-medium">Thinking</span>
    {#if !expanded}
      <span class="text-xs opacity-60 truncate max-w-[300px]">{summary}</span>
    {/if}
  </button>

  {#if expanded}
    <div class="mt-2 text-sm text-muted-foreground font-mono whitespace-pre-wrap">
      {thinking}
    </div>
  {/if}
</div>
```

### Files to Create
- `apps/dashboard/src/lib/components/features/message-renderers/ThinkingBlock.svelte`

### Files to Modify
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` - Parse thinking blocks from assistant messages
- `apps/dashboard/src/lib/components/features/message-renderers/registry.ts` - Register thinking renderer
- `apps/dashboard/src/lib/components/features/ChatMessage.svelte` - Check for thinking blocks

### Reference
- SDK ThinkingBlock type: `{ type: 'thinking', thinking: string, signature: string }`
- Handle `redacted_thinking` blocks gracefully (show "Reasoning redacted")
## Acceptance

- [ ] ThinkingBlock component created and styled
- [ ] Thinking blocks parsed from assistant message content
- [ ] Collapsed by default with preview text
- [ ] Expands/collapses on click with smooth transition
- [ ] `redacted_thinking` blocks show "Reasoning redacted" message
- [ ] Visually distinct from regular text (border, font, color)
- [ ] Works in both light and dark themes
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:

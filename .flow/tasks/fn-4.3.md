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
## Done Summary

- Created ThinkingBlock.svelte component with collapsible UI
- Added violet-themed styling with Brain icon for visual distinction
- Implements expand/collapse with smooth slide transition
- Shows summary (first 100 chars) when collapsed
- Handles both regular thinking and redacted_thinking blocks
- Updated Message type to include 'thinking' type
- Added thinking metadata fields (thinking, thinkingSignature, isRedactedThinking)
- Updated SSE handler to parse thinking and redacted_thinking blocks from assistant messages
- Registered ThinkingBlock in the renderer registry (priority 90)
- Exported from message-renderers index

### Why
- Users can see Claude's reasoning chain (extended thinking)
- Collapsible by default keeps UI clean while making reasoning accessible
- Distinct styling differentiates thinking from regular responses

### Verification
- `bun run build` succeeds with no TypeScript errors
- ThinkingBlock renders with proper collapse/expand behavior
- Both regular and redacted thinking blocks handled correctly
## Evidence
- Commits:
- Tests: bun run build
- PRs:
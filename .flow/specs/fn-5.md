# Epic: Live Subagent Tree Visualization (Mission Control)

## Mindmap: Architecture Overview

```
                         ┌─────────────────────────────────────────┐
                         │            MAIN CONVERSATION            │
                         └─────────────────────────────────────────┘
                                           │
         User: "Research auth across docs and code"
                                           │
         Claude: "I'll research from multiple angles"
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                              │
          ┌─────────▼─────────┐                        ┌──────────▼──────────┐
          │   repo-scout      │                        │    docs-scout       │
          │   ════════════    │                        │    ═══════════      │
          │   🟢 RUNNING      │                        │    🟢 RUNNING       │
          │   ████████░░ 80%  │                        │    ██████░░░░ 60%   │
          │                   │                        │                      │
          │   [Grep] ✓        │                        │   [WebSearch] ✓      │
          │   [Read] ✓        │                        │   [WebFetch] ⏳      │
          │   [Glob] ⏳       │                        │                      │
          └─────────┬─────────┘                        └──────────┬──────────┘
                    │                                              │
                    │        ┌─────────────────────┐               │
                    │        │  NESTED SUBAGENT    │               │
                    │        │  (if repo-scout     │               │
                    │        │   spawns another)   │               │
                    │        └──────────┬──────────┘               │
                    │                   │                          │
                    └───────────────────┼──────────────────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────────────────┐
                         │           MERGE POINT                    │
                         │   Claude: "Combining findings..."        │
                         └─────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              SSE EVENT STREAM                                 │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│ SubagentStart   │        │  sdk:message    │        │  SubagentStop   │
│ {toolUseId,     │        │ {parentToolUse  │        │ {toolUseId,     │
│  subagentType}  │        │  Id, content}   │        │  result}        │
└────────┬────────┘        └────────┬────────┘        └────────┬────────┘
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           activeSubagents (Map)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ "tool-abc" => {                                                      │    │
│  │   status: "running",                                                 │    │
│  │   subagentType: "repo-scout",                                       │    │
│  │   startedAt: Date,                                                   │    │
│  │   messages: [msg1, msg2, msg3],  ◄── Messages routed by parentId    │    │
│  │   result: null                                                       │    │
│  │ }                                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI COMPONENTS                                   │
│                                                                              │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐           │
│  │ SubagentTree    │──►│ SubagentBranch  │──►│ SubagentHeader  │           │
│  │ (container)     │   │ (per agent)     │   │ (status/timer)  │           │
│  └─────────────────┘   └────────┬────────┘   └─────────────────┘           │
│                                 │                                            │
│                                 ▼                                            │
│                        ┌─────────────────┐   ┌─────────────────┐           │
│                        │SubagentMessages │──►│   ToolGroup     │           │
│                        │ (message list)  │   │ (reuse existing)│           │
│                        └─────────────────┘   └─────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Message Hierarchy (parentToolUseId Linking)

```
Message {
  id: "msg-1"
  parentToolUseId: null  ◄──── Main conversation (no parent)
  content: "I'll use multiple agents"
}
    │
    └─► Task tool_use {
          id: "tool-abc"
          name: "Task"
          input: { subagent_type: "repo-scout" }
        }
            │
            └─► Message {
                  id: "msg-2"
                  parentToolUseId: "tool-abc"  ◄──── Belongs to subagent
                  content: "Searching for patterns..."
                }
                    │
                    └─► tool_use {
                          id: "tool-def"
                          parentToolUseId: "tool-abc"  ◄──── Tool within subagent
                          name: "Grep"
                        }
                            │
                            └─► Nested Task tool_use {
                                  id: "tool-ghi"
                                  parentToolUseId: "tool-abc"
                                  name: "Task"
                                  input: { subagent_type: "Bash" }
                                }
                                    │
                                    └─► Message {
                                          parentToolUseId: "tool-ghi"  ◄── Nested!
                                          content: "Running command..."
                                        }
```

## Overview

Build a real-time "mission control" view for Claude's subagent orchestration. When Claude spawns subagents (via Task tool), visualize them as a live tree/flowchart in the chat, showing each agent's messages, tool uses, progress, and results. Users should see the "heartbeat and vital signs" of every task at every stage.

## The Problem

Currently when Claude spawns subagents:
- Messages appear in a flat list, losing the hierarchical relationship
- No visual indication of which messages belong to which subagent
- No real-time progress/activity indicators per subagent
- Hard to understand parallel execution
- Results just appear without context of what spawned them

## The Vision

```
User: "Research this feature across docs and code"
│
Claude: "I'll research from multiple angles"
│
┌─────────────────────────────────────────────────────────────────┐
│ ⚡ PARALLEL EXECUTION                                            │
│                                                                  │
│ ┌─ repo-scout ─────────────┐  ┌─ docs-scout ─────────────────┐  │
│ │ 🟢 RUNNING (12s)         │  │ 🟢 RUNNING (8s)              │  │
│ │ ████████░░ 80%           │  │ ██████░░░░ 60%               │  │
│ │                          │  │                               │  │
│ │ ├─ [Grep] auth patterns  │  │ ├─ [WebSearch] Claude SDK... │  │
│ │ │  └─ 15 matches         │  │ │  └─ 5 results              │  │
│ │ ├─ [Read] src/auth.ts    │  │ └─ [WebFetch] docs.anthropic │  │
│ │ │  └─ 245 lines ✓        │  │    └─ ⏳ fetching...         │  │
│ │ └─ [Glob] **/*.auth.*    │  │                               │  │
│ │    └─ ⏳ scanning...     │  │                               │  │
│ └──────────────────────────┘  └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
│
Claude: "Combining findings from both scouts..."
```

## Key Features

### 1. Live Activity Indicators
- Pulsing/animated indicator when subagent is active
- Status: `STARTING` → `RUNNING` → `COMPLETE` / `ERROR`
- Elapsed time counter
- Progress bar if determinable (or indeterminate spinner)

### 2. Tree Structure
- Messages grouped by `parent_tool_use_id`
- Nested subagents shown as nested branches
- Collapsible branches (expand/collapse each subagent)
- Visual connection lines showing parent-child relationships

### 3. Parallel Execution
- Side-by-side layout when multiple subagents run concurrently
- Visual indication that they're parallel (not sequential)
- Responsive: stack vertically on narrow screens

### 4. Tool Vitals Per Subagent
- Each tool_use shows: name, status, duration
- Tool results inline with collapsible details
- Errors highlighted with stack trace expandable

### 5. Completion & Merge
- Clear visual when subagent completes
- Result summary shown
- "Merge point" where results flow back to parent

## Technical Implementation

### Data Model

```typescript
// Extend Message type
interface Message {
  // ... existing fields
  parentToolUseId?: string;  // Links to Task tool_use that spawned this
  subagentType?: string;      // 'Explore', 'Plan', 'Bash', etc.
  subagentStatus?: 'starting' | 'running' | 'complete' | 'error';
}

// New: Subagent tracking
interface SubagentState {
  toolUseId: string;           // The Task tool_use ID
  subagentType: string;
  status: 'starting' | 'running' | 'complete' | 'error';
  startedAt: Date;
  completedAt?: Date;
  messages: Message[];         // Messages with this parentToolUseId
  result?: string;
  error?: string;
}

// In realtime.svelte.ts
export const activeSubagents = writable<Map<string, SubagentState>>(new Map());
```

### SSE Event Handling

```typescript
// Handle SubagentStart hook event
case 'SubagentStart':
  activeSubagents.update(map => {
    map.set(event.toolUseId, {
      toolUseId: event.toolUseId,
      subagentType: event.subagentType,
      status: 'running',
      startedAt: new Date(),
      messages: [],
    });
    return map;
  });
  break;

// Handle SubagentStop hook event
case 'SubagentStop':
  activeSubagents.update(map => {
    const subagent = map.get(event.toolUseId);
    if (subagent) {
      subagent.status = 'complete';
      subagent.completedAt = new Date();
      subagent.result = event.result;
    }
    return map;
  });
  break;

// Route messages by parentToolUseId
if (message.parentToolUseId) {
  activeSubagents.update(map => {
    const subagent = map.get(message.parentToolUseId);
    if (subagent) {
      subagent.messages.push(message);
    }
    return map;
  });
}
```

### Component Architecture

```
apps/dashboard/src/lib/components/features/
├── subagent/
│   ├── SubagentTree.svelte       # Main tree container
│   ├── SubagentBranch.svelte     # Single subagent branch
│   ├── SubagentHeader.svelte     # Status, timer, progress
│   ├── SubagentMessages.svelte   # Messages within branch
│   ├── SubagentResult.svelte     # Completion summary
│   └── ParallelContainer.svelte  # Side-by-side layout
```

## Dependencies

- **fn-4** (Message Renderer Registry) - The subagent components should be registered as renderers for Task tool_use messages

## Scope

### In Scope
- Tree visualization of subagent hierarchy
- Live status/progress indicators
- Parallel execution layout
- Collapsible branches
- Tool vitals per subagent
- Nested subagent support (subagent spawns subagent)

### Out of Scope (Future)
- Replay/timeline scrubbing
- Cost breakdown per subagent
- Subagent cancellation from UI
- Custom subagent theming

## Quick Commands

```bash
# Test with a prompt that spawns subagents
bun run dev:dashboard
# Send: "Use the Explore agent to find all authentication code"
# Should see: Subagent branch appear with live updates
```

## Acceptance Criteria

- [ ] Messages with `parentToolUseId` grouped into visual branches
- [ ] Live status indicator (pulsing when active)
- [ ] Elapsed time counter per subagent
- [ ] Parallel subagents shown side-by-side
- [ ] Branches collapsible/expandable
- [ ] Nested subagents render as nested branches
- [ ] Completion shows result summary
- [ ] Errors highlighted with details expandable
- [ ] Responsive layout (stacks on mobile)
- [ ] Works with existing ToolGroup component for tool_uses within subagent

## References

- SDK `parent_tool_use_id` field in messages
- Hook events: `SubagentStart`, `SubagentStop`
- Task tool: `packages/core/src/protocol/` definitions
- Existing ToolGroup: `apps/dashboard/src/lib/components/features/ToolGroup.svelte`

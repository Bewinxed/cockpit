# ASSUMPTIONS.md

This document describes the expected behavior and assumptions about the Cockpit dashboard application. Use this as a guide for testing each feature with Playwright or manual verification.

---

## Agent Connection & Management

### A1: Agent Registration
- **Assumption**: When an agent service starts, it should automatically connect to the hub and appear in the dashboard
- **Expected**: Agent card shows in sidebar with hostname, OS icon, and "online" status
- **Verify**: Start agent service → Agent appears in dashboard within 5 seconds

### A2: Agent Reconnection
- **Assumption**: If an agent disconnects (network issue, restart), it should show "reconnecting" status and auto-reconnect
- **Expected**: Status changes to "reconnecting" (yellow), then back to "online" (green) when restored
- **Verify**: Kill agent process → Status shows "reconnecting" → Restart agent → Status returns to "online"

### A3: Multiple Agents
- **Assumption**: Multiple agents can connect simultaneously from different machines
- **Expected**: Each agent appears as separate card in sidebar with unique machineId
- **Verify**: Connect agents from 2+ machines → All appear in dashboard

---

## Instance Lifecycle

### I1: Spawn Single Instance
- **Assumption**: User can spawn a new Claude instance on any connected agent
- **Expected**: Click "New Instance" → Instance appears with "starting" status → Changes to "running"
- **Verify**: Spawn instance → See status transition → Instance is interactive

### I2: Spawn Multiple Instances
- **Assumption**: User can spawn multiple instances simultaneously on same or different agents
- **Expected**: Each instance gets unique ID and appears in instance list
- **Verify**: Spawn 3 instances rapidly → All 3 appear and run independently

### I3: Instance Status Transitions
- **Assumption**: Instance status accurately reflects its state: starting → running → stopping → stopped
- **Expected**: Status badge updates in real-time as instance state changes
- **Verify**: Watch status during spawn, use, and stop

### I4: Instance Sleeping (Idle Timeout)
- **Assumption**: Instances that idle for 60 minutes transition to "sleeping" status
- **Expected**: Status changes to "sleeping", can be resumed later with session preserved
- **Verify**: Leave instance idle → Observe status change (or check DB after timeout)

### I5: Stop Instance
- **Assumption**: User can stop a running instance gracefully
- **Expected**: Click stop → Status changes to "stopping" → "stopped"
- **Verify**: Stop running instance → Verify it's no longer processing

### I6: Resume Sleeping Instance
- **Assumption**: Sleeping instances can be resumed with conversation history intact
- **Expected**: Click resume → Instance returns to "running" with previous messages
- **Verify**: Resume sleeping instance → Previous conversation visible

---

## Chat & Messaging

### M1: Send Message
- **Assumption**: User can send a message to a running instance and receive a response
- **Expected**: Message appears in chat → Assistant responds → Response streams in real-time
- **Verify**: Type message → Send → See streaming response

### M2: Message Persistence
- **Assumption**: Messages are persisted to database and restored on page refresh
- **Expected**: Refresh page → Previous messages still visible
- **Verify**: Send messages → Refresh browser → Messages still there

### M3: Streaming Text
- **Assumption**: Assistant responses stream character-by-character in real-time
- **Expected**: Text appears progressively, not all at once
- **Verify**: Ask a question requiring long response → Watch text stream in

### M4: Code Syntax Highlighting
- **Assumption**: Code blocks in messages are syntax-highlighted
- **Expected**: Code appears with proper coloring based on language
- **Verify**: Ask for code → Verify syntax highlighting applied

### M5: Clear Chat (/clear command)
- **Assumption**: /clear command removes messages from UI and database
- **Expected**: Messages disappear from chat AND from database
- **Verify**: Send messages → Type /clear → Refresh → Messages gone

---

## Tool Usage Display

### T1: Tool Use Visibility
- **Assumption**: When Claude uses a tool, it appears in the chat with tool name and input
- **Expected**: Tool use card shows tool name, expandable to see input/output
- **Verify**: Ask Claude to read a file → See "Read" tool appear with file path

### T2: Tool Result Display
- **Assumption**: Tool results are captured and displayed (success or error)
- **Expected**: Tool card shows status (success/error) and result content
- **Verify**: Trigger tool use → See result appear in tool card

### T3: Tool Grouping
- **Assumption**: Consecutive tool uses are grouped together for compact display
- **Expected**: Multiple tools appear in collapsible group, not as separate messages
- **Verify**: Ask Claude to search codebase → Multiple Glob/Grep tools grouped

### T4: Parallel Tool Display
- **Assumption**: Tools called in parallel are displayed together
- **Expected**: Parallel tool calls shown side-by-side or in same group
- **Verify**: Trigger action requiring parallel tool calls → See grouped display

---

## Subagents (Task Tool)

### S1: Blocking Agent Spawn
- **Assumption**: When Claude spawns a blocking subagent (Task tool), it appears as expandable branch
- **Expected**: SubagentBranch component shows with agent type, description, status
- **Verify**: Ask Claude to explore codebase → See "Explore" subagent branch

### S2: Blocking Agent Messages Stream Live
- **Assumption**: Blocking subagent's tool uses and text stream live into SubagentBranch
- **Expected**: As subagent works, its messages appear in real-time inside the branch
- **Verify**: Spawn blocking agent → Watch its tool uses appear live

### S3: Background Agent Spawn
- **Assumption**: Background agents (run_in_background=true) show as branch but don't stream live
- **Expected**: Branch appears with "running" status, tool uses appear when TaskOutput retrieves result
- **Verify**: Spawn background agent → Branch shows "running" → After TaskOutput, tools appear

### S4: Background Agent Tool Parsing
- **Assumption**: Background agent results are parsed to extract [Tool: Name] {json} entries
- **Expected**: Tool uses from background agent appear as proper tool cards in SubagentBranch
- **Verify**: Complete background agent → Expand branch → See parsed tool uses

### S5: Multiple Parallel Subagents
- **Assumption**: Multiple subagents spawned in parallel all appear and track independently
- **Expected**: Each gets its own SubagentBranch with independent status
- **Verify**: Spawn 3 agents in parallel → All 3 branches appear and complete

### S6: Nested Subagents
- **Assumption**: Subagents can spawn their own subagents (nested)
- **Expected**: Nested subagent appears inside parent's branch
- **Verify**: Trigger deep exploration → See nested branches

### S7: Subagent Persistence
- **Assumption**: Subagent tree reconstructs from database on page refresh
- **Expected**: Refresh page → SubagentBranch components restore with tool uses
- **Verify**: Spawn subagents → Refresh → Tree still visible with tools

---

## Permission System

### P1: Permission Request Display
- **Assumption**: When Claude needs permission for a tool, a dialog appears
- **Expected**: Permission dialog shows tool name, input, allow/deny buttons
- **Verify**: Trigger permission-required action → See dialog

### P2: Allow Permission
- **Assumption**: Clicking "Allow" lets the tool execute and continue
- **Expected**: Dialog closes → Tool executes → Response continues
- **Verify**: Allow permission → Observe continued execution

### P3: Deny Permission
- **Assumption**: Clicking "Deny" blocks the tool and informs Claude
- **Expected**: Dialog closes → Claude receives denial → May try alternative
- **Verify**: Deny permission → See Claude's response to denial

### P4: Permission Timeout
- **Assumption**: Permissions have a timeout (user can configure)
- **Expected**: If not responded to, permission auto-denies or shows warning
- **Verify**: Leave permission dialog → Observe timeout behavior

---

## Model Selection

### M1: View Current Model
- **Assumption**: User can see which model an instance is using
- **Expected**: Model name visible in instance header or info
- **Verify**: Check instance → See model (e.g., "claude-sonnet-4-5")

### M2: Change Model (/model command)
- **Assumption**: User can change model mid-conversation via /model command
- **Expected**: Model picker appears → Select new model → Subsequent responses use it
- **Verify**: Type /model → Select different model → Ask question → Check model in response

---

## Cost Tracking

### C1: Token Usage Display
- **Assumption**: Input/output tokens are tracked and displayed per instance
- **Expected**: Token counts visible in instance details or header
- **Verify**: Use instance → Check token counts update

### C2: Cost Accumulation
- **Assumption**: USD cost accumulates as tokens are used
- **Expected**: Cost value increases with usage, visible somewhere in UI
- **Verify**: Use instance → See cost increase

---

## Real-time Updates (WebSocket)

### R1: WebSocket Connection
- **Assumption**: Dashboard maintains WebSocket connection to `/ws/dashboard` for real-time updates
- **Expected**: Events from hub appear instantly without polling, bidirectional communication
- **Verify**: Use browser devtools Network tab → Observe WebSocket connection active

### R2: Multi-tab Sync
- **Assumption**: Multiple browser tabs stay in sync via WebSocket
- **Expected**: Action in one tab reflects in other tabs
- **Verify**: Open 2 tabs → Send message in one → Appears in both

### R3: Reconnection on Disconnect
- **Assumption**: If WebSocket disconnects, dashboard reconnects automatically with exponential backoff
- **Expected**: Brief disconnect doesn't lose state, auto-reconnects
- **Verify**: Temporarily block network → Restore → Dashboard recovers

---

## Database Persistence

### D1: Messages Stored
- **Assumption**: All SDK messages are stored in messages table
- **Expected**: Query DB → See messages with sdkType, textContent, etc.
- **Verify**: Check messages table after conversation

### D2: Tool Invocations Stored
- **Assumption**: Tool uses are extracted to tool_invocations table
- **Expected**: Query DB → See tool_invocations with toolName, toolInput, toolResult
- **Verify**: Check tool_invocations after tool usage

### D3: Instance State Stored
- **Assumption**: Instance status, cost, sdkSessionId persisted
- **Expected**: Query instances table → See current state
- **Verify**: Check instances table → Matches UI state

---

## Error Handling

### E1: Instance Error Display
- **Assumption**: If instance errors, status shows "error" with message
- **Expected**: Error status visible, error message accessible
- **Verify**: Trigger error condition → See error state

### E2: Network Error Recovery
- **Assumption**: Temporary network errors don't crash the dashboard
- **Expected**: UI shows error state, recovers when network restored
- **Verify**: Disconnect network briefly → UI handles gracefully

### E3: Tool Error Display
- **Assumption**: Failed tools show error status and error message
- **Expected**: Tool card shows red/error state with error content
- **Verify**: Trigger tool error → See error in tool card

---

## UI/UX

### U1: Responsive Layout
- **Assumption**: Dashboard works on various screen sizes
- **Expected**: Layout adapts, no horizontal scroll on reasonable sizes
- **Verify**: Resize window → UI remains usable

### U2: Keyboard Navigation
- **Assumption**: User can send messages with Enter key
- **Expected**: Enter sends message, Shift+Enter for newline
- **Verify**: Type message → Press Enter → Message sends

### U3: Scroll Behavior
- **Assumption**: Chat auto-scrolls to bottom on new messages
- **Expected**: New messages visible without manual scrolling
- **Verify**: Long conversation → New message → Auto-scrolls

### U4: Loading States
- **Assumption**: Loading states shown during async operations
- **Expected**: Spinner or skeleton during load
- **Verify**: Refresh page → See loading state → Content appears

---

---

## Svelte 5 Store Patterns

### SV1: SvelteMap Reactivity
- **Assumption**: SvelteMap mutations trigger reactive updates without reassignment
- **Expected**: UI updates when `map.set()` called on SvelteMap
- **Verify**: Add agent via WebSocket → Agent appears in sidebar without page refresh

### SV2: Class-based Store Methods
- **Assumption**: Calling store methods updates UI reactively
- **Expected**: `instances.addMessage()` → Chat updates immediately
- **Verify**: Send message → See streaming response appear in chat

### SV3: Derived Store Efficiency
- **Assumption**: $derived only recalculates when dependencies change
- **Expected**: Derived stores don't recalculate on unrelated state changes
- **Verify**: Change agent status → Only agent-related deriveds update (check devtools)

### SV4: river.ts WebSocket Connection
- **Assumption**: river.ts RiverSocketAdapter handles WebSocket with type safety and auto-reconnect
- **Expected**: All events typed, auto-reconnect works with exponential backoff
- **Verify**: Disconnect network briefly → WebSocket reconnects automatically

### SV5: Private State Encapsulation
- **Assumption**: Using `#privateField` enforces method-only access
- **Expected**: Cannot directly mutate store state from components
- **Verify**: TypeScript error if trying to access `store.#agents` directly

---

## Testing Checklist

For Playwright testing, verify each assumption by:
1. Navigate to dashboard (http://localhost:3000)
2. Ensure agent is connected
3. Execute the verification steps
4. Assert expected behavior
5. Report pass/fail with screenshot if failed

Priority order for testing:
1. **Critical**: I1, M1, M2, T1, S1, S3 (basic functionality)
2. **Important**: S4, S7, P1, P2, D1, D2 (persistence & permissions)
3. **Nice-to-have**: R1, R2, U1, U3 (UX polish)
4. **Svelte 5**: SV1, SV2, SV3 (store migration verification)

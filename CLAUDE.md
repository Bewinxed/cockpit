# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun install                    # Install all dependencies
bun run dev                    # Start dashboard on port 3000
bun run dev:all                # Start all packages simultaneously
bun run dev:dashboard          # Dashboard only (SvelteKit + Vite)
bun run dev:agent              # Agent service with hot reload
bun run hub                    # Run hub server directly
bun run agent                  # Run agent service directly
bun run build                  # Production build all packages
bun test                       # Run tests
bun test --watch               # Watch mode
bun test packages/core         # Run tests in specific package
```

Use Bun instead of Node.js. Use `bun:sqlite` not `better-sqlite3`. Use built-in `WebSocket` not `ws`. Prefer `Bun.file` over `node:fs`. Use `Bun.$\`cmd\`` instead of execa.

## Architecture Overview

Three-tier monorepo architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Dashboard (SvelteKit)                         │
│                    apps/dashboard/                               │
│                    Port 3000, SSE client                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ SSE (events), REST (queries)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Hub Server (Elysia)                           │
│                    packages/hub-server/                          │
│                    Port 4000, WebSocket + REST + SSE             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket (JSON-RPC 2.0)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Service (Bun CLI)                       │
│                    packages/agent-service/                       │
│                    Runs on each machine, manages Claude sessions │
└─────────────────────────────────────────────────────────────────┘
```

**Package purposes:**
- `packages/core/` - Shared types, JSON-RPC protocol definitions, event types
- `packages/db/` - Drizzle ORM + SQLite schema
- `packages/auth/` - Authentication module
- `packages/mcp-task-tracker/` - MCP server for task management

## SSE Message Types Reference

Dashboard connects to `/api/events` for real-time updates. All events broadcast from hub via `BroadcastService`.

### Agent Events
```
agent:connected      { machineId, hostname, tailscaleIp, os, status, connectedAt }
agent:disconnected   { machineId }
agent:reconnecting   { machineId }
agent:updated        { machineId, ...agent }
```

### Instance Lifecycle Events
```
instance:created     { id, machineId, status: 'starting', cwd, projectId?, model? }
instance:started     { id, status: 'running' }
instance:stopped     { instanceId, instance: { status, totalCostUsd }, stats }
instance:sleeping    { instanceId, sdkSessionId? }
instance:error       { instanceId, error }
instance:resumed     { id, status: 'starting' }
```

### Message Streaming Events
```
sdk:message          { instanceId, message: { type, uuid?, content, role, isReplay?, model? } }
instance:token_usage { instanceId, inputTokens, outputTokens, costDelta }
instance:model-changed { instanceId, model }
```

### Task & Permission Events
```
task:created|updated|completed  { id, instanceId, title, status, progress }
permission:request   { requestId, instanceId, toolName, toolInput, suggestions? }
```

## State Machines

### Instance Lifecycle
```
Starting → Running ──→ Stopping ──→ Stopped (normal exit)
              │                 └──→ Sleeping (idle timeout, 60min)
              │                 └──→ Error (crash)
              │
              └──→ Sleeping → Resuming → Running
```

Status values: `starting`, `running`, `stopping`, `stopped`, `sleeping`, `error`, `disconnected`

### Agent Connection
```
Connecting → Online ──→ Reconnecting ──→ Online (success)
                                    └──→ Offline (timeout ~30s)
```

### Permission Request Flow
```
Agent calls canUseTool → Hub stores pending → SSE broadcast →
  Dashboard shows dialog → User Allow/Deny → Agent resumes
```

## JSON-RPC Protocol

All agent-hub communication uses JSON-RPC 2.0 over WebSocket.

**Key Commands (Hub→Agent):**
| Method | Purpose |
|--------|---------|
| `instance.spawn` | Start new Claude session |
| `instance.send` | Send message to instance |
| `instance.stop` | Stop instance |
| `instance.interrupt` | Interrupt running operation |
| `instance.rewind` | Revert to previous message |
| `filesystem.list` | List directory contents |
| `models.list` / `models.set` | Model management |
| `memory.read` / `memory.write` | Project/user memory files |

**Key Events (Agent→Hub notifications):**
| Method | Purpose |
|--------|---------|
| `instance.message` | SDK message with content, tokens |
| `instance.stopped` | Instance exited with stats |
| `instance.sleeping` | Idle timeout triggered |
| `task.updated` | Task progress update |

## Frontend Architecture

**Stack:** Svelte 5 + SvelteKit 2 + Vite + Tailwind CSS 4 + bits-ui

**State Management (realtime.svelte.ts):**
```typescript
// Core stores (Map-based)
agents, instances, projects, tasks, instanceMessages, streamingStates, pendingPermissions

// Derived stores
onlineAgents, runningInstances, populatedInstances, stats
```

**Key Components:**
- `ChatMessage` - Renders with Shiki syntax highlighting
- `ToolGroup` - Expandable tool invocations
- `PermissionRequest` - Permission dialog
- `ChatInput` - User input with command detection

**Real-time flow:** WebSocket (agent) → Hub → BroadcastService → SSE → EventSource → Svelte store → Component

## Database Schema (packages/db/)

| Table | Primary Key | Foreign Keys |
|-------|-------------|--------------|
| agents | machineId | - |
| instances | id | machineId |
| projects | id | machineId (optional) |
| tasks | id | instanceId |
| messages | id | instanceId (sdkUuid for resume) |
| credentials | id | - |

`machineId` is hardware-stable identifier, primary routing key for all agent operations.

## Hot Reload Pattern

Singleton services persist across HMR using `globalThis`:
```typescript
declare global { var __cockpitAgentRegistry: AgentRegistry }
export function getAgentRegistry() {
  return globalThis.__cockpitAgentRegistry ??= new AgentRegistry()
}
```

## Slash Commands

**Client-side (no backend):** `/help`, `/clear`, `/memory`, `/vim`, `/logout`
**Server-side (sent to agent):** `/model`, `/login`, all others

## API Routes

**Hub (port 4000):**
```
GET  /api/agents, /api/agents/:machineId
GET  /api/instances, /api/instances/:id, /api/instances/:id/messages
POST /api/instances (spawn), /api/instances/:id/send, /api/instances/:id/stop
GET  /api/events (SSE)
WS   /ws/hub (agent connection)
```

**Dashboard proxies to hub via SvelteKit `/api/[...path]`**

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
│                    Port 3000, WebSocket client (river.ts)        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket (river.ts events + RPC)
                            │ REST (queries, resume, interrupt)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Hub Server (Elysia)                           │
│                    packages/hub-server/                          │
│                    Port 4000, WebSocket + REST                   │
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

## WebSocket Event Types Reference

Dashboard connects to `/ws/dashboard` for real-time updates via river.ts. All events broadcast from hub via `DashboardRegistry`.

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
Agent calls canUseTool → Hub stores pending → WebSocket broadcast →
  Dashboard shows dialog → User Allow/Deny → WebSocket response → Agent resumes
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

**State Management (stores/*.svelte.ts):**
```typescript
// Entity stores (SvelteMap-based, Svelte 5 runes)
agents, instances, projects, tasks, permissions, questions, ui

// Cross-store derivations (via stores singleton)
stores.populatedInstances, stores.runningInstances, stores.stats, stores.instancesByProject
```

**Key Components:**
- `ChatMessage` - Renders with Shiki syntax highlighting
- `ToolGroup` - Expandable tool invocations
- `PermissionRequest` - Permission dialog
- `ChatInput` - User input with command detection

**Real-time flow:** WebSocket (agent) → Hub → DashboardRegistry → WebSocket (river.ts) → Svelte store → Component

**Dashboard-Hub Communication:**
- **WebSocket (river.ts):** spawn, send, stop, permission/question responses - bidirectional RPC + events
- **REST (Eden Treaty):** resume, interrupt, messages, projects CRUD - request/response only

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
# REST endpoints
GET  /api/agents, /api/agents/:machineId
GET  /api/instances, /api/instances/:id, /api/instances/:id/messages
POST /api/instances/:id/resume, /api/instances/:id/interrupt
GET  /api/projects, POST /api/projects, PATCH/DELETE /api/projects/:id

# WebSocket endpoints
WS   /ws/hub       (agent connection - JSON-RPC 2.0)
WS   /ws/dashboard (dashboard connection - river.ts format)
```

**Dashboard proxies to hub via SvelteKit `/api/[...path]` and `/ws/[...path]`**

<!-- BEGIN FLOW-NEXT -->
## Flow-Next

This project uses Flow-Next for task tracking. Use `.flow/bin/flowctl` instead of markdown TODOs or TodoWrite.

**Quick commands:**
```bash
.flow/bin/flowctl list                # List all epics + tasks
.flow/bin/flowctl epics               # List all epics
.flow/bin/flowctl tasks --epic fn-N   # List tasks for epic
.flow/bin/flowctl ready --epic fn-N   # What's ready
.flow/bin/flowctl show fn-N.M         # View task
.flow/bin/flowctl start fn-N.M        # Claim task
.flow/bin/flowctl done fn-N.M --summary-file s.md --evidence-json e.json
```

**Rules:**
- Use `.flow/bin/flowctl` for ALL task tracking
- Do NOT create markdown TODOs or use TodoWrite
- Re-anchor (re-read spec + status) before every task

**More info:** `.flow/bin/flowctl --help` or read `.flow/usage.md`
<!-- END FLOW-NEXT -->

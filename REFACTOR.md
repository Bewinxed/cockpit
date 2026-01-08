# Refactor: Remove agentId, Use machineId as Primary Routing Key

## Problem

The current design has two identifiers for agents:
- `agentId` - ephemeral, generated in-memory, can change on hub restart
- `machineId` - stable, hardware-derived, never changes

Instances store `agentId` as a foreign key, but `agentId` can change when the hub restarts, orphaning instances.

## Solution

Use `machineId` as the sole routing identifier. The "agent" concept becomes "machine".

---

## Tasks

### Phase 1: Core Types
- [x] 1.1 Update `@cockpit/core` Agent type - remove ephemeral id, use machineId as primary
- [x] 1.2 Update `@cockpit/core` Instance type - remove agentId, machineId becomes required
- [x] 1.3 Update SpawnInstanceData and related types (including Project types)

### Phase 2: Database Schema
- [x] 2.1 Update schema: `agents` table uses `machineId` as primary key (rename id → machineId)
- [x] 2.2 Update schema: `instances` table - remove agentId column, machineId becomes NOT NULL FK
- [x] 2.3 Update schema: `projects` table - agentId → machineId
- [x] 2.4 Migration will be handled by drizzle-kit (schema is source of truth)

### Phase 3: Agent Registry (Hub)
- [x] 3.1 Refactor AgentRegistry to key by machineId instead of agentId
- [x] 3.2 Remove agentId generation logic
- [x] 3.3 Update sendToAgent methods to use machineId only (renamed to sendToMachine)
- [x] 3.4 Remove backfillMachineId (no longer needed - removed from instance-tracker)

### Phase 4: Hub API Routes
- [x] 4.1 Update WebSocket registration - machineId is the identity
- [x] 4.2 Update instances.ts routes - remove agentId references
- [x] 4.3 Update agents.ts routes - adapt to machineId as PK
- [x] 4.4 Update instance-tracker.ts - remove agentId logic

### Phase 5: Agent Service
- [x] 5.1 Update agent registration to use machineId as identity
- [x] 5.2 Remove any agentId storage/logic

### Phase 6: Frontend/Dashboard
- [x] 6.1 Update API client types (data.remote.ts interfaces)
- [x] 6.2 Update stores (realtime.svelte.ts - Agent, Instance, Project types)
- [x] 6.3 Update actions.ts (spawnInstance, createProject, updateProject params)
- [x] 6.4 Update components (InstanceCard, AgentCard, FileBrowser, NewInstanceModal, NewProjectModal)
- [x] 6.5 Update routes (instances/[id], agents/[id], projects/[id], dashboard)

### Phase 7: Cleanup and Testing
- [x] 7.1 Remove dead code (backfill, agentId fallbacks) - Already removed in Phase 3
- [x] 7.2 Run build and fix any remaining type errors - Build passes
- [ ] 7.3 Test full flow: spawn, sleep, resume, multi-instance

---

## Notes

- machineId is generated client-side (agent service) from hardware identifiers
- One machine = one agent service = one WebSocket connection
- Multiple instances per machine, identified by instanceId
- Routing: machineId → WebSocket, instanceId → specific process

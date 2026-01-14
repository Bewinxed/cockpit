# fn-7.2 Add SSE event handlers to entity stores

## Description

Add `handleEvent()` methods to each entity store so they can process SSE events. This creates a clean separation between SSE connection layer and store mutations.

## Steps

### 1. Add Agent Event Handler

In `agents.svelte.ts`:
```typescript
import type { AgentConnectedEvent, AgentDisconnectedEvent, AgentReconnectingEvent } from './sse-events';

class AgentStore {
  // ... existing code ...

  handleEvent(type: string, data: unknown): void {
    switch (type) {
      case 'agent:connected':
        const agent = data as AgentConnectedEvent;
        this.set(agent.machineId, {
          machineId: agent.machineId,
          name: agent.hostname || agent.machineId,
          os: agent.os || 'linux',
          status: 'online',
          ip: agent.tailscaleIp || '',
          connectedAt: agent.connectedAt ? new Date(agent.connectedAt) : new Date(),
        });
        break;
      case 'agent:disconnected':
        this.updateStatus((data as AgentDisconnectedEvent).machineId, 'offline');
        break;
      case 'agent:reconnecting':
        this.updateStatus((data as AgentReconnectingEvent).machineId, 'reconnecting');
        break;
    }
  }
}
```

### 2. Add Instance Event Handler

In `instances.svelte.ts`:
```typescript
handleEvent(type: string, data: unknown): void {
  switch (type) {
    case 'instance:created':
    case 'instance:started':
    case 'instance:resumed':
      // Set or update instance
      break;
    case 'instance:stopped':
    case 'instance:sleeping':
    case 'instance:error':
      // Update status
      break;
    case 'instance:token_usage':
      // Update streaming state
      break;
    case 'instance:model-changed':
      // Update model
      break;
  }
}
```

### 3. Add Permission Event Handler

In `permissions.svelte.ts`:
```typescript
handleEvent(type: string, data: unknown): void {
  if (type === 'permission:request') {
    const perm = data as PermissionRequestEvent;
    this.add({
      requestId: perm.requestId,
      instanceId: perm.instanceId,
      toolName: perm.toolName,
      toolInput: perm.toolInput,
      createdAt: perm.createdAt,
    });
  }
}
```

### 4. Add Task Event Handler

In `tasks.svelte.ts`:
```typescript
handleEvent(type: string, data: unknown): void {
  const task = data as TaskEvent;
  if (type === 'task:created' || type === 'task:updated') {
    this.set(task.id, task);
  } else if (type === 'task:completed') {
    this.complete(task.id);
  }
}
```

### 5. Add Project Event Handler

In `projects.svelte.ts`:
```typescript
handleEvent(type: string, data: unknown): void {
  if (type === 'project:created' || type === 'project:updated') {
    const project = data as ProjectEvent;
    this.set(project.id, project);
  } else if (type === 'project:deleted') {
    this.delete((data as ProjectDeletedEvent).id);
  }
}
```

## Acceptance

- [ ] `agents.handleEvent()` handles agent:connected/disconnected/reconnecting
- [ ] `instances.handleEvent()` handles all instance lifecycle events
- [ ] `permissions.handleEvent()` handles permission:request
- [ ] `tasks.handleEvent()` handles task events
- [ ] `projects.handleEvent()` handles project events
- [ ] All handlers use typed event data from `sse-events.ts`
- [ ] `bunx svelte-check` passes

## Done summary
## fn-7.2: Add SSE event handlers to entity stores

### Completed
Added typed SSE event handler methods to all 5 entity stores:

1. **AgentStore** (`agents.svelte.ts`):
   - `handleConnected(event)` - agent:connected
   - `handleDisconnected(event)` - agent:disconnected
   - `handleReconnecting(event)` - agent:reconnecting
   - `handleUpdated(event)` - agent:updated

2. **InstanceStore** (`instances.svelte.ts`):
   - `handleCreated(event)` - instance:created
   - `handleStarted(event)` - instance:started
   - `handleStopped(event)` - instance:stopped
   - `handleSleeping(event)` - instance:sleeping
   - `handleError(event)` - instance:error
   - `handleResumed(event)` - instance:resumed
   - `handleTokenUsage(event)` - instance:token_usage
   - `handleModelChanged(event)` - instance:model-changed

3. **ProjectStore** (`projects.svelte.ts`):
   - `handleCreated(event)` - project:created
   - `handleUpdated(event)` - project:updated
   - `handleDeleted(event)` - project:deleted

4. **TaskStore** (`tasks.svelte.ts`):
   - `handleCreated(event)` - task:created
   - `handleUpdated(event)` - task:updated
   - `handleCompleted(event)` - task:completed

5. **PermissionStore** (`permissions.svelte.ts`):
   - `handleRequest(event)` - permission:request

### Files Modified
- `apps/dashboard/src/lib/stores/agents.svelte.ts`
- `apps/dashboard/src/lib/stores/instances.svelte.ts`
- `apps/dashboard/src/lib/stores/projects.svelte.ts`
- `apps/dashboard/src/lib/stores/tasks.svelte.ts`
- `apps/dashboard/src/lib/stores/permissions.svelte.ts`
- `apps/dashboard/src/lib/stores/types.ts` (added projectId, parentTaskId, updatedAt to Task)
## Evidence
- Commits:
- Tests:
- PRs:
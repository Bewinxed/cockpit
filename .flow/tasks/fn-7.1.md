# fn-7.1 Install river.ts and create SSE event type definitions

## Description

Install the river.ts package and create comprehensive TypeScript definitions for all 21 SSE event types used by the Cockpit dashboard.

## Steps

### 1. Install river.ts

```bash
cd /home/user/cockpit/apps/dashboard
bun add river.ts
```

### 2. Create SSE Event Types File

Create `apps/dashboard/src/lib/stores/sse-events.ts` with:
- All 21 event type interfaces matching hub server definitions
- `CockpitEventMap` type for river.ts schema
- Export `CockpitEventType` union type

Reference hub server types at `packages/hub-server/src/services/broadcast.ts`

### 3. Verify Types Compile

```bash
cd apps/dashboard && bunx svelte-check
```

## Files to Create/Modify

- `apps/dashboard/package.json` - Add river.ts dependency
- `apps/dashboard/src/lib/stores/sse-events.ts` - NEW: Event type definitions

## Acceptance

- [ ] river.ts is installed (`bun pm ls | grep river`)
- [ ] `sse-events.ts` created with all 21 event types
- [ ] Types match hub server definitions
- [ ] `bunx svelte-check` passes

## Done summary
## fn-7.1: Install river.ts and create SSE event type definitions

### Completed
1. Installed river.ts v1.1.6 in dashboard package
2. Created comprehensive SSE event type definitions at `apps/dashboard/src/lib/stores/sse-events.ts`
3. Re-exported all SSE types from store facade (`index.svelte.ts`)

### Files Created/Modified
- `apps/dashboard/src/lib/stores/sse-events.ts` (NEW - 361 lines)
- `apps/dashboard/src/lib/stores/index.svelte.ts` (updated exports)
- `apps/dashboard/package.json` (river.ts added)

### Types Defined
- 21 SSE event types matching `BroadcastEventType` from hub-server
- `CockpitEventMap` for river.ts type-safe event handling
- Helper types: `CockpitEventType`, `CockpitEventPayload<T>`
## Evidence
- Commits:
- Tests:
- PRs:
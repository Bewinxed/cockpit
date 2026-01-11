# Cockpit Dashboard UX Redesign Plan

> **Goal**: Transform the Cockpit dashboard from a basic CRUD interface into a polished, Linear/Notion-quality orchestration command center.

---

## Executive Summary

The current dashboard suffers from a hub-and-spoke navigation model that forces constant page loads, wastes sidebar real estate on categories instead of content, and prevents users from monitoring multiple Claude instances simultaneously. This redesign implements a master-detail layout with persistent instance list, global notification system, and split-view capabilities.

---

## Part 1: UX Problems Identified

### Critical Problems (Must Fix)

#### P1: Navigation Forces Full Page Loads
- **Current**: Click instance card → navigate to `/instances/[id]` → full page load
- **Impact**: Every context switch is disruptive; can't quickly compare instances
- **Ideal**: Click instance in sidebar → content appears in main area (no navigation)

#### P2: Sidebar Shows Categories, Not Content
- **Current**: 256px sidebar with 4 nav links (Dashboard, Projects, Instances, Agents)
- **Impact**: ~15% of screen showing ~5 items; user must navigate to see actual instances
- **Ideal**: Sidebar shows actual instances grouped by project (like Slack channels)

#### P3: Cannot Monitor Multiple Instances
- **Current**: Full-screen chat for single instance only
- **Impact**: Managing 5+ instances requires constant back-and-forth navigation
- **Ideal**: Split view, tabs, or quick-switch to monitor multiple instances

#### P4: Permission Requests Require Being on Specific Page
- **Current**: Yellow banner appears at bottom of specific instance's chat
- **Impact**: Must babysit each instance page; miss permissions on other instances
- **Ideal**: Global notification queue showing all pending permissions

### High Priority Problems

#### P5: Projects Aren't Primary Organizing Principle
- **Current**: Instances listed separately from projects; projects feel like metadata
- **Impact**: Users think "I'm working on Project X" but UI thinks "here are instances"
- **Ideal**: Sidebar groups instances under collapsible project headers

#### P6: No Quick-Switch Between Instances
- **Current**: Navigate to list, find instance, click, wait for page load
- **Impact**: Slow workflow when managing multiple active sessions
- **Ideal**: ⌘K command palette + keyboard shortcuts for instant switching

#### P7: Stats Take Prime Space But Aren't Actionable
- **Current**: 4 large stat cards dominate dashboard (running, agents, tasks, cost)
- **Impact**: Nice to glance at once, then just occupy space
- **Ideal**: Compact status bar always visible; dashboard shows actionable items

### Medium Priority Problems

#### P8: Chat Interface Wastes Horizontal Space
- **Current**: Full-width chat on wide screens
- **Impact**: Eyes must travel far; optimal reading width is 60-80 characters
- **Ideal**: Constrained chat width with metadata in side panel

#### P9: Agents Page Separate From Main Workflow
- **Current**: Dedicated `/agents` page you rarely visit after setup
- **Impact**: Disconnected from instance management
- **Ideal**: Agents visible in sidebar, expandable for details

#### P10: No Bulk Actions for Power Users
- **Current**: Single-item actions only
- **Impact**: Can't stop all instances, can't clear multiple, etc.
- **Ideal**: Multi-select with batch operations

---

## Part 2: Redesigned Architecture

### New Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Logo]  [Global Search ⌘K]                    [Notifications] [User]   │
├──────────────────┬──────────────────────────────────────────────────────┤
│                  │                                                      │
│  INSTANCES       │   MAIN WORKSPACE                                     │
│  ─────────────   │                                                      │
│  ▼ Project Alpha │   When nothing selected:                             │
│    🟢 instance-1 │     → Welcome/overview with quick actions            │
│    🟢 instance-2 │                                                      │
│  ▼ Project Beta  │   When instance selected:                            │
│    🟡 instance-3 │     → Chat interface with instance header            │
│  ▼ Unassigned    │                                                      │
│    ⚫ instance-4 │   Can split horizontally for 2 instances             │
│                  │                                                      │
│  ─────────────   │                                                      │
│  AGENTS          │                                                      │
│  🟢 macbook-pro  │                                                      │
│  🟢 linux-server │                                                      │
│                  │                                                      │
│  [+ New Instance]│                                                      │
│                  │                                                      │
├──────────────────┴──────────────────────────────────────────────────────┤
│  3 running · 1 permission pending · $4.32 today        [Theme] [v0.1.0] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Changes

1. **Master-Detail Layout**: Sidebar is persistent; main area changes based on selection
2. **Instance-First Sidebar**: Show actual instances, not navigation categories
3. **Project Grouping**: Instances grouped under collapsible project headers
4. **Agents Inline**: Agents section in sidebar, not separate page
5. **Global Status Bar**: Persistent footer with key metrics and pending actions
6. **Notification Center**: All permission requests accessible from header icon
7. **Command Palette**: ⌘K for quick navigation, actions, and search

---

## Part 3: Implementation Checklist

### Phase 1: Layout Foundation
> Rebuild the shell - new layout structure, remove old navigation

- [ ] **1.1** Create new `AppShell.svelte` component with three-column layout (sidebar, main, optional panel)
- [ ] **1.2** Create `Sidebar.svelte` with sections: Instances (grouped by project), Agents, footer actions
- [ ] **1.3** Create `StatusBar.svelte` persistent footer component
- [ ] **1.4** Create `TopBar.svelte` with search trigger, notifications, user menu
- [ ] **1.5** Update `+layout.svelte` to use new AppShell instead of current sidebar
- [ ] **1.6** Remove old navigation menu components
- [ ] **1.7** Set up CSS variables for new spacing/sizing system

### Phase 2: Sidebar - Instances Section
> The heart of the new navigation

- [ ] **2.1** Create `SidebarInstanceItem.svelte` - compact instance row with status dot, name, project color
- [ ] **2.2** Create `SidebarProjectGroup.svelte` - collapsible group header with project name, instance count
- [ ] **2.3** Create `SidebarInstanceList.svelte` - renders grouped instances with drag-to-reorder (optional)
- [ ] **2.4** Add "Unassigned" group for instances without projects
- [ ] **2.5** Implement instance selection state (highlight selected, route to main area)
- [ ] **2.6** Add context menu (right-click) with actions: Stop, Duplicate, Move to Project, Delete
- [ ] **2.7** Add "+ New Instance" button at bottom of instances section
- [ ] **2.8** Show streaming indicator on actively-responding instances

### Phase 3: Sidebar - Agents Section
> Compact agent status, no separate page needed

- [ ] **3.1** Create `SidebarAgentItem.svelte` - OS icon, hostname, status dot, instance count
- [ ] **3.2** Create `SidebarAgentList.svelte` - collapsible agents section
- [ ] **3.3** Add "Add Agent" action with setup instructions popover
- [ ] **3.4** Clicking agent filters instance list to that agent (or shows details in main)

### Phase 4: Main Workspace - No Selection State
> What users see when nothing is selected

- [ ] **4.1** Create `WorkspaceEmpty.svelte` - welcome state with quick actions
- [ ] **4.2** Show: "Select an instance or create new" message
- [ ] **4.3** Quick action buttons: New Instance, View All Instances (table), View Recent Activity
- [ ] **4.4** Optional: Show activity feed of recent events across all instances

### Phase 5: Main Workspace - Instance Selected
> The chat interface, now in context

- [ ] **5.1** Create `WorkspaceInstance.svelte` - container for selected instance
- [ ] **5.2** Create `InstanceHeader.svelte` - instance name, status, project badge, model, cost, actions
- [ ] **5.3** Migrate existing `ChatMessage.svelte`, `ChatInput.svelte`, `ToolGroup.svelte` into workspace
- [ ] **5.4** Constrain chat width to max 800px, center in workspace
- [ ] **5.5** Add instance metadata panel (collapsible right sidebar) - cwd, started time, token usage, etc.
- [ ] **5.6** Implement "Edit Message" rewind UI within new layout
- [ ] **5.7** Keep existing slash command support (`/model`, `/memory`, `/help`, etc.)

### Phase 6: Split View (Multi-Instance)
> Monitor 2 instances side-by-side

- [ ] **6.1** Add "Split View" button in instance header
- [ ] **6.2** Create `WorkspaceSplit.svelte` - horizontal split container with resizable divider
- [ ] **6.3** Allow selecting different instance in each pane
- [ ] **6.4** Support closing split (back to single instance)
- [ ] **6.5** Persist split state in localStorage

### Phase 7: Global Notifications & Permissions
> Never miss a permission request

- [ ] **7.1** Create `NotificationCenter.svelte` - dropdown from header icon
- [ ] **7.2** Create `NotificationBadge.svelte` - shows count of pending items
- [ ] **7.3** Create `PermissionNotification.svelte` - compact permission request card
- [ ] **7.4** Aggregate all `pendingPermissions` from all instances into notification center
- [ ] **7.5** Clicking notification → selects that instance AND scrolls to permission
- [ ] **7.6** Add toast notifications for new permission requests (non-blocking)
- [ ] **7.7** Keep inline permission banner in chat as well (for context)

### Phase 8: Command Palette (⌘K)
> Fast keyboard-driven navigation

- [ ] **8.1** Create `CommandPalette.svelte` - modal with search input and results
- [ ] **8.2** Register ⌘K (Ctrl+K) global shortcut to open palette
- [ ] **8.3** Implement instance search (fuzzy match by name, project, cwd)
- [ ] **8.4** Implement actions: New Instance, Stop Instance, Switch Model, etc.
- [ ] **8.5** Implement navigation: Go to Instances Table, Go to Settings, etc.
- [ ] **8.6** Show recent items at top when empty
- [ ] **8.7** Keyboard navigation: arrows to select, enter to execute, escape to close

### Phase 9: Status Bar
> Always-visible metrics

- [ ] **9.1** Create `StatusBar.svelte` with left/right sections
- [ ] **9.2** Left: running instances count, pending permissions count (clickable)
- [ ] **9.3** Right: today's cost, theme toggle, version
- [ ] **9.4** Pending permissions count clicks → opens notification center
- [ ] **9.5** Running instances count clicks → filters sidebar to running only

### Phase 10: Instances Table View (Optional)
> For power users who want spreadsheet-like view

- [ ] **10.1** Create `InstancesTable.svelte` - full table with sortable columns
- [ ] **10.2** Columns: Status, Name, Project, Agent, Model, Cost, Last Activity
- [ ] **10.3** Multi-select with checkboxes
- [ ] **10.4** Bulk actions: Stop Selected, Delete Selected, Move to Project
- [ ] **10.5** Access via Command Palette or "+ View All" in sidebar

### Phase 11: Visual Polish
> Make it feel like Linear/Notion quality

- [ ] **11.1** Reset app.css, establish new design tokens (spacing, colors, typography)
- [ ] **11.2** Implement smooth transitions for sidebar selection, split view resize
- [ ] **11.3** Add subtle hover states and focus rings throughout
- [ ] **11.4** Ensure dark/light theme both look polished
- [ ] **11.5** Add loading skeletons for async content
- [ ] **11.6** Implement empty states with helpful illustrations/icons
- [ ] **11.7** Ensure responsive behavior (collapse sidebar on mobile)

### Phase 12: Cleanup & Migration
> Remove old code, update routes

- [ ] **12.1** Remove old `/instances` list page (replaced by sidebar)
- [ ] **12.2** Remove old `/agents` page (replaced by sidebar section)
- [ ] **12.3** Remove old dashboard stats cards (replaced by status bar)
- [ ] **12.4** Update `/instances/[id]` to redirect to root with instance selected
- [ ] **12.5** Remove old navigation menu components
- [ ] **12.6** Update any remaining page routes to work with new layout
- [ ] **12.7** Clean up unused CSS and components

---

## Part 4: Critical Files to Modify

### Layout & Shell
- `apps/dashboard/src/routes/+layout.svelte` - Replace entire layout
- `apps/dashboard/src/app.css` - Reset and rebuild styles

### New Components to Create
```
apps/dashboard/src/lib/components/
├── shell/
│   ├── AppShell.svelte
│   ├── Sidebar.svelte
│   ├── TopBar.svelte
│   └── StatusBar.svelte
├── sidebar/
│   ├── SidebarInstanceList.svelte
│   ├── SidebarInstanceItem.svelte
│   ├── SidebarProjectGroup.svelte
│   ├── SidebarAgentList.svelte
│   └── SidebarAgentItem.svelte
├── workspace/
│   ├── WorkspaceEmpty.svelte
│   ├── WorkspaceInstance.svelte
│   ├── WorkspaceSplit.svelte
│   └── InstanceHeader.svelte
├── notifications/
│   ├── NotificationCenter.svelte
│   ├── NotificationBadge.svelte
│   └── PermissionNotification.svelte
└── command-palette/
    └── CommandPalette.svelte
```

### Existing Components to Migrate/Modify
- `apps/dashboard/src/lib/components/features/ChatMessage.svelte` - Keep, integrate into WorkspaceInstance
- `apps/dashboard/src/lib/components/features/ChatInput.svelte` - Keep, integrate into WorkspaceInstance
- `apps/dashboard/src/lib/components/features/ToolGroup.svelte` - Keep as-is
- `apps/dashboard/src/lib/components/features/PermissionRequest.svelte` - Adapt for notification center

### Routes to Modify/Remove
- `apps/dashboard/src/routes/+page.svelte` - Becomes workspace empty state
- `apps/dashboard/src/routes/instances/+page.svelte` - Remove (sidebar replaces)
- `apps/dashboard/src/routes/instances/[id]/+page.svelte` - Migrate logic to WorkspaceInstance
- `apps/dashboard/src/routes/agents/+page.svelte` - Remove (sidebar replaces)

### State Management
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` - Add: selectedInstanceId, splitViewState, notificationCenterOpen

---

## Part 5: Design Specifications

### Spacing System
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;
--space-8: 32px;
```

### Sidebar Dimensions
- Width: 260px (collapsible to 48px icons-only on mobile)
- Instance item height: 36px
- Project group header height: 32px
- Section gap: 16px

### Main Workspace
- Max chat width: 800px
- Padding: 24px
- Instance header height: 56px

### Status Bar
- Height: 36px
- Padding: 0 16px

### Colors (Using existing Flexoki as base, can evolve)
- Selection: `var(--primary)` with 10% opacity background
- Hover: `var(--secondary)`
- Status dots: green (running), yellow (starting/reconnecting), red (error), gray (stopped)

---

## Part 6: Acceptance Criteria

### Must Have (MVP)
- [ ] Sidebar shows all instances grouped by project
- [ ] Clicking instance shows chat in main area (no page navigation)
- [ ] Status bar shows running count and cost
- [ ] Permission requests visible in notification center
- [ ] ⌘K command palette for quick navigation

### Should Have
- [ ] Split view for 2 instances
- [ ] Agents visible in sidebar
- [ ] Context menus for instance actions

### Nice to Have
- [ ] Instances table view with multi-select
- [ ] Drag-to-reorder instances
- [ ] Saved views/filters

---

## Part 7: State Management Details

### New Stores to Add to `realtime.svelte.ts`

```typescript
// ============================================
// UI STATE STORES (add to realtime.svelte.ts)
// ============================================

// Currently selected instance ID (null = no selection, show welcome)
export const selectedInstanceId: Writable<string | null> = writable(null);

// Split view state
export interface SplitViewState {
  enabled: boolean;
  secondInstanceId: string | null;
  splitRatio: number; // 0.5 = 50/50, 0.3 = 30/70, etc.
}
export const splitViewState: Writable<SplitViewState> = writable({
  enabled: false,
  secondInstanceId: null,
  splitRatio: 0.5,
});

// Notification center open state
export const notificationCenterOpen: Writable<boolean> = writable(false);

// Command palette open state
export const commandPaletteOpen: Writable<boolean> = writable(false);

// Sidebar collapsed state (for mobile/responsive)
export const sidebarCollapsed: Writable<boolean> = writable(false);

// Sidebar filter state
export type SidebarFilter = 'all' | 'running' | 'stopped' | 'agent';
export interface SidebarFilterState {
  type: SidebarFilter;
  agentId?: string; // Only used when type === 'agent'
}
export const sidebarFilter: Writable<SidebarFilterState> = writable({ type: 'all' });

// Project collapse state (which projects are expanded in sidebar)
export const collapsedProjects: Writable<Set<string>> = writable(new Set());
```

### New Derived Stores

```typescript
// ============================================
// DERIVED STORES FOR SIDEBAR
// ============================================

// Instances grouped by project for sidebar display
export interface ProjectGroup {
  project: Project | null; // null = "Unassigned"
  instances: Instance[];
  isCollapsed: boolean;
}

export const instancesByProject: Readable<ProjectGroup[]> = derived(
  [populatedInstances, projects, collapsedProjects, sidebarFilter],
  ([$instances, $projects, $collapsed, $filter]) => {
    // Apply filter first
    let filtered = $instances;
    if ($filter.type === 'running') {
      filtered = $instances.filter(i => i.status === 'running' || i.status === 'starting');
    } else if ($filter.type === 'stopped') {
      filtered = $instances.filter(i => i.status === 'stopped' || i.status === 'sleeping');
    } else if ($filter.type === 'agent' && $filter.agentId) {
      filtered = $instances.filter(i => i.machineId === $filter.agentId);
    }

    // Group by project
    const groups = new Map<string | null, Instance[]>();

    for (const instance of filtered) {
      const key = instance.projectId || null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(instance);
    }

    // Convert to array and sort
    const result: ProjectGroup[] = [];

    // Projects first (sorted by name)
    const sortedProjects = Array.from($projects.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const project of sortedProjects) {
      const instances = groups.get(project.id) || [];
      if (instances.length > 0) {
        result.push({
          project,
          instances: instances.sort((a, b) =>
            new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
          ),
          isCollapsed: $collapsed.has(project.id),
        });
      }
    }

    // Unassigned last
    const unassigned = groups.get(null) || [];
    if (unassigned.length > 0) {
      result.push({
        project: null,
        instances: unassigned.sort((a, b) =>
          new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
        ),
        isCollapsed: $collapsed.has('__unassigned__'),
      });
    }

    return result;
  }
);

// Selected instance object (resolved from ID)
export const selectedInstance: Readable<Instance | null> = derived(
  [selectedInstanceId, instances],
  ([$id, $instances]) => $id ? $instances.get($id) || null : null
);

// All pending permissions across all instances
export const allPendingPermissions: Readable<PermissionRequest[]> = derived(
  pendingPermissions,
  ($permissions) => Array.from($permissions.values())
    .sort((a, b) => b.createdAt - a.createdAt) // Newest first
);

// Count of pending permissions (for badge)
export const pendingPermissionCount: Readable<number> = derived(
  pendingPermissions,
  ($permissions) => $permissions.size
);
```

### Helper Functions for UI State

```typescript
// ============================================
// UI STATE ACTIONS
// ============================================

// Select an instance (and optionally navigate)
export function selectInstance(instanceId: string | null): void {
  selectedInstanceId.set(instanceId);
  // Close split view if selecting null
  if (!instanceId) {
    splitViewState.update(s => ({ ...s, enabled: false, secondInstanceId: null }));
  }
}

// Toggle project collapse in sidebar
export function toggleProjectCollapse(projectId: string | null): void {
  const key = projectId || '__unassigned__';
  collapsedProjects.update(set => {
    const newSet = new Set(set);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    return newSet;
  });
}

// Enable split view with second instance
export function enableSplitView(secondInstanceId: string): void {
  splitViewState.set({
    enabled: true,
    secondInstanceId,
    splitRatio: 0.5,
  });
}

// Disable split view
export function disableSplitView(): void {
  splitViewState.set({
    enabled: false,
    secondInstanceId: null,
    splitRatio: 0.5,
  });
}

// Toggle notification center
export function toggleNotificationCenter(): void {
  notificationCenterOpen.update(v => !v);
}

// Toggle command palette
export function toggleCommandPalette(): void {
  commandPaletteOpen.update(v => !v);
}

// Set sidebar filter
export function setSidebarFilter(filter: SidebarFilterState): void {
  sidebarFilter.set(filter);
}
```

### localStorage Persistence

```typescript
// ============================================
// PERSISTENCE (add to +layout.svelte onMount)
// ============================================

// In +layout.svelte onMount:
onMount(() => {
  // Restore UI state from localStorage
  const savedInstanceId = localStorage.getItem('cockpit:selectedInstanceId');
  if (savedInstanceId) {
    selectedInstanceId.set(savedInstanceId);
  }

  const savedSplitView = localStorage.getItem('cockpit:splitViewState');
  if (savedSplitView) {
    try {
      splitViewState.set(JSON.parse(savedSplitView));
    } catch {}
  }

  const savedCollapsed = localStorage.getItem('cockpit:collapsedProjects');
  if (savedCollapsed) {
    try {
      collapsedProjects.set(new Set(JSON.parse(savedCollapsed)));
    } catch {}
  }

  // Subscribe to changes and persist
  const unsubs = [
    selectedInstanceId.subscribe(v => {
      if (v) localStorage.setItem('cockpit:selectedInstanceId', v);
      else localStorage.removeItem('cockpit:selectedInstanceId');
    }),
    splitViewState.subscribe(v => {
      localStorage.setItem('cockpit:splitViewState', JSON.stringify(v));
    }),
    collapsedProjects.subscribe(v => {
      localStorage.setItem('cockpit:collapsedProjects', JSON.stringify([...v]));
    }),
  ];

  return () => unsubs.forEach(u => u());
});
```

---

## Part 8: Routing & Navigation Logic

### URL Strategy: VSCode-Style Tabs with Query Parameters

**Design Goals:**
1. Multiple instances open simultaneously (like VSCode tabs)
2. All open tabs receive live SSE updates (all stay mounted)
3. SSR loads data for all open tabs via remote functions
4. Shareable URLs that preserve tab state
5. No state loss when switching tabs

**URL Schema:**
```
/?tabs=abc123,def456,ghi789&active=def456
  ↑ all open instance IDs      ↑ currently visible tab
```

**Behavior:**
- Click sidebar item → Opens in current tab (replaces active)
- Cmd+Click sidebar → Opens in new tab
- Click tab → Switches active tab
- Close tab (×) → Removes from tabs, activates adjacent
- Empty tabs → Shows welcome/empty state

### URL Sync Implementation

```typescript
// ============================================
// FILE: apps/dashboard/src/lib/stores/url-sync.svelte.ts
// ============================================

import { page } from '$app/state';
import { goto } from '$app/navigation';

// Parse tabs from URL
export function getTabsFromUrl(): { tabs: string[]; activeId: string | null } {
  const url = page.url;
  const tabsParam = url.searchParams.get('tabs');
  const tabs = tabsParam ? tabsParam.split(',').filter(Boolean) : [];
  const activeId = url.searchParams.get('active') ?? tabs[0] ?? null;
  return { tabs, activeId };
}

// Navigate to instance - opens in current tab or new tab
export function openInstance(instanceId: string, newTab = false): void {
  const { tabs, activeId } = getTabsFromUrl();

  let newTabs: string[];
  let newActiveId: string;

  if (newTab || tabs.length === 0) {
    // Add new tab if not already open
    newTabs = tabs.includes(instanceId) ? tabs : [...tabs, instanceId];
    newActiveId = instanceId;
  } else {
    // Replace current active tab
    const activeIndex = tabs.indexOf(activeId!);
    if (activeIndex >= 0) {
      newTabs = [...tabs];
      newTabs[activeIndex] = instanceId;
    } else {
      newTabs = [...tabs, instanceId];
    }
    newActiveId = instanceId;
  }

  updateTabsUrl(newTabs, newActiveId);
}

// Switch to a tab
export function switchToTab(instanceId: string): void {
  const { tabs } = getTabsFromUrl();
  if (tabs.includes(instanceId)) {
    updateTabsUrl(tabs, instanceId);
  }
}

// Close a tab
export function closeTab(instanceId: string): void {
  const { tabs, activeId } = getTabsFromUrl();
  const newTabs = tabs.filter(id => id !== instanceId);

  let newActiveId: string | null = activeId;
  if (activeId === instanceId) {
    // Activate adjacent tab
    const closedIndex = tabs.indexOf(instanceId);
    newActiveId = newTabs[Math.min(closedIndex, newTabs.length - 1)] ?? null;
  }

  updateTabsUrl(newTabs, newActiveId);
}

// Update URL with new tabs state
function updateTabsUrl(tabs: string[], activeId: string | null): void {
  const url = new URL(window.location.href);

  if (tabs.length > 0) {
    url.searchParams.set('tabs', tabs.join(','));
    if (activeId) {
      url.searchParams.set('active', activeId);
    } else {
      url.searchParams.delete('active');
    }
  } else {
    url.searchParams.delete('tabs');
    url.searchParams.delete('active');
  }

  goto(url.pathname + url.search, { replaceState: false, noScroll: true });
}
```

### Workspace Tabs Component

```svelte
<!-- apps/dashboard/src/lib/components/workspace/WorkspaceTabs.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  import { X } from 'lucide-svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { getInstance, getInstanceMessages } from '$lib/data.remote';
  import { switchToTab, closeTab } from '$lib/stores/url-sync.svelte';
  import InstanceView from './InstanceView.svelte';
  import WorkspaceEmpty from './WorkspaceEmpty.svelte';

  // Parse tabs from URL reactively
  const tabsParam = $derived(page.url.searchParams.get('tabs'));
  const tabIds = $derived(tabsParam ? tabsParam.split(',').filter(Boolean) : []);
  const activeId = $derived(page.url.searchParams.get('active') ?? tabIds[0] ?? null);
</script>

{#if tabIds.length === 0}
  <WorkspaceEmpty />
{:else}
  <Tabs.Root value={activeId} onValueChange={switchToTab}>
    <Tabs.List>
      {#each tabIds as id (id)}
        <Tabs.Trigger value={id} class="group">
          <span class="truncate max-w-32">{id}</span>
          <button
            class="ml-1 opacity-0 group-hover:opacity-100"
            onclick={(e) => { e.stopPropagation(); closeTab(id); }}
          >
            <X class="size-3" />
          </button>
        </Tabs.Trigger>
      {/each}
    </Tabs.List>

    {#each tabIds as id (id)}
      <!-- Each tab loads its own data via remote functions (SSR) -->
      <!-- All tabs stay mounted for live updates -->
      <Tabs.Content value={id} class="flex-1" forceMount>
        <div class:hidden={id !== activeId} class="h-full">
          <InstanceView instanceId={id} />
        </div>
      </Tabs.Content>
    {/each}
  </Tabs.Root>
{/if}
```

### Sidebar Click Behavior

```svelte
<!-- In SidebarInstanceItem.svelte -->
<script lang="ts">
  import { openInstance } from '$lib/stores/url-sync.svelte';

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    // Cmd+Click (Mac) or Ctrl+Click (Windows) opens new tab
    const newTab = e.metaKey || e.ctrlKey;
    openInstance(instance.id, newTab);
  }
</script>

<a href="/?tabs={instance.id}&active={instance.id}" onclick={handleClick}>
  ...
</a>
```

### Keyboard Navigation

```typescript
// ============================================
// FILE: apps/dashboard/src/lib/stores/keyboard.svelte.ts
// ============================================

import { navigateToInstance } from './url-sync.svelte';
import {
  toggleCommandPalette,
  toggleNotificationCenter,
  populatedInstances,
  selectedInstanceId,
  runningInstances
} from './realtime.svelte';
import { get } from 'svelte/store';

export function initKeyboardShortcuts(): () => void {
  function handleKeydown(e: KeyboardEvent) {
    // Ignore if in input/textarea
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    const isMac = navigator.platform.includes('Mac');
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;

    // ⌘K - Command palette
    if (cmdKey && e.key === 'k') {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }

    // ⌘N - New instance
    if (cmdKey && e.key === 'n') {
      e.preventDefault();
      // Dispatch custom event for new instance modal
      window.dispatchEvent(new CustomEvent('cockpit:new-instance'));
      return;
    }

    // Escape - Clear selection / close modals
    if (e.key === 'Escape') {
      navigateToInstance(null);
      return;
    }

    // ↑↓ - Navigate instances (when not in input)
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const instances = get(populatedInstances);
      const currentId = get(selectedInstanceId);

      if (instances.length === 0) return;

      const currentIndex = currentId
        ? instances.findIndex(i => i.id === currentId)
        : -1;

      let newIndex: number;
      if (e.key === 'ArrowDown') {
        newIndex = currentIndex < instances.length - 1 ? currentIndex + 1 : 0;
      } else {
        newIndex = currentIndex > 0 ? currentIndex - 1 : instances.length - 1;
      }

      navigateToInstance(instances[newIndex].id, true);
      return;
    }

    // 1-9 - Quick switch to running instance by index
    if (e.key >= '1' && e.key <= '9' && !cmdKey && !e.altKey) {
      const index = parseInt(e.key) - 1;
      const running = get(runningInstances);
      if (running[index]) {
        navigateToInstance(running[index].id, true);
      }
      return;
    }
  }

  window.addEventListener('keydown', handleKeydown);
  return () => window.removeEventListener('keydown', handleKeydown);
}
```

### Route Redirects

```typescript
// ============================================
// FILE: apps/dashboard/src/routes/instances/[id]/+page.server.ts
// Redirect old URLs to new format
// ============================================

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  // Redirect /instances/abc123 → /?instance=abc123
  throw redirect(301, `/?instance=${params.id}`);
};
```

```typescript
// ============================================
// FILE: apps/dashboard/src/routes/instances/+page.server.ts
// Redirect /instances to root
// ============================================

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(301, '/');
};
```

---

## Part 9: Component Code Examples

### AppShell.svelte (Main Layout Container)

```svelte
<!-- apps/dashboard/src/lib/components/shell/AppShell.svelte -->
<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import WorkspaceEmpty from '../workspace/WorkspaceEmpty.svelte';
  import WorkspaceInstance from '../workspace/WorkspaceInstance.svelte';
  import WorkspaceSplit from '../workspace/WorkspaceSplit.svelte';
  import CommandPalette from '../command-palette/CommandPalette.svelte';
  import NotificationCenter from '../notifications/NotificationCenter.svelte';
  import {
    selectedInstanceId,
    splitViewState,
    commandPaletteOpen,
    notificationCenterOpen,
    sidebarCollapsed
  } from '$lib/stores/realtime.svelte';
</script>

<div class="h-screen flex flex-col bg-background overflow-hidden">
  <!-- Top Bar -->
  <TopBar />

  <div class="flex-1 flex overflow-hidden">
    <!-- Sidebar -->
    <Sidebar collapsed={$sidebarCollapsed} />

    <!-- Main Workspace -->
    <main class="flex-1 flex flex-col overflow-hidden">
      {#if $splitViewState.enabled && $splitViewState.secondInstanceId}
        <WorkspaceSplit
          primaryInstanceId={$selectedInstanceId}
          secondaryInstanceId={$splitViewState.secondInstanceId}
          splitRatio={$splitViewState.splitRatio}
        />
      {:else if $selectedInstanceId}
        <WorkspaceInstance instanceId={$selectedInstanceId} />
      {:else}
        <WorkspaceEmpty />
      {/if}
    </main>
  </div>

  <!-- Status Bar -->
  <StatusBar />

  <!-- Overlays -->
  {#if $commandPaletteOpen}
    <CommandPalette />
  {/if}

  {#if $notificationCenterOpen}
    <NotificationCenter />
  {/if}
</div>
```

### Sidebar.svelte (Instance-First Navigation)

```svelte
<!-- apps/dashboard/src/lib/components/shell/Sidebar.svelte -->
<script lang="ts">
  import { Plus, ChevronDown, ChevronRight, Server } from 'lucide-svelte';
  import SidebarInstanceItem from '../sidebar/SidebarInstanceItem.svelte';
  import SidebarAgentItem from '../sidebar/SidebarAgentItem.svelte';
  import {
    instancesByProject,
    agents,
    selectedInstanceId,
    toggleProjectCollapse,
    stats
  } from '$lib/stores/realtime.svelte';
  import { navigateToInstance } from '$lib/stores/url-sync.svelte';

  interface Props {
    collapsed?: boolean;
  }

  let { collapsed = false }: Props = $props();
  let showNewInstanceModal = $state(false);
</script>

<aside
  class="h-full flex flex-col border-r border-border bg-card transition-all duration-200"
  class:w-64={!collapsed}
  class:w-12={collapsed}
>
  <!-- Logo -->
  <div class="h-12 flex items-center px-4 border-b border-border">
    {#if !collapsed}
      <span class="font-semibold text-foreground">Cockpit</span>
    {:else}
      <span class="font-bold text-foreground">C</span>
    {/if}
  </div>

  <!-- Scrollable Content -->
  <div class="flex-1 overflow-y-auto py-2">
    <!-- Instances Section -->
    <div class="px-2">
      {#if !collapsed}
        <div class="flex items-center justify-between px-2 py-1 mb-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Instances
          </span>
          <span class="text-xs text-muted-foreground">
            {$stats.runningInstances} running
          </span>
        </div>
      {/if}

      {#each $instancesByProject as group}
        <!-- Project Group Header -->
        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
          onclick={() => toggleProjectCollapse(group.project?.id || null)}
        >
          {#if group.isCollapsed}
            <ChevronRight class="w-3.5 h-3.5" />
          {:else}
            <ChevronDown class="w-3.5 h-3.5" />
          {/if}
          <span class="flex-1 text-left truncate">
            {group.project?.name || 'Unassigned'}
          </span>
          <span class="text-xs text-muted-foreground">
            {group.instances.length}
          </span>
        </button>

        <!-- Instance Items -->
        {#if !group.isCollapsed}
          <div class="ml-2 space-y-0.5">
            {#each group.instances as instance (instance.id)}
              <SidebarInstanceItem
                {instance}
                selected={$selectedInstanceId === instance.id}
                onSelect={() => navigateToInstance(instance.id, true)}
              />
            {/each}
          </div>
        {/if}
      {/each}

      <!-- New Instance Button -->
      <button
        class="w-full flex items-center gap-2 px-2 py-1.5 mt-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
        onclick={() => showNewInstanceModal = true}
      >
        <Plus class="w-4 h-4" />
        {#if !collapsed}
          <span>New Instance</span>
        {/if}
      </button>
    </div>

    <!-- Agents Section -->
    <div class="px-2 mt-4 pt-4 border-t border-border">
      {#if !collapsed}
        <div class="flex items-center justify-between px-2 py-1 mb-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Agents
          </span>
          <span class="text-xs text-muted-foreground">
            {$stats.onlineAgents} online
          </span>
        </div>
      {/if}

      {#each Array.from($agents.values()) as agent (agent.machineId)}
        <SidebarAgentItem {agent} {collapsed} />
      {/each}
    </div>
  </div>
</aside>
```

### SidebarInstanceItem.svelte (Compact Instance Row)

```svelte
<!-- apps/dashboard/src/lib/components/sidebar/SidebarInstanceItem.svelte -->
<script lang="ts">
  import type { Instance } from '$lib/stores/realtime.svelte';
  import { getStreamingState } from '$lib/stores/realtime.svelte';

  interface Props {
    instance: Instance;
    selected: boolean;
    onSelect: () => void;
  }

  let { instance, selected, onSelect }: Props = $props();

  const streamingState = getStreamingState(instance.id);

  const statusColor = $derived(() => {
    switch (instance.status) {
      case 'running': return 'bg-success';
      case 'starting': return 'bg-warning animate-pulse';
      case 'error': return 'bg-error';
      case 'sleeping': return 'bg-info';
      default: return 'bg-muted-foreground/30';
    }
  });

  // Extract short name from cwd or lastPrompt
  const displayName = $derived(() => {
    if (instance.name && instance.name !== 'Instance') {
      return instance.name.slice(0, 30);
    }
    // Fallback to last path segment of cwd
    const parts = instance.cwd.split('/');
    return parts[parts.length - 1] || 'Instance';
  });
</script>

<button
  class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-all duration-150"
  class:bg-primary={selected}
  class:text-primary-foreground={selected}
  class:text-foreground={!selected}
  class:hover:bg-accent/50={!selected}
  onclick={onSelect}
>
  <!-- Status Dot -->
  <div class="relative flex-shrink-0">
    <div class="w-2 h-2 rounded-full {statusColor()}"></div>
    {#if $streamingState?.isStreaming}
      <div class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-info rounded-full animate-ping"></div>
    {/if}
  </div>

  <!-- Instance Name -->
  <span class="flex-1 truncate text-left">
    {displayName()}
  </span>

  <!-- Cost (if running) -->
  {#if instance.status === 'running' && instance.totalCostUsd}
    <span class="text-xs opacity-60 font-mono">
      ${instance.totalCostUsd.toFixed(2)}
    </span>
  {/if}
</button>
```

### WorkspaceInstance.svelte (Chat Container)

```svelte
<!-- apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import InstanceHeader from './InstanceHeader.svelte';
  import ChatMessage from '../features/ChatMessage.svelte';
  import ChatInput from '../features/ChatInput.svelte';
  import PermissionRequest from '../features/PermissionRequest.svelte';
  import {
    instances,
    getInstanceMessages,
    getInstancePermissions,
    getStreamingState
  } from '$lib/stores/realtime.svelte';

  interface Props {
    instanceId: string;
  }

  let { instanceId }: Props = $props();

  const instance = $derived($instances.get(instanceId));
  const messages = getInstanceMessages(instanceId);
  const permissions = getInstancePermissions(instanceId);
  const streamingState = getStreamingState(instanceId);

  let messagesContainer: HTMLDivElement;
  let shouldAutoScroll = $state(true);

  // Auto-scroll to bottom on new messages
  $effect(() => {
    if (shouldAutoScroll && messagesContainer && $messages.length > 0) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
    // Auto-scroll if within 100px of bottom
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 100;
  }
</script>

<div class="flex-1 flex flex-col overflow-hidden">
  <!-- Instance Header -->
  {#if instance}
    <InstanceHeader {instance} />
  {/if}

  <!-- Messages Area -->
  <div
    class="flex-1 overflow-y-auto"
    bind:this={messagesContainer}
    onscroll={handleScroll}
  >
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {#each $messages as message, index (message.id || index)}
        <ChatMessage {message} {instanceId} {index} />
      {/each}

      <!-- Streaming Indicator -->
      {#if $streamingState?.isStreaming}
        <div class="flex items-center gap-2 text-muted-foreground">
          <div class="flex gap-1">
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" style="animation-delay: 0ms"></div>
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" style="animation-delay: 150ms"></div>
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" style="animation-delay: 300ms"></div>
          </div>
          <span class="text-sm">Claude is thinking...</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Permission Requests (above input) -->
  {#if $permissions.length > 0}
    <div class="border-t border-border bg-warning/10 p-4">
      {#each $permissions as permission (permission.requestId)}
        <PermissionRequest request={permission} {instanceId} />
      {/each}
    </div>
  {/if}

  <!-- Jump to Present Button -->
  {#if !shouldAutoScroll}
    <button
      class="absolute bottom-20 right-8 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-full shadow-lg hover:bg-primary/90 transition-colors"
      onclick={() => {
        shouldAutoScroll = true;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }}
    >
      ↓ Jump to present
    </button>
  {/if}

  <!-- Chat Input -->
  {#if instance}
    <ChatInput {instanceId} instance={instance} />
  {/if}
</div>
```

### StatusBar.svelte (Persistent Footer)

```svelte
<!-- apps/dashboard/src/lib/components/shell/StatusBar.svelte -->
<script lang="ts">
  import { Bell, Circle } from 'lucide-svelte';
  import { ThemeSwitcher } from '$lib/components/ui';
  import {
    stats,
    pendingPermissionCount,
    connectionStatus,
    toggleNotificationCenter
  } from '$lib/stores/realtime.svelte';

  const statusText = $derived(() => {
    if ($connectionStatus === 'connected') return 'Connected';
    if ($connectionStatus === 'connecting') return 'Connecting...';
    if ($connectionStatus === 'error') return 'Connection error';
    return 'Disconnected';
  });

  const statusColor = $derived(() => {
    if ($connectionStatus === 'connected') return 'text-success';
    if ($connectionStatus === 'connecting') return 'text-warning';
    if ($connectionStatus === 'error') return 'text-error';
    return 'text-muted-foreground';
  });
</script>

<footer class="h-9 flex items-center justify-between px-4 border-t border-border bg-card text-sm">
  <!-- Left: Status & Metrics -->
  <div class="flex items-center gap-4">
    <!-- Connection Status -->
    <div class="flex items-center gap-1.5 {statusColor()}">
      <Circle class="w-2 h-2 fill-current" />
      <span class="text-xs">{statusText()}</span>
    </div>

    <!-- Running Instances -->
    <span class="text-muted-foreground">
      <span class="font-medium text-foreground">{$stats.runningInstances}</span> running
    </span>

    <!-- Pending Permissions (clickable) -->
    {#if $pendingPermissionCount > 0}
      <button
        class="flex items-center gap-1.5 text-warning hover:text-warning/80 transition-colors"
        onclick={toggleNotificationCenter}
      >
        <Bell class="w-3.5 h-3.5" />
        <span>{$pendingPermissionCount} pending</span>
      </button>
    {/if}
  </div>

  <!-- Right: Cost & Settings -->
  <div class="flex items-center gap-4">
    <!-- Today's Cost -->
    <span class="text-muted-foreground font-mono text-xs">
      ${$stats.totalCostUsd.toFixed(2)} today
    </span>

    <!-- Theme Toggle -->
    <ThemeSwitcher />

    <!-- Version -->
    <span class="text-xs text-muted-foreground">v0.1.0</span>
  </div>
</footer>
```

### CommandPalette.svelte (⌘K Interface)

```svelte
<!-- apps/dashboard/src/lib/components/command-palette/CommandPalette.svelte -->
<script lang="ts">
  import { Search, Terminal, Plus, Square, Settings } from 'lucide-svelte';
  import {
    populatedInstances,
    toggleCommandPalette,
    commandPaletteOpen
  } from '$lib/stores/realtime.svelte';
  import { navigateToInstance } from '$lib/stores/url-sync.svelte';

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;

  interface CommandItem {
    id: string;
    type: 'instance' | 'action' | 'navigation';
    label: string;
    description?: string;
    icon: typeof Terminal;
    action: () => void;
  }

  const items = $derived(() => {
    const results: CommandItem[] = [];

    // Search instances
    const q = query.toLowerCase();
    for (const instance of $populatedInstances) {
      if (
        instance.name.toLowerCase().includes(q) ||
        instance.cwd.toLowerCase().includes(q) ||
        (instance.project?.toLowerCase().includes(q))
      ) {
        results.push({
          id: instance.id,
          type: 'instance',
          label: instance.name,
          description: instance.cwd,
          icon: Terminal,
          action: () => {
            navigateToInstance(instance.id, true);
            toggleCommandPalette();
          },
        });
      }
    }

    // Static actions (always shown)
    if ('new instance'.includes(q) || q === '') {
      results.push({
        id: 'new-instance',
        type: 'action',
        label: 'New Instance',
        description: 'Create a new Claude session',
        icon: Plus,
        action: () => {
          window.dispatchEvent(new CustomEvent('cockpit:new-instance'));
          toggleCommandPalette();
        },
      });
    }

    if ('stop all'.includes(q)) {
      results.push({
        id: 'stop-all',
        type: 'action',
        label: 'Stop All Instances',
        description: 'Stop all running instances',
        icon: Square,
        action: () => {
          // TODO: Implement stop all
          toggleCommandPalette();
        },
      });
    }

    return results.slice(0, 10); // Limit results
  });

  // Reset selection when query changes
  $effect(() => {
    query; // Dependency
    selectedIndex = 0;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items().length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items()[selectedIndex];
      if (item) item.action();
    } else if (e.key === 'Escape') {
      toggleCommandPalette();
    }
  }

  // Focus input on mount
  $effect(() => {
    if ($commandPaletteOpen && inputEl) {
      inputEl.focus();
    }
  });
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 bg-black/50 z-50"
  onclick={toggleCommandPalette}
  onkeydown={handleKeydown}
  role="button"
  tabindex="-1"
></div>

<!-- Palette -->
<div class="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
  <!-- Search Input -->
  <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
    <Search class="w-5 h-5 text-muted-foreground" />
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder="Search instances, actions..."
      class="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
      onkeydown={handleKeydown}
    />
    <kbd class="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">ESC</kbd>
  </div>

  <!-- Results -->
  <div class="max-h-80 overflow-y-auto">
    {#each items() as item, index (item.id)}
      {@const Icon = item.icon}
      <button
        class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
        class:bg-accent={index === selectedIndex}
        onclick={item.action}
        onmouseenter={() => selectedIndex = index}
      >
        <Icon class="w-4 h-4 text-muted-foreground" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-foreground truncate">{item.label}</div>
          {#if item.description}
            <div class="text-xs text-muted-foreground truncate">{item.description}</div>
          {/if}
        </div>
        <span class="text-xs text-muted-foreground capitalize">{item.type}</span>
      </button>
    {/each}

    {#if items().length === 0}
      <div class="px-4 py-8 text-center text-muted-foreground">
        No results for "{query}"
      </div>
    {/if}
  </div>
</div>
```

---

## Notes for Future Agents

1. **Start with Phase 1** - The layout foundation must be solid before building features on top
2. **Test incrementally** - Each phase should result in a working (if incomplete) app
3. **Preserve realtime functionality** - The SSE/WebSocket integration in realtime.svelte.ts is critical
4. **Use existing UI primitives** - bits-ui and shadcn-svelte components are already available
5. **Check LSP after each batch of edits** - Catch TypeScript errors early
6. **The chat components work well** - ChatMessage, ChatInput, ToolGroup are solid; wrap don't rewrite
7. **URL sync is crucial** - The query parameter approach enables browser back/forward without full page loads
8. **State persistence** - Use localStorage for UI state like selected instance, collapsed projects, split view
9. **Keyboard shortcuts** - Implement early; they're essential for power user experience
10. **Test on real data** - The stores expect specific shapes; ensure SSE events still populate correctly after changes

---

## CRITICAL: Svelte 5 Patterns

**ALL components and stores MUST use Svelte 5 patterns:**

- Use `$state()` instead of `let` for reactive state
- Use `$derived()` instead of `$:` reactive statements
- Use `$effect()` instead of `onMount`/`afterUpdate` for side effects
- Use `$props()` instead of `export let` for props
- Use `$bindable()` for two-way binding props
- Use `interface Props { }` with `let { prop1, prop2 }: Props = $props()`
- Use `{@render children()}` instead of `<slot />`
- Use `onclick` instead of `on:click`
- Import from `$app/state` not `$app/stores` for page state

**Example component structure:**
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SomeIcon } from 'lucide-svelte';

  interface Props {
    title: string;
    count?: number;
    children?: Snippet;
  }

  let { title, count = 0, children }: Props = $props();

  let localState = $state('');

  const derived = $derived(count * 2);

  $effect(() => {
    console.log('count changed:', count);
  });
</script>

<div onclick={() => localState = 'clicked'}>
  {title}: {derived}
  {#if children}
    {@render children()}
  {/if}
</div>
```

---

## Git Workflow

- **Commit and push after each phase completion**
- Commit message format: `feat(dashboard): <phase description>`
- Push to ensure progress is saved and can be recovered after context compaction

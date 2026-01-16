import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { SplitViewState, SidebarFilter, SidebarFilterState } from './types';

export type ViewMode = 'chat' | 'flow';

/**
 * UI store - manages UI state (selection, sidebar, split view, etc.)
 * Uses Svelte 5 reactivity primitives.
 */
class UIStore {
  // Currently selected instance ID (null = no selection, show welcome)
  selectedInstanceId = $state<string | null>(null);

  // Split view state
  splitView = $state<SplitViewState>({
    enabled: false,
    secondInstanceId: null,
    splitRatio: 0.5,
  });

  // Notification center open state
  notificationCenterOpen = $state(false);

  // Command palette open state
  commandPaletteOpen = $state(false);

  // Sidebar collapsed state (for desktop - minimizes to icons)
  sidebarCollapsed = $state(false);

  // Sidebar open state (for mobile - shows/hides overlay)
  sidebarOpen = $state(false);

  // Sidebar filter state
  sidebarFilter = $state<SidebarFilterState>({ type: 'all' });

  // Project collapse state (which projects are expanded in sidebar)
  #collapsedProjects = $state(new SvelteSet<string>());

  get collapsedProjects() {
    return this.#collapsedProjects;
  }

  // View mode per instance (flow vs chat)
  #instanceViewMode = new SvelteMap<string, ViewMode>();

  // Flow view state preservation (zoom, pan)
  #instanceFlowState = new SvelteMap<string, { zoom: number; pan: { x: number; y: number } }>();

  // ========================================
  // Instance Selection
  // ========================================

  /** Select an instance (and optionally navigate) */
  selectInstance(instanceId: string | null): void {
    this.selectedInstanceId = instanceId;
    // Close split view if selecting null
    if (!instanceId) {
      this.splitView = { enabled: false, secondInstanceId: null, splitRatio: 0.5 };
    }
  }

  // ========================================
  // Split View
  // ========================================

  /** Enable split view with second instance */
  enableSplitView(secondInstanceId: string): void {
    this.splitView = {
      enabled: true,
      secondInstanceId,
      splitRatio: 0.5,
    };
  }

  /** Disable split view */
  disableSplitView(): void {
    this.splitView = {
      enabled: false,
      secondInstanceId: null,
      splitRatio: 0.5,
    };
  }

  /** Update split ratio */
  setSplitRatio(ratio: number): void {
    this.splitView = { ...this.splitView, splitRatio: ratio };
  }

  // ========================================
  // Sidebar
  // ========================================

  /** Toggle sidebar - on mobile toggles open/close, on desktop toggles collapsed */
  toggleSidebar(): void {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      this.sidebarOpen = !this.sidebarOpen;
    } else {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    }
  }

  /** Toggle sidebar filter (clicking again returns to 'all') */
  toggleSidebarFilter(filter: SidebarFilter): void {
    if (this.sidebarFilter.type === filter) {
      this.sidebarFilter = { type: 'all' };
    } else {
      this.sidebarFilter = { type: filter };
    }
  }

  /** Set sidebar filter by agent */
  filterByAgent(agentId: string): void {
    this.sidebarFilter = { type: 'agent', agentId };
  }

  /** Clear sidebar filter */
  clearFilter(): void {
    this.sidebarFilter = { type: 'all' };
  }

  // ========================================
  // Project Collapse
  // ========================================

  /** Toggle project collapse in sidebar */
  toggleProjectCollapse(projectId: string | null): void {
    const key = projectId || '__unassigned__';
    if (this.#collapsedProjects.has(key)) {
      this.#collapsedProjects.delete(key);
    } else {
      this.#collapsedProjects.add(key);
    }
  }

  /** Check if a project is collapsed */
  isProjectCollapsed(projectId: string | null): boolean {
    const key = projectId || '__unassigned__';
    return this.#collapsedProjects.has(key);
  }

  // ========================================
  // Notification Center
  // ========================================

  /** Toggle notification center */
  toggleNotificationCenter(): void {
    this.notificationCenterOpen = !this.notificationCenterOpen;
  }

  /** Close notification center */
  closeNotificationCenter(): void {
    this.notificationCenterOpen = false;
  }

  // ========================================
  // Command Palette
  // ========================================

  /** Toggle command palette */
  toggleCommandPalette(): void {
    this.commandPaletteOpen = !this.commandPaletteOpen;
  }

  /** Close command palette */
  closeCommandPalette(): void {
    this.commandPaletteOpen = false;
  }

  // ========================================
  // Instance View Mode
  // ========================================

  /** Get view mode for an instance (defaults to 'flow') */
  getViewMode(instanceId: string): ViewMode {
    return this.#instanceViewMode.get(instanceId) ?? 'flow';
  }

  /** Set view mode for an instance */
  setViewMode(instanceId: string, mode: ViewMode): void {
    this.#instanceViewMode.set(instanceId, mode);
  }

  /** Toggle view mode between flow and chat */
  toggleViewMode(instanceId: string): void {
    const current = this.getViewMode(instanceId);
    this.setViewMode(instanceId, current === 'flow' ? 'chat' : 'flow');
  }

  /** Get saved flow state (zoom, pan) for restoration */
  getFlowState(instanceId: string): { zoom: number; pan: { x: number; y: number } } | undefined {
    return this.#instanceFlowState.get(instanceId);
  }

  /** Save flow state for later restoration */
  setFlowState(instanceId: string, state: { zoom: number; pan: { x: number; y: number } }): void {
    this.#instanceFlowState.set(instanceId, state);
  }
}

// Singleton with HMR persistence
function createUIStore(): UIStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitUIStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitUIStore;
  }
  const store = new UIStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitUIStore = store;
  return store;
}

export const ui = createUIStore();

import { goto } from '$app/navigation';

const STORAGE_KEY = 'cockpit:tabs';

/**
 * Tab store — manages open instance tabs independently of routing.
 * The active instance is determined by the current route (/instance/[id]),
 * while the tab bar tracks which instances are "open" for quick switching.
 *
 * NOTE: activeId is NOT stored here — it's derived from route params in components
 * that need it, since $app/state requires component rendering context.
 */
class TabStore {
  tabs = $state<string[]>([]);

  // ========================================
  // Tab Management
  // ========================================

  /** Open an instance — navigates to it and adds to tab bar */
  open(instanceId: string, newTab = false): void {
    // Add to tabs if not already there
    if (!this.tabs.includes(instanceId)) {
      this.tabs = [...this.tabs, instanceId];
    }
    // Navigate to the instance
    goto(`/instance/${instanceId}`);
    this.persist();
  }

  /** Switch to a tab that's already open */
  switchTo(instanceId: string): void {
    if (this.tabs.includes(instanceId)) {
      goto(`/instance/${instanceId}`);
    }
  }

  /** Close a tab. Pass activeId from route params to handle navigation correctly. */
  close(instanceId: string, activeId?: string | null): void {
    const idx = this.tabs.indexOf(instanceId);
    if (idx === -1) return;

    const newTabs = this.tabs.filter(id => id !== instanceId);
    this.tabs = newTabs;

    // If closing the active tab, navigate to adjacent or home
    if (activeId === instanceId) {
      const nextId = newTabs[Math.min(idx, newTabs.length - 1)];
      if (nextId) {
        goto(`/instance/${nextId}`);
      } else {
        goto('/');
      }
    }

    this.persist();
  }

  /** Close all tabs except the given one */
  closeOthers(instanceId: string, activeId?: string | null): void {
    this.tabs = [instanceId];
    if (activeId !== instanceId) {
      goto(`/instance/${instanceId}`);
    }
    this.persist();
  }

  /** Close all tabs */
  closeAll(): void {
    this.tabs = [];
    goto('/');
    this.persist();
  }

  /** Ensure the active instance is in the tab bar (called on route change) */
  ensureActiveInTabs(instanceId: string): void {
    if (!this.tabs.includes(instanceId)) {
      this.tabs = [...this.tabs, instanceId];
      this.persist();
    }
  }

  // ========================================
  // Persistence
  // ========================================

  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tabs));
    } catch {}
  }

  restore(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.tabs = parsed;
        }
      }
    } catch {}
  }
}

// Singleton with HMR persistence
function createTabStore(): TabStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitTabStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitTabStore;
  }
  const store = new TabStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitTabStore = store;
  return store;
}

export const tabs = createTabStore();

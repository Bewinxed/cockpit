import { page } from '$app/state';
import { goto } from '$app/navigation';

/**
 * VSCode-style tabs URL management
 * URL Schema: /?tabs=abc123,def456,ghi789&active=def456
 */

// Parse tabs from current URL
export function getTabsFromUrl(): { tabs: string[]; activeId: string | null } {
  const url = page.url;
  const tabsParam = url.searchParams.get('tabs');
  const tabs = tabsParam ? tabsParam.split(',').filter(Boolean) : [];
  const activeId = url.searchParams.get('active') ?? tabs[0] ?? null;
  return { tabs, activeId };
}

// Open instance - in current tab or new tab
export function openInstance(instanceId: string, newTab = false): void {
  const { tabs, activeId } = getTabsFromUrl();

  let newTabs: string[];
  let newActiveId: string;

  if (newTab || tabs.length === 0) {
    // Add new tab (or switch to it if already open)
    if (tabs.includes(instanceId)) {
      // Already open - just switch to it
      newTabs = tabs;
    } else {
      newTabs = [...tabs, instanceId];
    }
    newActiveId = instanceId;
  } else {
    // Replace current active tab
    const activeIndex = activeId ? tabs.indexOf(activeId) : -1;
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

// Switch to a specific tab
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
    // Closing active tab - activate adjacent
    const closedIndex = tabs.indexOf(instanceId);
    newActiveId = newTabs[Math.min(closedIndex, newTabs.length - 1)] ?? null;
  }

  updateTabsUrl(newTabs, newActiveId);
}

// Close all tabs except the given one
export function closeOtherTabs(instanceId: string): void {
  updateTabsUrl([instanceId], instanceId);
}

// Close all tabs
export function closeAllTabs(): void {
  updateTabsUrl([], null);
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

// Persist tabs to localStorage (for restoring on fresh load)
export function persistTabsToStorage(): void {
  const { tabs, activeId } = getTabsFromUrl();
  if (tabs.length > 0) {
    localStorage.setItem('cockpit:tabs', JSON.stringify({ tabs, activeId }));
  } else {
    localStorage.removeItem('cockpit:tabs');
  }
}

// Restore tabs from localStorage (if URL has no tabs)
export function restoreTabsFromStorage(): void {
  const { tabs } = getTabsFromUrl();
  if (tabs.length > 0) return; // URL already has tabs

  const stored = localStorage.getItem('cockpit:tabs');
  if (stored) {
    try {
      const { tabs: storedTabs, activeId } = JSON.parse(stored);
      if (storedTabs?.length > 0) {
        updateTabsUrl(storedTabs, activeId);
      }
    } catch {
      // Ignore parse errors
    }
  }
}

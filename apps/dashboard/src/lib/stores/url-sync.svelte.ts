import { goto } from '$app/navigation';
import { page } from '$app/state';
import { selectedInstanceId, splitViewState } from './realtime.svelte';
import { get } from 'svelte/store';

// Sync URL → Store (on page load or URL change)
// Call this from $effect in +layout.svelte
export function syncUrlToStore(): void {
  const url = page.url;
  const instanceId = url.searchParams.get('instance');
  const splitId = url.searchParams.get('split');

  selectedInstanceId.set(instanceId);

  if (splitId && instanceId) {
    splitViewState.set({
      enabled: true,
      secondInstanceId: splitId,
      splitRatio: 0.5,
    });
  } else {
    splitViewState.update(s => ({ ...s, enabled: false, secondInstanceId: null }));
  }
}

// Helper to select instance and update URL
export function navigateToInstance(instanceId: string | null, pushHistory = false): void {
  selectedInstanceId.set(instanceId);

  const url = new URL(window.location.href);
  if (instanceId) {
    url.searchParams.set('instance', instanceId);
  } else {
    url.searchParams.delete('instance');
  }
  url.searchParams.delete('split'); // Clear split on new selection

  goto(url.pathname + url.search, {
    replaceState: !pushHistory,
    noScroll: true
  });
}

// Helper to enable split view and update URL
export function navigateToSplitView(primaryId: string, secondaryId: string): void {
  selectedInstanceId.set(primaryId);
  splitViewState.set({
    enabled: true,
    secondInstanceId: secondaryId,
    splitRatio: 0.5,
  });

  const url = new URL(window.location.href);
  url.searchParams.set('instance', primaryId);
  url.searchParams.set('split', secondaryId);

  goto(url.pathname + url.search, {
    replaceState: false,
    noScroll: true
  });
}

// Close split view and update URL
export function closeSplitView(): void {
  splitViewState.set({
    enabled: false,
    secondInstanceId: null,
    splitRatio: 0.5,
  });

  const url = new URL(window.location.href);
  url.searchParams.delete('split');

  goto(url.pathname + url.search, {
    replaceState: true,
    noScroll: true
  });
}

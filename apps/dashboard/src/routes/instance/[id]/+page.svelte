<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import WorkspaceInstance from '$lib/components/workspace/WorkspaceInstance.svelte';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { getInstanceMessagesBatch } from '$lib/data.remote';

  const instanceId = $derived(page.params.id);

  // Use batched remote function for messages
  // When multiple tabs are open, all their message fetches are batched into ONE request
  const messagesQuery = $derived(instanceId ? getInstanceMessagesBatch(instanceId) : null);

  // Derived state from the remote function
  // .current: the resolved data (undefined until ready)
  // .loading: true before first result and during refreshes
  // .error: Error object if failed
  // .ready: true once current is available
  const ssrMessages = $derived(messagesQuery?.current ?? []);
  const isLoadingMessages = $derived(messagesQuery?.loading ?? false);
  const messagesError = $derived(messagesQuery?.error);

  // Log errors but don't block rendering - WebSocket will provide real-time updates
  $effect(() => {
    if (messagesError) {
      console.warn('[Instance Page] Failed to load messages via SSR:', messagesError.message);
    }
  });

  // Ensure this instance is tracked in the tab bar
  onMount(() => {
    if (instanceId) {
      tabs.ensureActiveInTabs(instanceId);
    }
  });
</script>

{#if instanceId}
  <div class="flex-1 flex flex-col overflow-hidden">
    <WorkspaceInstance {instanceId} {ssrMessages} {isLoadingMessages} />
  </div>
{/if}

<script lang="ts">
  /**
   * WorkspaceContent — renders the active tab content area.
   * Tab bar rendering has moved to HeaderBar; this component only mounts WorkspaceInstance panels.
   */
  import { page } from '$app/state';
  import { ui } from '$lib/stores';
  import WorkspaceInstance from './WorkspaceInstance.svelte';
  import WorkspaceEmpty from './WorkspaceEmpty.svelte';
  import WorkspaceSplit from './WorkspaceSplit.svelte';

  interface Props {
    onNewInstance?: () => void;
  }

  let { onNewInstance }: Props = $props();

  const tabsParam = $derived(page.url.searchParams.get('tabs'));
  const tabIds = $derived(tabsParam ? tabsParam.split(',').filter(Boolean) : []);
  const activeId = $derived(page.url.searchParams.get('active') ?? tabIds[0] ?? null);
</script>

{#if tabIds.length === 0}
  <WorkspaceEmpty {onNewInstance} />
{:else if ui.splitView.enabled && ui.splitView.secondInstanceId && activeId}
  <WorkspaceSplit
    primaryInstanceId={activeId}
    secondaryInstanceId={ui.splitView.secondInstanceId}
  />
{:else}
  <!-- All tabs stay mounted for live updates, hidden via CSS -->
  <div class="flex-1 overflow-hidden relative">
    {#each tabIds as id (id)}
      <div
        class="absolute inset-0 flex flex-col"
        class:hidden={id !== activeId}
      >
        <WorkspaceInstance instanceId={id} />
      </div>
    {/each}
  </div>
{/if}

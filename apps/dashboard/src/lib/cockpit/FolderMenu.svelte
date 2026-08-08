<script lang="ts">
  /**
   * Right-click on a folder — the rail's header and the board's group card are
   * the same directory said twice, so they answer to the same menu. What it
   * offers depends on whether the directory is registered: an ad-hoc cwd is
   * only somewhere work happens, and there is nothing to pin or to forget.
   */
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    IconChevronUp,
    IconExternal,
    IconPin,
    IconPinFilled,
    IconPlus,
    IconTrash,
  } from '$lib/icons';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { deleteProject, type ProjectRow } from './client.svelte';
  import { rail } from './rail.svelte';

  interface Props {
    /** What the reader calls this directory — the folder's own heading. */
    name: string;
    /** Set when the directory is registered; an ad-hoc cwd has none. */
    project?: ProjectRow | null;
    /** Start a session here, prefilled with this directory. */
    onnew: () => void;
    /** Shut every other folder. Only the rail has folders to shut. */
    oncollapseothers?: () => void;
    children: Snippet;
  }

  let { name, project = null, onnew, oncollapseothers, children }: Props = $props();

  const pinned = $derived(project ? rail.isPinned('project', project.id) : false);

  let confirmingForget = $state(false);
  let busy = $state(false);

  async function forget() {
    if (!project) return;
    busy = true;
    try {
      await deleteProject(project.id);
      confirmingForget = false;
    } finally {
      busy = false;
    }
  }
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class="contents">
    {@render children()}
  </ContextMenu.Trigger>

  <ContextMenu.Content>
    <ContextMenu.Item onSelect={onnew}>
      <IconPlus />
      New session here
    </ContextMenu.Item>
    {#if project}
      <ContextMenu.Item onSelect={() => goto(`/project/${project.id}`)}>
        <IconExternal />
        Open project page
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => rail.togglePin('project', project.id)}>
        {#if pinned}
          <IconPinFilled />
          Unpin from rail
        {:else}
          <IconPin />
          Pin to rail
        {/if}
      </ContextMenu.Item>
    {/if}
    {#if oncollapseothers}
      <ContextMenu.Item onSelect={oncollapseothers}>
        <IconChevronUp />
        Collapse other folders
      </ContextMenu.Item>
    {/if}

    {#if project}
      <ContextMenu.Separator />
      <ContextMenu.Item variant="destructive" onSelect={() => (confirmingForget = true)}>
        <IconTrash />
        Forget project…
      </ContextMenu.Item>
    {/if}
  </ContextMenu.Content>
</ContextMenu.Root>

<AlertDialog.Root bind:open={confirmingForget}>
  <AlertDialog.Content class="rounded-2xl shadow-xl">
    <AlertDialog.Header>
      <AlertDialog.Title>Forget {name}?</AlertDialog.Title>
      <AlertDialog.Description>
        The grouping is removed. The checkout and its sessions stay on disk.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action disabled={busy} onclick={forget}>Forget</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

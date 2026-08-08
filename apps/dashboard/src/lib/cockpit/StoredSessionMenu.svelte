<script lang="ts">
  /**
   * Right-click on a stored session, wherever one is listed. The row itself stays
   * a link — the trigger only wraps it, so it keeps its place in the tab order and
   * the context-menu key still reaches this menu from the keyboard.
   */
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import type { SDKSessionInfo } from '@cockpit/core';
  import {
    IconCopy,
    IconExternal,
    IconFork,
    IconPenLine,
    IconTrash,
  } from '$lib/icons';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { forkSession, loadCatalog, machineControl } from './client.svelte';
  import { copyToClipboard } from './copy';
  import { sessionTitle, transcriptHref } from './links';

  let {
    machineId,
    info,
    children,
  }: { machineId: string; info: SDKSessionInfo; children: Snippet } = $props();

  const href = $derived(transcriptHref(machineId, info));
  /** Every mutation names the directory the session was recorded under. */
  const where = $derived({ dir: info.cwd || undefined });

  let renaming = $state(false);
  let title = $state('');
  let confirmingDelete = $state(false);
  let busy = $state(false);

  function openRename() {
    title = sessionTitle(info);
    renaming = true;
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || busy) return;
    busy = true;
    try {
      await machineControl(machineId, 'renameSession', [info.sessionId, next, where]);
      await loadCatalog(machineId);
      renaming = false;
    } finally {
      busy = false;
    }
  }

  async function remove() {
    busy = true;
    try {
      await machineControl(machineId, 'deleteSession', [info.sessionId, where]);
      await loadCatalog(machineId);
      confirmingDelete = false;
    } finally {
      busy = false;
    }
  }

  async function fork() {
    const instanceId = forkSession({
      machineId,
      cwd: info.cwd ?? '',
      sessionId: info.sessionId,
    });
    await goto(`/session/${instanceId}`);
  }
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class="contents">
    {@render children()}
  </ContextMenu.Trigger>

  <ContextMenu.Content>
    <ContextMenu.Item onSelect={() => goto(href)}>
      <IconExternal />
      Open
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => window.open(href, '_blank', 'noopener')}>
      <IconExternal />
      Open in new tab
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={fork}>
      <IconFork />
      Fork from here
    </ContextMenu.Item>

    <ContextMenu.Separator />

    <ContextMenu.Item onSelect={openRename}>
      <IconPenLine />
      Rename…
    </ContextMenu.Item>
    <ContextMenu.Item
      disabled={!info.cwd}
      onSelect={() => copyToClipboard('Path', info.cwd ?? '')}
    >
      <IconCopy />
      Copy path
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => copyToClipboard('Session id', info.sessionId)}>
      <IconCopy />
      Copy session id
    </ContextMenu.Item>

    <ContextMenu.Separator />

    <ContextMenu.Item variant="destructive" onSelect={() => (confirmingDelete = true)}>
      <IconTrash />
      Delete transcript
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>

<Dialog.Root bind:open={renaming}>
  <Dialog.Content>
    <form class="grid gap-6" onsubmit={rename}>
      <Dialog.Header>
        <Dialog.Title>Rename session</Dialog.Title>
        <Dialog.Description>
          What this session is called in your history. It does not change the transcript.
        </Dialog.Description>
      </Dialog.Header>
      <!-- First tabbable thing in the dialog, so it is what opens focused. -->
      <Input bind:value={title} aria-label="Session title" autocomplete="off" />
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (renaming = false)}>Cancel</Button>
        <Button type="submit" disabled={busy || !title.trim()}>Rename</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmingDelete}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this transcript?</AlertDialog.Title>
      <AlertDialog.Description>
        “{sessionTitle(info)}” is removed from {info.cwd || 'this machine'}, for good. Nothing else
        on the machine is touched.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" disabled={busy} onclick={remove}>
        Delete transcript
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

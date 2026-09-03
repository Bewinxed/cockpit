<script lang="ts">
  /**
   * Right-click on a running session or a side quest. Keep and Discard are what a
   * side quest is waiting on, so they only appear on one (NEW.md §1).
   */
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import {
    IconCheck,
    IconCopy,
    IconExternal,
    IconFolder,
    IconPin,
    IconPinFilled,
    IconStop,
    IconTrash,
  } from "$lib/icons";
  import {
    discardSession,
    type InstanceRow,
    keepSession,
    stopSession,
  } from "./client.svelte";
  import { confirm } from "./confirm.svelte";
  import { copyToClipboard } from "./copy";
  import { rail } from "./rail.svelte";

  interface Props {
    children: Snippet;
    instance: InstanceRow;
    /**
     * Set only where the rail has flattened this session's directory out of
     * its folder — the way back. A row drawn inside a folder is already
     * grouped, and offering it the verb would say nothing.
     */
    ongroup?: () => void;
  }

  let { instance, ongroup, children }: Props = $props();

  const href = $derived(`/session/${instance.id}`);
  const scratch = $derived(instance.kind === "scratch");
  const pinned = $derived(rail.isPinned("session", instance.id));

  let _busy = $state(false);

  async function askDiscard() {
    const ok = await confirm({
      title: "Discard this side quest?",
      body: "The session stops, and whatever the spawn created for it — its worktree, its transcript — goes with it, for good.",
      confirmLabel: "Discard side quest",
      destructive: true,
    });
    if (!ok) {
      return;
    }
    _busy = true;
    try {
      await discardSession(instance.id, instance.machineId);
    } finally {
      _busy = false;
    }
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
    <ContextMenu.Item
      onSelect={() => stopSession(instance.id, instance.machineId)}
    >
      <IconStop />
      Stop
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => rail.togglePin('session', instance.id)}>
      {#if pinned}
        <IconPinFilled />
        Unpin from rail
      {:else}
        <IconPin />
        Pin to rail
      {/if}
    </ContextMenu.Item>
    {#if ongroup}
      <ContextMenu.Item onSelect={ongroup}>
        <IconFolder />
        Group into folder
      </ContextMenu.Item>
    {/if}

    {#if scratch}
      <ContextMenu.Separator />
      <ContextMenu.Item onSelect={() => keepSession(instance.id)}>
        <IconCheck />
        Keep
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={askDiscard} variant="destructive">
        <IconTrash />
        Discard
      </ContextMenu.Item>
    {/if}

    <ContextMenu.Separator />

    <ContextMenu.Item
      disabled={!instance.cwd}
      onSelect={() => copyToClipboard('Path', instance.cwd)}
    >
      <IconCopy />
      Copy path
    </ContextMenu.Item>
    <ContextMenu.Item
      onSelect={() => copyToClipboard('Session id', instance.id)}
    >
      <IconCopy />
      Copy id
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>

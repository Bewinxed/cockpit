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
    IconAlignLeft,
    IconChevronUp,
    IconExternal,
    IconPalette,
    IconPin,
    IconPinFilled,
    IconPlus,
    IconTrash,
  } from '$lib/icons';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { deleteProject, type ProjectRow } from './client.svelte';
  import { FOLDER_MARKS, folderPrefs, identityVar } from './folder-prefs.svelte';
  import { HUES } from './identity';
  import { rail } from './rail.svelte';

  interface Props {
    /** What the reader calls this directory — the folder's own heading. */
    name: string;
    /** The directory itself: what every preference here is keyed by. */
    cwd: string;
    /** Set when the directory is registered; an ad-hoc cwd has none. */
    project?: ProjectRow | null;
    /** Start a session here, prefilled with this directory. */
    onnew: () => void;
    /** Flatten this folder's sessions into plain rows. Rail only. */
    onungroup?: () => void;
    /** Shut every other folder. Only the rail has folders to shut. */
    oncollapseothers?: () => void;
    children: Snippet;
  }

  let {
    name,
    cwd,
    project = null,
    onnew,
    onungroup,
    oncollapseothers,
    children,
  }: Props = $props();

  const pickedHue = $derived(folderPrefs.chosenHue(cwd));
  const pickedMark = $derived(folderPrefs.chosenMark(cwd));

  /** A swatch shows the colour it would apply, at the ink lightness it lands on. */
  const swatch = (hue: number) => `background: oklch(0.58 0.12 ${hue})`;

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
    {#if onungroup}
      <ContextMenu.Item onSelect={onungroup}>
        <IconAlignLeft />
        Ungroup folder
      </ContextMenu.Item>
    {/if}

    <!-- A submenu rather than a dialog: the panel stays beside the folder it
         is about, and a colour picked with the folder out of sight is a colour
         picked blind. It also stays open, so hue and mark are one visit. -->
    <ContextMenu.Sub>
      <!-- The kit's sub-trigger is the one menu row without the item's gap. -->
      <ContextMenu.SubTrigger class="gap-2.5">
        <IconPalette class="size-4" />
        Customize
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent class="w-64 rounded-2xl p-3 shadow-xl">
        <div class="flex items-center justify-between pb-2 pl-1">
          <span class="text-micro font-medium text-muted-foreground">Colour</span>
          {#if pickedHue !== undefined}
            <button
              type="button"
              class="rounded-full px-2 py-0.5 text-micro text-muted-foreground
                     transition-colors duration-150 hover:bg-accent hover:text-foreground"
              onclick={() => folderPrefs.setHue(cwd, undefined)}
            >
              Auto
            </button>
          {/if}
        </div>
        <div class="grid grid-cols-6 gap-1.5">
          {#each HUES as hue (hue)}
            {@const on = folderPrefs.hue(cwd) === hue}
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full transition-colors
                     duration-150 hover:bg-accent"
              title="Hue {hue}{pickedHue === undefined && on ? ' (automatic)' : ''}"
              aria-pressed={on}
              onclick={() => folderPrefs.setHue(cwd, hue)}
            >
              <span
                class="size-5 rounded-full {on ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover' : ''}"
                style={swatch(hue)}
              ></span>
            </button>
          {/each}
        </div>

        <p class="pt-3 pb-2 pl-1 text-micro font-medium text-muted-foreground">Mark</p>
        <div class="grid grid-cols-6 gap-1.5">
          {#each FOLDER_MARKS as mark (mark.key)}
            {@const on = pickedMark === mark.key}
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-lg transition-colors
                     duration-150 hover:bg-accent {on ? 'bg-accent' : ''}"
              title={mark.label}
              aria-pressed={on}
              onclick={() => folderPrefs.setMark(cwd, mark.key)}
            >
              <mark.Icon class="identity-ink size-5" style={identityVar(cwd)} />
            </button>
          {/each}
        </div>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>

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

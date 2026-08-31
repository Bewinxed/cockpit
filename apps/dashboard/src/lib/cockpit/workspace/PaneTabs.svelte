<script lang="ts">
  /**
   * One group's tabs.
   *
   * The app used to have a single strip because there was a single place a
   * conversation could be. A group owns its own now, which is what makes a
   * split two workstations rather than one view showing two things: each half
   * has its own set of things open and its own idea of which is in front.
   *
   * Ported from the app strip: the active tab is raised off the strip and
   * carries strong ink, so the selection survives greyscale.
   */
  import { untrack } from 'svelte';
  import { IconClose } from '$lib/icons';
  import { cockpit } from '../client.svelte';
  import { resolveSessionTitle } from '../links';
  import { markHue } from '../mark';
  import HarnessGlyph from '../HarnessGlyph.svelte';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { copyToClipboard } from '../copy';
  import { workingSet } from '../working-set.svelte';
  import { workspace, urlFor, type LeafNode } from './workspace.svelte';

  let { leaf }: { leaf: LeafNode } = $props();

  interface Tab {
    id: string;
    href: string;
    label: string;
    hue: ReturnType<typeof markHue>;
    harness: string;
    named: boolean;
  }

  function resolve(id: string): Tab {
    const row = cockpit.instances.find((instance) => instance.id === id);
    const view = cockpit.session(id);
    const ctx = workingSet.contextOf(id);
    const title = row?.title;
    const firstMessage = view?.messages.find((m) => m.type === 'user' && m.content.trim())?.content;
    const named = !!title?.trim() || !!firstMessage?.trim();
    const resolved = resolveSessionTitle({
      title,
      firstMessage,
      cwd: view?.cwd || row?.cwd || ctx?.cwd,
      id,
    });
    return {
      id,
      href: urlFor(id),
      // A conversation this browser has named before keeps that name until
      // the fleet and the transcript have both answered; falling back to the
      // folder for that moment is the flash the remembered title removes.
      label: named ? resolved : (workingSet.titleOf(id) ?? resolved),
      hue: markHue(view?.cwd || row?.cwd || ctx?.cwd || id),
      harness: ctx?.harness || row?.harness || view?.harness || 'claude',
      named,
    };
  }

  const tabs = $derived(leaf.tabs.map(resolve));

  // Remember every name the strip works out, so the SERVER can draw the strip
  // with it next time — a title is mostly derived from the transcript, which a
  // render has no access to.
  $effect(() => {
    const named = tabs.filter((tab) => tab.named).map((tab) => [tab.id, tab.label] as const);
    untrack(() => {
      for (const [id, label] of named) workingSet.setTitle(id, label);
    });
  });

  /**
   * A plain left click shows the conversation without navigating. The anchor
   * keeps its `href` so middle-click still opens a window and "Copy link"
   * copies something that works; modified clicks fall through to the browser.
   */
  function show(event: MouseEvent, id: string) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    workspace.activate(id, leaf.id);
  }

  const otherLeaves = $derived(workspace.leaves.filter((other) => other.id !== leaf.id));
</script>

<div class="tabstrip" role="tablist" aria-label="Open sessions in this group">
  {#each tabs as tab (tab.id)}
    {@const active = leaf.active === tab.id}
    <ContextMenu.Root>
      <ContextMenu.Trigger class="contents">
        <div class="tab" class:on={active}>
          <a
            class="tl"
            href={tab.href}
            role="tab"
            aria-selected={active}
            title={tab.label}
            onclick={(e) => show(e, tab.id)}
          >
            <span class="tm m{tab.hue}" aria-hidden="true">
              <HarnessGlyph harness={tab.harness} />
            </span>
            <span class="nm">{tab.label}</span>
          </a>
          <button
            type="button"
            class="tclose"
            aria-label="Close {tab.label}"
            onclick={() => workspace.close(tab.id)}
          >
            <IconClose />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <!-- Every gesture has a command that does the same thing. Splitting
             and moving are reachable from here before drag-and-drop exists,
             and stay reachable for anyone not using a pointer. -->
        <ContextMenu.Item onSelect={() => workspace.split(leaf.id, 'right', tab.id)}>
          Split right
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => workspace.split(leaf.id, 'bottom', tab.id)}>
          Split down
        </ContextMenu.Item>
        {#if otherLeaves.length > 0}
          <ContextMenu.Separator />
          {#each otherLeaves as other, i (other.id)}
            <ContextMenu.Item onSelect={() => workspace.move(tab.id, other.id)}>
              Move to group {i + 2}
            </ContextMenu.Item>
          {/each}
        {/if}
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => workspace.close(tab.id)}>Close</ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => {
            for (const id of [...leaf.tabs]) if (id !== tab.id) workspace.close(id);
          }}
          disabled={leaf.tabs.length < 2}
        >
          Close others
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item
          onSelect={() => copyToClipboard('Link', new URL(tab.href, location.origin).href)}
        >
          Copy link
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  {/each}
</div>

<style>
  .tabstrip {
    display: flex;
    align-items: stretch;
    gap: 2px;
    flex-shrink: 0;
    padding: 5px var(--space-3);
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabstrip::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    min-width: 0;
    max-width: 190px;
    border-radius: var(--radius-control);
    color: var(--ink-muted);
  }
  .tab.on {
    background: var(--surface-field);
    box-shadow: var(--shadow-tile);
    color: var(--ink-strong);
  }

  .tl {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 4px var(--space-2) 4px var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: inherit;
    text-decoration: none;
  }

  .tm {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 15px;
    height: 15px;
    border-radius: var(--radius-mark);
    color: var(--ink-strong);
  }

  .nm {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tclose {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-right: 4px;
    border-radius: var(--radius-mark);
    color: var(--ink-label);
    cursor: pointer;
  }
  @media (hover: hover) and (pointer: fine) {
    .tclose:hover {
      background: var(--surface-hover);
      color: var(--ink-strong);
    }
  }
  @media (pointer: coarse) {
    .tclose {
      width: 26px;
      height: 26px;
    }
  }
</style>

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
  import { untrack } from "svelte";
  import { page } from "$app/state";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { IconClose } from "$lib/icons";
  import { whiffle } from "../client.svelte";
  import { copyToClipboard } from "../copy";
  import HarnessGlyph from "../HarnessGlyph.svelte";
  import { markHue } from "../mark";
  import { sessionName } from "../session-name";
  import { workingSet } from "../working-set.svelte";
  import { dragSession, dropHint, tabDropTarget } from "./dnd.svelte";
  import {
    contextOf,
    type LeafNode,
    urlFor,
    workspace,
  } from "./workspace.svelte";

  let { leaf }: { leaf: LeafNode } = $props();

  const servedNames = $derived(
    (page.data as { names?: Record<string, string> }).names ?? {}
  );

  interface Tab {
    harness: string;
    href: string;
    hue: ReturnType<typeof markHue>;
    id: string;
    label: string;
    named: boolean;
  }

  function resolve(id: string): Tab {
    const row = whiffle.instances.find((instance) => instance.id === id);
    const view = whiffle.session(id);
    const ctx = contextOf(id);
    const { label, named } = sessionName(id, servedNames);
    return {
      id,
      href: urlFor(id),
      label,
      hue: markHue(view?.cwd || row?.cwd || ctx?.cwd || id),
      harness: ctx?.harness || row?.harness || view?.harness || "claude",
      named,
    };
  }

  const tabs = $derived(leaf.tabs.map(resolve));

  // Remember every name the strip works out, so a tab on a conversation the
  // board no longer lists is called by its name and not eight characters of
  // its id until its transcript arrives.
  $effect(() => {
    const named = tabs
      .filter((tab) => tab.named)
      .map((tab) => [tab.id, tab.label] as const);
    untrack(() => {
      for (const [id, label] of named) {
        workingSet.setTitle(id, label);
      }
    });
  });

  /**
   * A plain left click shows the conversation without navigating. The anchor
   * keeps its `href` so middle-click still opens a window and "Copy link"
   * copies something that works; modified clicks fall through to the browser.
   */
  function show(event: MouseEvent, id: string) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    workspace.activate(id, leaf.id);
  }

  const otherLeaves = $derived(
    workspace.leaves.filter((other) => other.id !== leaf.id)
  );
</script>

<div aria-label="Open sessions in this group" class="tabstrip" role="tablist">
  {#each tabs as tab, i (tab.id)}
    {@const active = leaf.active === tab.id}
    <ContextMenu.Root>
      <ContextMenu.Trigger class="contents">
        <!-- The caret marks where the tab would land, drawn on the side the
             pointer is nearest. Graphite, like every structural mark here:
             the one loud colour belongs to a session asking for something. -->
        <div
          class="tab"
          class:drop-after={dropHint.tabIndexIn(leaf.id) === i + 1 && i === tabs.length - 1}
          class:drop-before={dropHint.tabIndexIn(leaf.id) === i}
          class:on={active}
          use:dragSession={{ sessionId: tab.id, from: leaf.id }}
          use:tabDropTarget={{ leafId: leaf.id, index: i, sessionId: tab.id }}
        >
          <a
            aria-selected={active}
            class="tl"
            draggable="false"
            href={tab.href}
            onclick={(e) => show(e, tab.id)}
            role="tab"
            title={tab.label}
          >
            <span aria-hidden="true" class="tm m{tab.hue}">
              <HarnessGlyph harness={tab.harness} />
            </span>
            <span class="nm">{tab.label}</span>
          </a>
          <button
            aria-label="Close {tab.label}"
            class="tclose"
            onclick={() => workspace.close(tab.id)}
            type="button"
          >
            <IconClose />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <!-- Every gesture has a command that does the same thing. Splitting
             and moving are reachable from here before drag-and-drop exists,
             and stay reachable for anyone not using a pointer. -->
        <ContextMenu.Item
          onSelect={() => workspace.split(leaf.id, 'right', tab.id)}
        >
          Split right
        </ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => workspace.split(leaf.id, 'bottom', tab.id)}
        >
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
        <ContextMenu.Item onSelect={() => workspace.close(tab.id)}
          >Close</ContextMenu.Item
        >
        <ContextMenu.Item
          disabled={leaf.tabs.length < 2}
          onSelect={() => {
            for (const id of [...leaf.tabs]) {
              if (id !== tab.id) {
                workspace.close(id);
              }
            }
          }}
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
  /* The strip shares the identity bar's inset, so the first tab and the
     session mark below it sit on one line. */
  .tabstrip {
    display: flex;
    align-items: stretch;
    gap: 2px;
    flex-shrink: 0;
    padding: 6px var(--space-6) 6px var(--space-7);
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    overflow-x: auto;
    scrollbar-width: thin;
  }
  @container leaf (max-width: 620px) {
    .tabstrip {
      padding-left: var(--space-4);
      padding-right: var(--space-4);
    }
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 0;
    max-width: 200px;
    height: 38px;
    padding: 0 8px 0 10px;
    border: 1px solid transparent;
    /* Concentric: the tab's own radius, less its 6px inset, is the radius of
       the mark and the close target seated inside it. */
    border-radius: var(--radius-control);
    background: var(--surface-field);
    color: var(--ink-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in);
  }
  @media (hover: hover) and (pointer: fine) {
    .tab:hover:not(.on) {
      background: var(--surface-hover);
    }
  }
  /* Where it would land. A 2px rule against the gap between tabs, so the
     answer is unambiguous about WHICH side without moving anything. */
  .tab.drop-before::before,
  .tab.drop-after::after {
    content: "";
    position: absolute;
    top: 3px;
    bottom: 3px;
    width: 2px;
    border-radius: 1px;
    background: var(--ink-strong);
  }
  .tab.drop-before::before {
    left: -2px;
  }
  .tab.drop-after::after {
    right: -2px;
  }

  /* The tab being carried recedes; it is somewhere else now. */
  :global(.tab[data-dragging]) {
    opacity: 0.4;
  }

  /* Raised surface, hairline and weight say "this one" — colour is never the
     only channel. */
  .tab.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: var(--weight-strong);
    border-color: var(--border-hairline);
    box-shadow: var(--shadow-tile);
  }

  .tl {
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: 8px;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }

  /* The 17px item mark at 14px, the same recipe the sidebar rows carry. */
  .tm {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-mark);
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .tm :global(svg) {
    width: 10px;
    height: 10px;
    display: block;
    color: var(--mark-glyph);
  }
  .tm.m2 {
    background-color: var(--mark-2);
  }
  .tm.m3 {
    background-color: var(--mark-3);
  }
  .tm.m4 {
    background-color: var(--mark-4);
  }
  .tm.m5 {
    background-color: var(--mark-5);
  }
  .tm.m6 {
    background-color: var(--mark-6);
  }
  .tm.m7 {
    background-color: var(--mark-7);
  }
  .tm.m8 {
    background-color: var(--mark-8);
  }

  .nm {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tclose {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    border: 0;
    padding: 0;
    background: none;
    border-radius: var(--radius-mark);
    color: var(--ink-muted);
    cursor: pointer;
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  .tclose :global(svg) {
    width: 11px;
    height: 11px;
    display: block;
  }
  @media (hover: hover) and (pointer: fine) {
    .tclose:hover {
      background: var(--surface-active);
      color: var(--ink-strong);
    }
  }
  .tclose:active {
    transform: scale(0.9);
  }

  .tl:focus-visible,
  .tclose:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .tab {
      height: 44px;
    }
    .tclose {
      width: 28px;
      height: 28px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tab,
    .tclose {
      transition: none;
    }
    .tclose:active {
      transform: none;
    }
  }
</style>

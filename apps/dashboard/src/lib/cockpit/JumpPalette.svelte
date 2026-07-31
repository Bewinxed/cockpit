<script lang="ts">
  /**
   * Cmd+K: everything the client already knows about, in one list you can type
   * at. It reads the store and nothing else — no endpoint exists for this.
   */
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { ACTIVITY_LABEL } from './activity';
  import { cockpit } from './client.svelte';
  import { sessionTitle, transcriptHref } from './links';

  let { onClose }: { onClose: () => void } = $props();

  interface Entry {
    id: string;
    group: string;
    label: string;
    detail: string;
    href: string;
  }

  const leaf = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

  /** How many stored sessions per machine are worth carrying into the palette. */
  const RECENT_PER_MACHINE = 8;

  const entries = $derived.by((): Entry[] => {
    const rows: Entry[] = [];
    for (const project of cockpit.projects) {
      rows.push({
        id: `project:${project.id}`,
        group: 'Projects',
        label: project.name,
        detail: project.cwd,
        href: `/project/${project.id}`,
      });
    }
    for (const machine of cockpit.onlineMachines) {
      rows.push({
        id: `machine:${machine.machineId}`,
        group: 'Machines',
        label: machine.hostname,
        detail: `${machine.os} · start a session here`,
        href: `/session?machine=${machine.machineId}`,
      });
    }
    for (const instance of cockpit.runningInstances) {
      rows.push({
        id: `live:${instance.id}`,
        group: 'Running sessions',
        label: leaf(instance.cwd) || instance.id,
        detail: `${instance.cwd || '—'} · ${ACTIVITY_LABEL[cockpit.activityOf(instance.id)]}`,
        href: `/session/${instance.id}`,
      });
    }
    for (const machine of cockpit.machines) {
      for (const info of cockpit.catalogOf(machine.machineId).slice(0, RECENT_PER_MACHINE)) {
        rows.push({
          // Two machines can report the same stored session — they share a home
          // directory when they are two daemons on one box — so both name the key.
          id: `stored:${machine.machineId}:${info.sessionId}`,
          group: 'Recent sessions',
          label: sessionTitle(info),
          detail: `${machine.hostname} · ${info.cwd ?? ''}`,
          href: transcriptHref(machine.machineId, info),
        });
      }
    }
    return rows;
  });

  /** Subsequence match, so `cokp` still finds `cockpit`. */
  function matches(haystack: string, needle: string): boolean {
    let at = 0;
    for (const char of needle) {
      const found = haystack.indexOf(char, at);
      if (found === -1) return false;
      at = found + 1;
    }
    return true;
  }

  let query = $state('');
  let selected = $state(0);

  // Filtered, never re-sorted: the natural order is what keeps the groups whole.
  const results = $derived.by((): Entry[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      matches(`${entry.label} ${entry.detail}`.toLowerCase(), needle)
    );
  });

  // The list moves under the cursor as sessions come and go, so the highlight is
  // clamped rather than tracked — an index past the end would silently do nothing.
  const active = $derived(results.length === 0 ? -1 : Math.min(selected, results.length - 1));

  let field = $state<HTMLInputElement | null>(null);
  let rows: HTMLButtonElement[] = [];

  $effect(() => {
    rows[active]?.scrollIntoView({ block: 'nearest' });
  });

  const duration = browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;

  onMount(() => {
    const previouslyFocused = document.activeElement;
    field?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  });

  async function open(entry: Entry) {
    onClose();
    await goto(entry.href);
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        selected = results.length === 0 ? 0 : (active + 1) % results.length;
        return;
      case 'ArrowUp':
        event.preventDefault();
        selected = results.length === 0 ? 0 : (active - 1 + results.length) % results.length;
        return;
      case 'Enter': {
        event.preventDefault();
        const entry = results[active];
        if (entry) void open(entry);
        return;
      }
      case 'Tab':
        // The field is the only tab stop, which is the whole trap: rows are
        // reached with the arrows, and focus cannot leave the dialog.
        event.preventDefault();
        field?.focus();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[15vh] backdrop-blur-sm"
  transition:fade={{ duration }}
  onclick={(event) => event.target === event.currentTarget && onClose()}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Jump to"
    tabindex="-1"
    class="flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    transition:scale={{ duration, start: 0.97, easing: quintOut }}
    onkeydown={onKeydown}
  >
    <input
      bind:this={field}
      bind:value={query}
      placeholder="Jump to a project, machine, or session…"
      class="border-b border-border bg-transparent px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:text-sm"
      role="combobox"
      aria-label="Jump to"
      aria-autocomplete="list"
      aria-expanded="true"
      aria-controls="jump-results"
      aria-activedescendant={active >= 0 ? `jump-result-${active}` : undefined}
      oninput={() => (selected = 0)}
    />

    <div id="jump-results" role="listbox" aria-label="Results" class="overflow-y-auto p-2">
      {#each results as entry, index (entry.id)}
        {#if index === 0 || results[index - 1].group !== entry.group}
          <p class="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            {entry.group}
          </p>
        {/if}
        <button
          bind:this={rows[index]}
          type="button"
          tabindex="-1"
          role="option"
          id="jump-result-{index}"
          aria-selected={index === active}
          class="flex w-full items-baseline gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent
            {index === active ? 'bg-accent' : ''}"
          onclick={() => open(entry)}
        >
          <span class="truncate text-sm text-foreground">{entry.label}</span>
          <span class="ml-auto truncate font-mono text-[11px] text-muted-foreground">
            {entry.detail}
          </span>
        </button>
      {:else}
        <p class="px-2.5 py-3 text-sm text-muted-foreground">Nothing matches that.</p>
      {/each}
    </div>

    <div class="flex gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
      <span><kbd class="rounded bg-accent px-1">↑↓</kbd> navigate</span>
      <span><kbd class="rounded bg-accent px-1">↵</kbd> open</span>
      <span><kbd class="rounded bg-accent px-1">esc</kbd> close</span>
    </div>
  </div>
</div>

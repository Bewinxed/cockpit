<script lang="ts">
  /** The whole chrome: wordmark, hub status, machine rail, and the route. */
  import type { Snippet } from 'svelte';
  import { fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { PanelLeft, Search, ShieldAlert } from '@lucide/svelte';
  import { afterNavigate } from '$app/navigation';
  import ThemeSwitcher from '$lib/components/ui/ThemeSwitcher.svelte';
  import { cockpit } from './client.svelte';
  import JumpPalette from './JumpPalette.svelte';
  import Sidebar from './Sidebar.svelte';

  let { children }: { children: Snippet } = $props();

  let palette = $state(false);
  /** The rail is a drawer on narrow viewports, where it would eat the transcript. */
  let rail = $state(false);

  afterNavigate(() => (rail = false));

  const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

  /** Cmd+K anywhere, except while the user is typing into something. */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
    const target = event.target;
    if (target instanceof HTMLElement && (TYPING.has(target.tagName) || target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    palette = true;
  }

  const dot = $derived(
    {
      connected: 'bg-success',
      connecting: 'bg-warning animate-pulse',
      disconnected: 'bg-muted-foreground',
      error: 'bg-error',
    }[cockpit.status]
  );

  const blocked = $derived(cockpit.blockedCount);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if palette}
  <JumpPalette onClose={() => (palette = false)} />
{/if}

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
  <a
    href="#main"
    class="sr-only rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
  >
    Skip to content
  </a>
  <header class="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
    <button
      type="button"
      class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      aria-label="Machines and sessions"
      aria-expanded={rail}
      onclick={() => (rail = !rail)}
    >
      <PanelLeft size={14} />
    </button>
    <a href="/session" class="font-mono text-sm font-semibold tracking-tight">COCKPIT</a>
    <button
      type="button"
      class="ml-auto flex min-h-6 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      title="Jump to a project, machine, or session (Cmd/Ctrl + K)"
      onclick={() => (palette = true)}
    >
      <Search size={12} />
      Jump
    </button>
    <a
      href="/session"
      class="flex min-h-6 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors {blocked >
      0
        ? 'bg-warning/10 text-warning hover:bg-warning/20'
        : 'text-muted-foreground/50 hover:text-muted-foreground'}"
      title="{blocked} session{blocked === 1 ? '' : 's'} awaiting approval"
    >
      <ShieldAlert size={12} />
      <!-- The count is the app's "what needs me" heartbeat: it pops when it
           crosses zero, and the digit re-enters when it changes. -->
      {#if blocked > 0}
        <span
          in:scale={{ duration: 260, start: 0.5, easing: quintOut }}
          out:scale={{ duration: 180, start: 0.75, easing: quintOut }}
        >
          {#key blocked}
            <span class="inline-block" in:fly={{ y: 4, duration: 150, easing: quintOut }}>
              {blocked}
            </span>
          {/key}
        </span>
      {/if}
    </a>
    <span class="flex min-h-6 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span class="size-1.5 rounded-full {dot}"></span>
      {cockpit.status}
    </span>
    <ThemeSwitcher />
  </header>

  <div class="flex min-h-0 flex-1">
    <div class="hidden md:flex">
      <Sidebar />
    </div>
    <main id="main" class="flex min-w-0 flex-1 flex-col overflow-hidden">
      {@render children()}
    </main>
  </div>
</div>

{#if rail}
  <div class="fixed inset-0 z-40 flex md:hidden">
    <button
      type="button"
      class="absolute inset-0 bg-black/40"
      aria-label="Close navigation"
      onclick={() => (rail = false)}
    ></button>
    <div class="relative flex max-w-[85vw] shadow-lg">
      <Sidebar />
    </div>
  </div>
{/if}

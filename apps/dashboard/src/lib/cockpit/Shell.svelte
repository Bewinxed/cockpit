<script lang="ts">
  /** The whole chrome: wordmark, hub status, machine rail, and the route. */
  import type { Snippet } from 'svelte';
  import { Search, ShieldAlert } from '@lucide/svelte';
  import ThemeSwitcher from '$lib/components/ui/ThemeSwitcher.svelte';
  import { cockpit } from './client.svelte';
  import JumpPalette from './JumpPalette.svelte';
  import Sidebar from './Sidebar.svelte';

  let { children }: { children: Snippet } = $props();

  let palette = $state(false);

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

<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
  <header class="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
    <a href="/session" class="font-mono text-sm font-semibold tracking-tight">COCKPIT</a>
    <button
      type="button"
      class="ml-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground"
      title="Jump to a project, machine, or session (Cmd/Ctrl + K)"
      onclick={() => (palette = true)}
    >
      <Search size={12} />
      Jump
    </button>
    <a
      href="/session"
      class="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors {blocked >
      0
        ? 'bg-warning/10 text-warning hover:bg-warning/20'
        : 'text-muted-foreground/50 hover:text-muted-foreground'}"
      title="{blocked} session{blocked === 1 ? '' : 's'} awaiting approval"
    >
      <ShieldAlert size={12} />
      {blocked}
    </a>
    <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span class="size-1.5 rounded-full {dot}"></span>
      {cockpit.status}
    </span>
    <ThemeSwitcher />
  </header>

  <div class="flex min-h-0 flex-1">
    <Sidebar />
    <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
      {@render children()}
    </main>
  </div>
</div>

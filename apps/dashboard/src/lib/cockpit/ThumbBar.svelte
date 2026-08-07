<script lang="ts">
  /**
   * The phone's bottom bar (app.html: "iPhone recomposes to sheets and a thumb
   * bar, never a shrunken desktop"). Three things a hand at the bottom of a
   * 390pt screen actually reaches for: back to the fleet, start something, find
   * something. Everything else stays where it is — this is a thumb rest, not a
   * second navigation.
   *
   * A row in the app's column rather than a fixed overlay, so nothing has to
   * reserve padding for it and the session composer sits above it, not under.
   */
  import { page } from '$app/state';
  import { IconHome, IconPlus, IconSearch } from '$lib/icons';
  import SpawnPanel from './SpawnPanel.svelte';

  let { onjump }: { onjump: () => void } = $props();

  let spawnOpen = $state(false);

  const onFleet = $derived(page.url.pathname === '/session');

  /** 44pt targets, the platform's floor for a thumb. */
  const TARGET =
    'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-micro ' +
    'transition-colors duration-150 ease-out active:bg-accent';
</script>

<nav
  class="material-chrome flex shrink-0 items-stretch gap-1 border-t border-border px-2 pt-1 md:hidden"
  style="padding-bottom: max(0.25rem, env(safe-area-inset-bottom))"
  aria-label="Quick actions"
>
  <a
    href="/session"
    class="{TARGET} {onFleet ? 'text-primary' : 'text-muted-foreground'}"
    aria-current={onFleet ? 'page' : undefined}
  >
    <IconHome class="size-5" />
    Fleet
  </a>
  <button type="button" class="{TARGET} text-muted-foreground" onclick={() => (spawnOpen = true)}>
    <IconPlus class="size-5" />
    New session
  </button>
  <button type="button" class="{TARGET} text-muted-foreground" onclick={onjump}>
    <IconSearch class="size-5" />
    Jump
  </button>
</nav>

<SpawnPanel open={spawnOpen} onclose={() => (spawnOpen = false)} />

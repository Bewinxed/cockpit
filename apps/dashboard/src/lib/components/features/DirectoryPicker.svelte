<script lang="ts">
  /** Walks a machine's filesystem over the `fs` verb so a cwd can be picked, not typed. */
  import { IconArrowUp, IconCheck, IconFolder, IconSpinner } from '$lib/icons';
  import type { FsEntry, SDKSessionInfo } from '@whiffle/core';
  import { Button } from '$lib/components/ui/button';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { whiffle, machineFs } from '$lib/whiffle/client.svelte';

  let {
    machineId,
    value,
    onSelect,
  }: { machineId: string; value: string; onSelect: (path: string) => void } = $props();

  let open = $state(false);
  let path = $state('/');
  let entries = $state<FsEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  /** Only lives while the panel is open — a directory may have changed by the next visit. */
  const cache = new Map<string, FsEntry[]>();

  const dirs = $derived(
    entries
      .filter((entry) => entry.kind === 'dir' && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  const parent = $derived(path === '/' ? null : path.replace(/\/[^/]+$/, '') || '/');

  const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);

  /** Whatever the field already says, else where this machine was working last. */
  function seed(): string {
    if (value.startsWith('/')) return trim(value);
    const recent = whiffle
      .catalogOf(machineId)
      .reduce<SDKSessionInfo | null>(
        (best, info) => (info.cwd && (!best || info.lastModified > best.lastModified) ? info : best),
        null
      );
    return trim(recent?.cwd ?? '/');
  }

  /** Typed cwds arrive with trailing slashes; `parent` and `join` assume none. */
  const trim = (path: string) => path.replace(/(?!^)\/+$/, '');

  async function go(next: string) {
    path = next;
    error = null;
    const cached = cache.get(next);
    if (cached) {
      entries = cached;
      return;
    }
    loading = true;
    try {
      const listed = await machineFs<FsEntry[]>(machineId, 'list', next);
      cache.set(next, listed);
      // A faster click already moved on; that listing wins.
      if (path !== next) return;
      entries = listed;
    } catch (err) {
      if (path !== next) return;
      entries = [];
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function collapse() {
    open = false;
    cache.clear();
  }

  function toggle() {
    if (open) {
      collapse();
      return;
    }
    open = true;
    void go(seed());
  }

  function use() {
    onSelect(path);
    collapse();
  }
</script>

<svelte:window
  onkeydown={(event: KeyboardEvent) => {
    if (open && event.key === 'Escape') collapse();
  }}
/>

<Collapsible.Root {open} onOpenChange={toggle} class="flex flex-col">
  <Collapsible.Trigger
    class="flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
  >
    <IconFolder class="size-3.5" />
    Browse
  </Collapsible.Trigger>

  <Collapsible.Content>
    <div class="mt-2 flex flex-col gap-2 border-t border-border pt-2">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Parent directory"
          disabled={!parent}
          onclick={() => parent && go(parent)}
        >
          <IconArrowUp />
        </Button>
        <span class="truncate font-mono text-xs text-muted-foreground" title={path}>{path}</span>
      </div>

      <div class="max-h-56 overflow-y-auto">
        {#if loading}
          <span class="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
            <IconSpinner class="size-3.5 animate-spin" />
            Reading directory…
          </span>
        {:else if error}
          <span class="block px-2 py-1 text-xs text-destructive">{error}</span>
        {:else}
          {#each dirs as dir (dir.name)}
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start font-mono text-[13px] font-normal"
              onclick={() => go(join(path, dir.name))}
            >
              <IconFolder class="shrink-0 opacity-70" />
              <span class="truncate">{dir.name}</span>
            </Button>
          {:else}
            <span class="block px-2 py-1 text-xs text-muted-foreground">No subdirectories.</span>
          {/each}
        {/if}
      </div>

      <div class="flex justify-end">
        <Button size="xs" onclick={use}>
          <IconCheck />
          Use this directory
        </Button>
      </div>
    </div>
  </Collapsible.Content>
</Collapsible.Root>

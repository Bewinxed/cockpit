<script lang="ts">
  /**
   * Cmd+K: everything the client already knows about, in one list you can type
   * at. It reads the store and nothing else — no endpoint exists for this.
   */
  import { goto } from '$app/navigation';
  import * as Command from '$lib/components/ui/command';
  import { Kbd } from '$lib/components/ui/kbd';
  import { ACTIVITY_LABEL } from './activity';
  import { whiffle } from './client.svelte';
  import { sessionTitle, transcriptHref } from './links';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  interface Entry {
    id: string;
    group: string;
    label: string;
    detail: string;
    href: string;
  }

  const leaf = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

  /**
   * What has been typed. Read here, not just handed to the filter, because
   * WHICH sessions are offered depends on it: a few recent ones per machine
   * when the box is empty, and every stored session on every machine the
   * moment it is not. Rendering all of them unfiltered would be a list
   * nobody asked for; searching only the newest few would be a search box
   * that cannot find things.
   */
  let query = $state('');

  /**
   * How many stored sessions each machine offers the palette when nothing has
   * been typed. Typing searches the WHOLE catalogue — a palette that can only
   * find eight per machine is a recent-list wearing a search box.
   */
  const RECENT_PER_MACHINE = 8;

  const GROUPS = ['Projects', 'Machines', 'Running sessions', 'Recent sessions'];

  const entries = $derived.by((): Entry[] => {
    const rows: Entry[] = [];
    for (const project of whiffle.projects) {
      rows.push({
        id: `project:${project.id}`,
        group: 'Projects',
        label: project.name,
        detail: project.cwd,
        href: `/project/${project.id}`,
      });
    }
    for (const machine of whiffle.onlineMachines) {
      rows.push({
        id: `machine:${machine.machineId}`,
        group: 'Machines',
        label: machine.hostname,
        detail: `${machine.os} · start a session here`,
        href: `/session?machine=${machine.machineId}`,
      });
    }
    for (const instance of whiffle.runningInstances) {
      rows.push({
        id: `live:${instance.id}`,
        group: 'Running sessions',
        label: leaf(instance.cwd) || instance.id,
        detail: `${instance.cwd || '—'} · ${ACTIVITY_LABEL[whiffle.activityOf(instance.id)]}`,
        href: `/session/${instance.id}`,
      });
    }
    for (const machine of whiffle.machines) {
      // Unfiltered, this is a landing list and stays short. The moment the
      // reader types, every stored session on every machine is in scope.
      const catalog = whiffle.catalogOf(machine.machineId);
      for (const info of query.trim() ? catalog : catalog.slice(0, RECENT_PER_MACHINE)) {
        rows.push({
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

  const grouped = $derived(
    GROUPS.map((name) => ({ name, rows: entries.filter((entry) => entry.group === name) })).filter(
      (group) => group.rows.length > 0
    )
  );

  function matches(haystack: string, needle: string): boolean {
    let at = 0;
    for (const char of needle) {
      const found = haystack.indexOf(char, at);
      if (found === -1) return false;
      at = found + 1;
    }
    return true;
  }

  function score(value: string, search: string, keywords?: string[]): number {
    const haystack = (keywords?.join(' ') ?? value).toLowerCase();
    return matches(haystack, search.trim().toLowerCase()) ? 1 : 0;
  }

  async function jump(entry: Entry) {
    open = false;
    await goto(entry.href);
  }
</script>

<Command.Dialog
  bind:open
  filter={score}
  loop
  title="Jump to"
  description="Jump to a project, machine, or session"
  class="sm:max-w-xl"
>
  <Command.Input bind:value={query} placeholder="Jump to a project, machine, or session…" />

  <Command.List class="max-h-[60vh]">
    <Command.Empty>Nothing matches that.</Command.Empty>

    {#each grouped as group (group.name)}
      <Command.Group heading={group.name}>
        {#each group.rows as entry (entry.id)}
          <Command.Item
            value={entry.id}
            keywords={[entry.label, entry.detail]}
            onSelect={() => jump(entry)}
          >
            <span class="truncate">{entry.label}</span>
            <span class="ml-auto truncate font-mono text-xs text-muted-foreground">
              {entry.detail}
            </span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/each}
  </Command.List>

  <div class="flex gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
    <span><Kbd>↑↓</Kbd> navigate</span>
    <span><Kbd>↵</Kbd> open</span>
    <span><Kbd>esc</Kbd> close</span>
  </div>
</Command.Dialog>

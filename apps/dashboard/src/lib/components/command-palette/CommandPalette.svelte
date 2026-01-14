<script lang="ts">
  import { Terminal, Plus, Square, Table } from 'lucide-svelte';
  import * as Command from '$lib/components/ui/command';
  import { stores, ui } from '$lib/stores';
  import { openInstance } from '$lib/stores/url-sync.svelte';

  let value = $state('');

  interface CommandItem {
    id: string;
    type: 'instance' | 'action' | 'navigation';
    label: string;
    description?: string;
    icon: typeof Terminal;
    action: () => void;
  }

  const items = $derived.by(() => {
    const results: CommandItem[] = [];

    // Search instances
    const q = value.toLowerCase();
    for (const instance of stores.populatedInstances) {
      const name = instance.name || '';
      const cwd = instance.cwd || '';
      const project = instance.project || '';

      if (
        name.toLowerCase().includes(q) ||
        cwd.toLowerCase().includes(q) ||
        project.toLowerCase().includes(q)
      ) {
        results.push({
          id: instance.id,
          type: 'instance',
          label: name || cwd.split('/').pop() || 'Instance',
          description: cwd,
          icon: Terminal,
          action: () => {
            openInstance(instance.id, false); // Open in current tab
            ui.toggleCommandPalette();
          },
        });
      }
    }

    // Static actions (always shown when query matches or empty)
    if ('new instance'.includes(q) || q === '') {
      results.push({
        id: 'new-instance',
        type: 'action',
        label: 'New Instance',
        description: 'Create a new Claude session',
        icon: Plus,
        action: () => {
          window.dispatchEvent(new CustomEvent('cockpit:new-instance'));
          ui.toggleCommandPalette();
        },
      });
    }

    if ('stop all'.includes(q)) {
      results.push({
        id: 'stop-all',
        type: 'action',
        label: 'Stop All Instances',
        description: 'Stop all running instances',
        icon: Square,
        action: () => {
          // TODO: Implement stop all
          ui.toggleCommandPalette();
        },
      });
    }

    if ('view all instances table'.includes(q) || q === '') {
      results.push({
        id: 'view-table',
        type: 'action',
        label: 'View All Instances',
        description: 'Open table view of all instances',
        icon: Table,
        action: () => {
          window.dispatchEvent(new CustomEvent('cockpit:show-table-view'));
          ui.toggleCommandPalette();
        },
      });
    }

    return results.slice(0, 10); // Limit results
  });
</script>

<Command.Dialog
  open={ui.commandPaletteOpen}
  onOpenChange={(open) => !open && ui.toggleCommandPalette()}
  title="Command Palette"
  description="Search instances, run actions..."
>
  <Command.Input placeholder="Search instances, actions..." bind:value />
  <Command.List>
    <Command.Empty>No results found.</Command.Empty>
    <Command.Group heading="Results">
      {#each items as item (item.id)}
        {@const Icon = item.icon}
        <Command.Item
          value={item.label}
          onSelect={item.action}
        >
          <Icon class="size-4 text-muted-foreground" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{item.label}</div>
            {#if item.description}
              <div class="text-xs text-muted-foreground truncate">{item.description}</div>
            {/if}
          </div>
          <Command.Shortcut class="capitalize">{item.type}</Command.Shortcut>
        </Command.Item>
      {/each}
    </Command.Group>
  </Command.List>
</Command.Dialog>

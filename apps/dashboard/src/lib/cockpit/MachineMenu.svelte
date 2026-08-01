<script lang="ts">
  /** Right-click on a machine's heading — what you can do to the box, not to a session. */
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { IconCopy, IconPlus, IconRefresh } from '$lib/icons';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { loadCatalog, type Machine } from './client.svelte';
  import { copyToClipboard } from './copy';

  let { machine, children }: { machine: Machine; children: Snippet } = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class="contents">
    {@render children()}
  </ContextMenu.Trigger>

  <ContextMenu.Content>
    <ContextMenu.Item onSelect={() => loadCatalog(machine.machineId)}>
      <IconRefresh />
      Reload sessions
    </ContextMenu.Item>
    <!-- The form reads `machine` out of the query and preselects it. -->
    <ContextMenu.Item onSelect={() => goto(`/session?machine=${machine.machineId}`)}>
      <IconPlus />
      New session here
    </ContextMenu.Item>

    <ContextMenu.Separator />

    <ContextMenu.Item onSelect={() => copyToClipboard('Machine id', machine.machineId)}>
      <IconCopy />
      Copy machine id
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => copyToClipboard('Hostname', machine.hostname)}>
      <IconCopy />
      Copy hostname
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>

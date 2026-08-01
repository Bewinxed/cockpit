<script lang="ts">
  /** Right-click on a machine's heading — what you can do to the box, not to a session. */
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { IconCopy, IconDownload, IconPlus, IconRefresh } from '$lib/icons';
  import { toast } from 'svelte-sonner';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { loadCatalog, machineControl, type Machine } from './client.svelte';
  import { copyToClipboard } from './copy';
  import { UPDATE_TIMEOUT_MS } from '$lib/config';

  let { machine, children }: { machine: Machine; children: Snippet } = $props();

  /**
   * Updates the machine's Claude Code in place. Sessions already running keep the
   * CLI they launched with, so there is nothing here to confirm away.
   */
  async function updateClaudeCode() {
    const updating = machineControl<string>(
      machine.machineId,
      'updateClaudeCode',
      [],
      UPDATE_TIMEOUT_MS
    );
    toast.promise(updating, {
      loading: `Updating Claude Code on ${machine.hostname}…`,
      success: (said: string) => said || `${machine.hostname} is up to date.`,
      error: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    });
    await updating.catch(() => {});
  }
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
    <ContextMenu.Item onSelect={() => void updateClaudeCode()}>
      <IconDownload />
      Update Claude Code
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

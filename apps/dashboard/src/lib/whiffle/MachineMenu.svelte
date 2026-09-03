<script lang="ts">
  /** Right-click on a machine's heading — what you can do to the box, not to a session. */
  import type { Snippet } from "svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { UPDATE_TIMEOUT_MS } from "$lib/config";
  import {
    IconCopy,
    IconDownload,
    IconKey,
    IconPlus,
    IconRefresh,
  } from "$lib/icons";
  import { loadCatalog, type Machine, machineControl } from "./client.svelte";
  import { copyToClipboard } from "./copy";
  import MachineLogin from "./MachineLogin.svelte";
  import UnlockKeychain from "./UnlockKeychain.svelte";

  let { machine, children }: { machine: Machine; children: Snippet } = $props();

  /** Only macOS has a keychain that locks; offering it elsewhere is noise. */
  const isMac = $derived(/darwin|mac/i.test(machine.os));
  /**
   * The keychain workaround is offered only to the machine that is actually
   * stuck behind one. Logging in is offered always — it is the fix, and it
   * leaves the machine holding a token that no lock can hide.
   */
  const stuck = $derived(machine.auth === "unreadable-credentials");
  let unlocking = $state(false);
  let loggingIn = $state(false);

  /**
   * Updates the machine's Claude Code in place. Sessions already running keep the
   * CLI they launched with, so there is nothing here to confirm away.
   */
  async function updateClaudeCode() {
    const updating = machineControl<string>(
      machine.machineId,
      "updateClaudeCode",
      [],
      UPDATE_TIMEOUT_MS
    );
    toast.promise(updating, {
      loading: `Updating Claude Code on ${machine.hostname}…`,
      success: (said: string) => said || `${machine.hostname} is up to date.`,
      error: (err: unknown) =>
        err instanceof Error ? err.message : String(err),
    });
    await updating.catch(() => {
      // toast.promise above already reported the failure.
    });
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
    <ContextMenu.Item
      onSelect={() => goto(`/session?machine=${machine.machineId}`)}
    >
      <IconPlus />
      New session here
    </ContextMenu.Item>
    <ContextMenu.Item
      onSelect={() => {
        loggingIn = true;
      }}
    >
      <IconKey />
      Log in…
    </ContextMenu.Item>
    {#if isMac && stuck}
      <ContextMenu.Item
        onSelect={() => {
          unlocking = true;
        }}
      >
        <IconKey />
        Unlock keychain…
      </ContextMenu.Item>
    {/if}
    <ContextMenu.Item
      onSelect={() => {
        // biome-ignore lint/complexity/noVoid: fire-and-forget; toast.promise above already tracks the outcome
        void updateClaudeCode();
      }}
    >
      <IconDownload />
      Update Claude Code
    </ContextMenu.Item>

    <ContextMenu.Separator />

    <ContextMenu.Item
      onSelect={() => copyToClipboard('Machine id', machine.machineId)}
    >
      <IconCopy />
      Copy machine id
    </ContextMenu.Item>
    <ContextMenu.Item
      onSelect={() => copyToClipboard('Hostname', machine.hostname)}
    >
      <IconCopy />
      Copy hostname
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>

<MachineLogin {machine} bind:open={loggingIn} />
{#if isMac}
  <UnlockKeychain {machine} bind:open={unlocking} />
{/if}

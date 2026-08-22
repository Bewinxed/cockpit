<script lang="ts">
  /**
   * Unlocks a Mac's login keychain from here.
   *
   * macOS binds the login keychain to the Aqua session. When it is locked, every
   * credential read on that machine fails with `errSecInteractionNotAllowed`,
   * the daemon reports `unreadable-credentials`, and every turn on that machine
   * answers "Not logged in". The fix is one command — but a fleet tool whose
   * answer is "go and open a terminal on the other machine" has stopped being a
   * fleet tool, so it is asked for here and relayed down the tunnel.
   *
   * The password is sent, used, and dropped. It is not stored here, not kept in
   * the store, and not written anywhere on the way.
   */
  import { IconKey } from '$lib/icons';
  import { toast } from 'svelte-sonner';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { machineControl, type Machine } from './client.svelte';
  import type { AuthState } from '@cockpit/core';

  let { machine, open = $bindable(false) }: { machine: Machine; open?: boolean } = $props();

  let password = $state('');
  let busy = $state(false);
  let failed = $state<string | null>(null);

  const SAID: Record<string, string> = {
    authenticated: 'is logged in again',
    unauthenticated: 'unlocked, but nobody has logged in there yet',
    'unreadable-credentials': 'unlocked, but its credentials still cannot be read',
  };

  async function unlock(event: SubmitEvent) {
    event.preventDefault();
    if (!password || busy) return;
    busy = true;
    failed = null;
    try {
      const state = await machineControl<AuthState>(machine.machineId, 'unlockKeychain', [
        password,
      ]);
      // Cleared the moment it has been used, whatever the answer was.
      password = '';
      open = false;
      toast.success(`${machine.hostname} ${SAID[state] ?? 'unlocked'}.`);
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(next) => {
    if (!next) {
      password = '';
      failed = null;
    }
  }}
>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <IconKey class="size-4 text-warning" />
        Unlock {machine.hostname}
      </Dialog.Title>
      <Dialog.Description>
        Its login keychain is locked, so Claude Code there cannot read its credentials. This is
        the macOS login password for that machine.
      </Dialog.Description>
    </Dialog.Header>

    <form class="flex flex-col gap-[var(--space-3)]" onsubmit={unlock}>
      <Input
        type="password"
        bind:value={password}
        autocomplete="current-password"
        placeholder="Login password for {machine.hostname}"
        aria-label="Login password for {machine.hostname}"
        aria-invalid={failed ? 'true' : undefined}
        aria-describedby={failed ? 'unlock-error' : 'unlock-note'}
        disabled={busy}
      />

      {#if failed}
        <p id="unlock-error" class="text-sm text-destructive">{failed}</p>
      {:else}
        <p id="unlock-note" class="text-xs text-muted-foreground">
          Sent over your tunnel to that machine, used once, and not stored anywhere.
        </p>
      {/if}

      <div class="flex justify-end gap-[var(--space-2)]">
        <Button type="button" variant="outline" onclick={() => (open = false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!password || busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

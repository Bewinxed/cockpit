<script lang="ts">
  /**
   * Logs a machine in from here.
   *
   * The machine opens no browser and shows no prompt: the daemon builds the
   * authorisation URL, the reader authorises in *their* browser wherever they
   * are, and pastes the code back. What lands on the machine is a token in
   * `~/.claude/.credentials.json` — the file Claude Code reads — so a Mac whose
   * login keychain is locked stops being a problem rather than being worked
   * around.
   */
  import { IconExternal, IconKey } from '$lib/icons';
  import { toast } from 'svelte-sonner';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { machineControl, type Machine } from './client.svelte';
  import type { AuthState } from '@cockpit/core';

  let { machine, open = $bindable(false) }: { machine: Machine; open?: boolean } = $props();

  let url = $state<string | null>(null);
  let code = $state('');
  let busy = $state(false);
  let failed = $state<string | null>(null);

  const SAID: Record<string, string> = {
    authenticated: 'is logged in',
    unauthenticated: 'saved the token, but still reports nobody logged in',
    'unreadable-credentials': 'saved the token, but cannot read its credentials',
  };

  /**
   * Driven by `open` itself, not by `onOpenChange`.
   *
   * The dialog is opened by setting the bound value from a menu item, and a
   * bound write does not run the change callback — so the request for a link
   * never went out and the box sat on "Asking…" for good. The state is the
   * trigger; the callback is only the reader closing it.
   */
  let asked = $state(false);
  $effect(() => {
    if (!open) {
      asked = false;
      return;
    }
    if (asked) return;
    asked = true;
    void begin();
  });

  /** Asked for as the dialog opens, so the reader never waits on a blank box. */
  async function begin() {
    busy = true;
    failed = null;
    try {
      const challenge = await machineControl<{ url: string }>(
        machine.machineId,
        'beginLogin',
        []
      );
      url = challenge.url;
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function finish(event: SubmitEvent) {
    event.preventDefault();
    if (!code.trim() || busy) return;
    busy = true;
    failed = null;
    try {
      const state = await machineControl<AuthState>(machine.machineId, 'completeLogin', [
        code.trim(),
      ]);
      code = '';
      open = false;
      toast.success(`${machine.hostname} ${SAID[state] ?? 'is logged in'}.`);
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
    if (next) return;
    url = null;
    code = '';
    failed = null;
  }}
>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <IconKey class="size-4" />
        Log in {machine.hostname}
      </Dialog.Title>
      <Dialog.Description>
        Authorise in your browser here, then paste the code back. Nothing needs to be typed on
        that machine.
      </Dialog.Description>
    </Dialog.Header>

    <form class="flex flex-col gap-4" onsubmit={finish}>
      {#if url}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm
                 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconExternal class="size-4" />
          Open the authorisation page
        </a>
      {:else if !failed}
        <p class="text-sm text-muted-foreground">Asking {machine.hostname} for a login link…</p>
      {/if}

      <input
        bind:value={code}
        autocomplete="off"
        spellcheck="false"
        placeholder="Paste the code from that page"
        aria-label="Authorisation code"
        aria-invalid={failed ? 'true' : undefined}
        disabled={busy || !url}
        class="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-base
               shadow-sm sm:text-sm focus:border-ring focus:ring-2 focus:ring-ring/30
               focus:outline-none disabled:opacity-60"
      />

      {#if failed}
        <p class="text-caption text-destructive">{failed}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (open = false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!code.trim() || busy || !url}>
          {busy ? 'Finishing…' : 'Log in'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

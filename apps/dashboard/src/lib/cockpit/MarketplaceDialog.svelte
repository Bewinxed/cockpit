<script lang="ts">
  /**
   * Links a plugin marketplace to the fleet (NEW.md §11). The source is passed
   * to `claude plugin marketplace add` verbatim on every machine, so whatever
   * that command accepts, this field accepts.
   */
  import type { FleetMarketplace } from '@cockpit/core';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { saveMarketplace } from './fleet';

  let {
    open = $bindable(false),
    taken = [],
    onsaved,
  }: {
    open?: boolean;
    /** Names already linked, so a clash is caught before the write. */
    taken?: string[];
    onsaved: (row: FleetMarketplace) => void;
  } = $props();

  let name = $state('');
  let source = $state('');
  let busy = $state(false);
  let failed = $state<string | undefined>(undefined);

  const clash = $derived(taken.includes(name.trim()));
  const ready = $derived(name.trim() !== '' && source.trim() !== '' && !clash);

  async function link(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    busy = true;
    failed = undefined;
    try {
      onsaved(await saveMarketplace(name.trim(), source.trim()));
      open = false;
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
    name = '';
    source = '';
    failed = undefined;
  }}
>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Link a marketplace</Dialog.Title>
      <Dialog.Description>
        Every machine clones it. Nothing is installed until you pick a plugin from it.
      </Dialog.Description>
    </Dialog.Header>

    <form class="flex flex-col gap-3" onsubmit={link}>
      <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
        Source
        <Input
          bind:value={source}
          autocomplete="off"
          spellcheck="false"
          placeholder="anthropics/skills"
          class="font-mono text-sm md:text-sm"
        />
        <span class="text-xs">
          A GitHub <span class="font-mono">owner/repo</span>, a git URL, or a URL that ends in
          <span class="font-mono">marketplace.json</span>. Anthropic publishes
          <span class="font-mono">anthropics/skills</span> and
          <span class="font-mono">anthropics/claude-plugins-official</span>.
        </span>
      </label>

      <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
        Name
        <Input
          bind:value={name}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={clash ? 'true' : undefined}
          placeholder="skills"
          class="font-mono text-sm md:text-sm"
        />
        <span class="text-xs">
          {#if clash}
            <span class="text-destructive">“{name.trim()}” is already linked.</span>
          {:else}
            What its plugins are installed as — <span class="font-mono"
              >plugin@{name.trim() || 'name'}</span
            >.
          {/if}
        </span>
      </label>

      {#if failed}
        <p class="text-[13px] text-destructive" role="alert">{failed}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (open = false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !ready}>{busy ? 'Linking…' : 'Link'}</Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

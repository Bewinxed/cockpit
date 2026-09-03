<script lang="ts">
  import type { FleetMarketplace } from "@whiffle/core";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { saveMarketplace } from "./fleet";

  let {
    open = $bindable(false),
    taken = [],
    onsaved,
  }: {
    open?: boolean;
    taken?: string[];
    onsaved: (row: FleetMarketplace) => void;
  } = $props();

  let name = $state("");
  let source = $state("");
  let busy = $state(false);
  let failed = $state<string | undefined>(undefined);

  const clash = $derived(taken.includes(name.trim()));
  const ready = $derived(name.trim() !== "" && source.trim() !== "" && !clash);

  async function link(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || busy) {
      return;
    }
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
  onOpenChange={(next) => { if (next) return; name = ''; source = ''; failed = undefined; }}
  bind:open
>
  <Dialog.Content class="rounded-[var(--radius-shell)] shadow-xl sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Link a marketplace</Dialog.Title>
      <Dialog.Description
        >Every machine clones it. Nothing is installed until you pick a plugin
        from it.</Dialog.Description
      >
    </Dialog.Header>
    <form class="flex flex-col gap-3" onsubmit={link}>
      <label class="flex flex-col gap-1.5 text-caption"
        >Source
        <Input
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          placeholder="anthropics/skills"
          spellcheck="false"
          bind:value={source}
        />
        <span class="text-micro"
          >A GitHub <span class="font-mono">owner/repo</span>, a git URL, or a
          URL that ends in <span class="font-mono">marketplace.json</span>.
          Anthropic publishes
          <span class="font-mono">anthropics/skills</span> and
          <span class="font-mono">anthropics/claude-plugins-official</span
          >.</span
        >
      </label>
      <label class="flex flex-col gap-1.5 text-caption"
        >Name
        <Input
          aria-invalid={clash ? 'true' : undefined}
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          placeholder="skills"
          spellcheck="false"
          bind:value={name}
        />
        <span class="text-micro">
          {#if clash}
            <span class="text-destructive"
              >"{name.trim()}" is already linked.</span
            >
          {:else}
            What its plugins are installed as —
            <span class="font-mono">plugin@{name.trim() || 'name'}</span>.
          {/if}
        </span>
      </label>
      {#if failed}
        <p class="text-caption text-destructive" role="alert">{failed}</p>
      {/if}
      <div class="flex justify-end gap-2 pt-1">
        <Button
          disabled={busy}
          onclick={() => (open = false)}
          type="button"
          variant="outline"
          >Cancel</Button
        >
        <Button disabled={busy || !ready} type="submit"
          >{busy ? 'Linking…' : 'Link'}</Button
        >
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

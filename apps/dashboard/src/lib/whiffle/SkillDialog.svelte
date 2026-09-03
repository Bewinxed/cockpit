<script lang="ts">
  import type { FleetSkillMeta } from "@whiffle/core";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import {
    formatBytes,
    normalizeSkillSource,
    pickSkill,
    saveSkill,
    skillNameProblem,
    suggestSkillName,
  } from "./fleet";

  let {
    open = $bindable(false),
    taken = [],
    onsaved,
  }: {
    open?: boolean;
    taken?: string[];
    onsaved: (row: FleetSkillMeta) => void;
  } = $props();

  let typed = $state("");
  let name = $state("");
  let busy = $state(false);
  let failed = $state<string | undefined>(undefined);
  let choices = $state<string[]>([]);
  let named = $state(false);

  const source = $derived(normalizeSkillSource(typed));
  const nameProblem = $derived(skillNameProblem(name, taken));
  const ready = $derived(source !== "" && nameProblem === undefined);

  async function fetchIt(from: string) {
    if (busy) {
      return;
    }
    busy = true;
    failed = undefined;
    try {
      const row = await saveSkill(name.trim(), { source: from, enabled: true });
      onsaved(row);
      if (row.choices && row.choices.length > 0) {
        choices = row.choices;
        return;
      }
      open = false;
      if (!row.error) {
        toast.success(
          row.bytes === undefined
            ? `${row.name} is on its way to every machine.`
            : `${row.name} — ${formatBytes(row.bytes)} on its way to every machine.`
        );
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!ready) {
      return;
    }
    void fetchIt(source);
  }
  function choose(choice: string) {
    typed = pickSkill(source, choice);
    choices = [];
    void fetchIt(typed);
  }
</script>

<Dialog.Root
  onOpenChange={(next) => { if (next) return; typed = ''; name = ''; named = false; failed = undefined; choices = []; }}
  bind:open
>
  <Dialog.Content class="rounded-[var(--radius-shell)] shadow-xl sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add skill</Dialog.Title>
      <Dialog.Description
        >The hub downloads the files once and every machine writes them into
        <span class="font-mono">~/.claude/skills</span>. No installer runs
        anywhere.</Dialog.Description
      >
    </Dialog.Header>
    <form class="flex flex-col gap-3" onsubmit={submit}>
      <label class="flex flex-col gap-1.5 text-caption"
        >Source
        <Input
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          oninput={() => !named && (name = suggestSkillName(normalizeSkillSource(typed)))}
          placeholder="bunx skills add pbakaus/impeccable"
          spellcheck="false"
          bind:value={typed}
        />
        <span class="text-micro">
          {#if source !== '' && source !== typed.trim()}
            Reads as <span class="font-mono text-foreground">{source}</span>
          {:else}
            The install command, an
            <span class="font-mono">owner/repo</span> slug, or a
            <span class="font-mono">skills:</span>,
            <span class="font-mono">github:</span>,
            <span class="font-mono">npm:</span> or
            <span class="font-mono">https://</span> source.
          {/if}
        </span>
      </label>
      <label class="flex flex-col gap-1.5 text-caption"
        >Name
        <Input
          aria-invalid={name !== '' && nameProblem ? 'true' : undefined}
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          oninput={() => (named = true)}
          placeholder="impeccable"
          spellcheck="false"
          bind:value={name}
        />
        <span class="text-micro">
          {#if name !== '' && nameProblem}
            <span class="text-destructive">{nameProblem}</span>
          {:else}
            The directory it lands in —
            <span class="font-mono">~/.claude/skills/{name || 'name'}</span>
          {/if}
        </span>
      </label>
      {#if choices.length > 0}
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1 text-caption">
            That repo holds several skills. Pick the one to fetch.
          </legend>
          <ul
            class="flex max-h-52 flex-col overflow-y-auto rounded-[var(--radius-card)] border border-border"
          >
            {#each choices as choice (choice)}
              <li class="border-t border-border first:border-t-0">
                <button
                  class="w-full px-3 py-2 text-left font-mono text-caption transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  disabled={busy}
                  onclick={() => choose(choice)}
                  type="button"
                >
                  {choice}
                </button>
              </li>
            {/each}
          </ul>
        </fieldset>
      {/if}
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
          >{busy ? 'Fetching…' : 'Fetch skill'}</Button
        >
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

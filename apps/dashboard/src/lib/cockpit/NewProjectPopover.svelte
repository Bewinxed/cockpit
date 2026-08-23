<script lang="ts">
  /**
   * Names a directory so the rail has a folder for it before anything has run
   * there. Every other folder in the rail is grown from live work, which leaves
   * no way at all to add the checkout you have not started yet — this is it.
   */
  import { tick } from 'svelte';
  import DirectoryPicker from '$lib/components/features/DirectoryPicker.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import { IconPlus, IconSpinner } from '$lib/icons';
  import { cockpit, createProject } from './client.svelte';

  const leaf = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

  /** Typed directories arrive with trailing slashes; the leaf assumes none. */
  const trim = (path: string) => path.trim().replace(/(?!^)\/+$/, '');

  let open = $state(false);
  let name = $state('');
  let machineId = $state('');
  let cwd = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  let nameInput = $state<HTMLInputElement | null>(null);

  const machine = $derived(cockpit.machines.find((row) => row.machineId === machineId) ?? null);
  const dir = $derived(trim(cwd));

  function opened(next: boolean) {
    open = next;
    if (!next) return;
    name = '';
    machineId = cockpit.onlineMachines[0]?.machineId ?? '';
    cwd = '';
    saving = false;
    error = null;
    void tick().then(() => nameInput?.focus());
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!machineId) {
      error = 'Choose the machine this directory is on.';
      return;
    }
    if (!dir) {
      error = 'Enter the directory this project lives in.';
      return;
    }
    saving = true;
    error = null;
    try {
      // `createProject` refreshes the registry, so the folder is already there.
      await createProject({ machineId, cwd: dir, name: name.trim() || leaf(dir) });
      open = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<Popover.Root {open} onOpenChange={opened}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon-sm"
        class="-mr-1"
        title="New project"
        aria-label="New project"
      >
        <IconPlus />
      </Button>
    {/snippet}
  </Popover.Trigger>

  <Popover.Content
    side="bottom"
    align="start"
    sideOffset={6}
    aria-label="New project"
    class="material-panel flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-[var(--radius-panel)] p-4
           shadow-xl duration-[180ms] ease-[var(--e-in)]"
  >
    <h2 class="text-body font-medium">New project</h2>

    <form class="flex flex-col gap-3" onsubmit={create}>
      <div class="flex flex-col gap-1">
        <label for="project-name" class="text-micro text-muted-foreground">Name</label>
        <Input
          id="project-name"
          bind:ref={nameInput}
          bind:value={name}
          placeholder={dir ? leaf(dir) : 'What you call it'}
          autocomplete="off"
          spellcheck="false"
          oninput={() => (error = null)}
        />
      </div>

      <div class="flex flex-col gap-1">
        <span id="project-machine-label" class="text-micro text-muted-foreground">Machine</span>
        <Select.Root type="single" bind:value={machineId}>
          <Select.Trigger
            aria-labelledby="project-machine-label"
            size="sm"
            class="w-full text-foreground"
          >
            {machine ? `${machine.hostname} · ${machine.os}` : 'No machines online'}
          </Select.Trigger>
          <Select.Content>
            {#each cockpit.onlineMachines as row (row.machineId)}
              <Select.Item value={row.machineId} label="{row.hostname} · {row.os}">
                {row.hostname} · {row.os}
              </Select.Item>
            {:else}
              <span class="block px-2 py-1.5 text-sm">No machines online</span>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-1">
        <label for="project-cwd" class="text-micro text-muted-foreground">Directory</label>
        <Input
          id="project-cwd"
          bind:value={cwd}
          placeholder="/home/you/project"
          autocomplete="off"
          spellcheck="false"
          class="font-mono"
          oninput={() => (error = null)}
        />
      </div>

      <DirectoryPicker
        {machineId}
        value={cwd}
        onSelect={(path) => {
          cwd = path;
          error = null;
        }}
      />

      <div class="flex items-center gap-3 pt-1">
        <Button type="submit" size="sm" disabled={saving} class="pressable">
          {#if saving}
            <IconSpinner class="animate-spin" />
          {/if}
          Create
        </Button>
        {#if error}
          <span class="text-micro text-error" role="alert">{error}</span>
        {/if}
      </div>
    </form>
  </Popover.Content>
</Popover.Root>

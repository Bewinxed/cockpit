<script lang="ts">
  import {
    IconChevronRight,
    IconFolder,
    IconFolderOpen,
    IconPlay,
    IconRepo,
    IconShield,
    IconSpinner,
  } from '$lib/icons';
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PermissionMode, RepoInfo, ReposResult } from '@cockpit/core';
  import { repoPath } from '@cockpit/core';
  import { cockpit, createProject, machineControl, spawnSession } from '$lib/cockpit/client.svelte';
  import LiveSessionRow from '$lib/cockpit/LiveSessionRow.svelte';
  import MachineMenu from '$lib/cockpit/MachineMenu.svelte';
  import ModelCombobox from '$lib/cockpit/ModelCombobox.svelte';
  import { MODEL_DEFAULT } from '$lib/cockpit/models.svelte';
  import StoredSessionRow from '$lib/cockpit/StoredSessionRow.svelte';
  import { PERMISSION_MODES, permissionModeLabel } from '$lib/cockpit/permission-modes';
  import { permissionSummary } from '$lib/cockpit/permission-summary';
  import DirectoryPicker from '$lib/components/features/DirectoryPicker.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Select from '$lib/components/ui/select';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';

  /** Where the session works: a directory that is already there, or a fresh clone. */
  const SOURCES = [
    { value: 'directory', label: 'Directory', icon: IconFolder },
    { value: 'repo', label: 'GitHub repo', icon: IconRepo },
  ] as const;

  type Source = (typeof SOURCES)[number]['value'];

  let machineId = $state('');
  let source = $state<Source>('directory');
  let cwd = $state('');
  let repo = $state('');
  let prompt = $state('');
  let permissionMode = $state<PermissionMode>('default');
  /** Empty is a choice: the spawn leaves `model` out and the SDK picks. */
  let model = $state(MODEL_DEFAULT);
  let sideQuest = $state(false);
  let worktree = $state(false);
  let projectName = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  const leaf = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

  // The jump palette names a machine in the query; otherwise the first one online.
  $effect(() => {
    if (machineId) return;
    const asked = page.url.searchParams.get('machine');
    const online = cockpit.onlineMachines;
    machineId = online.find((row) => row.machineId === asked)?.machineId ?? online[0]?.machineId ?? '';
  });

  const stale = $derived(cockpit.staleInstances);
  let showStale = $state(false);

  // Machines arrive over the socket a beat after the page does, so the staggered
  // entrance window stays open briefly; anything that connects later just appears.
  let entering = $state(true);
  onMount(() => {
    const timer = setTimeout(() => (entering = false), 800);
    return () => clearTimeout(timer);
  });

  let machineTrigger = $state<HTMLElement | null>(null);
  let cwdInput = $state<HTMLInputElement | null>(null);
  let repoInput = $state<HTMLInputElement | null>(null);

  const machineLabel = $derived(
    cockpit.onlineMachines.find((machine) => machine.machineId === machineId)
  );

  /** The field the last submit tripped over — drives its border and one shake. */
  let invalid = $state<'machine' | 'cwd' | 'repo' | null>(null);

  // Cleared first so the class comes off and back on, which is what replays the
  // shake when the same field fails twice in a row.
  async function flag(field: 'machine' | 'cwd' | 'repo') {
    invalid = null;
    await tick();
    invalid = field;
  }

  function clearInvalid() {
    invalid = null;
    error = null;
  }

  let repoOpen = $state(false);
  let repos = $state<RepoInfo[]>([]);
  let reposLoading = $state(false);
  /** Why the list has nothing to offer, when it has nothing to offer. */
  let repoNotice = $state<
    { kind: 'gh-missing' | 'gh-unauthenticated' } | { kind: 'failed'; message: string } | null
  >(null);

  /** Listing repositories shells out to `gh` on the machine, so it is read once. */
  const repoCache = new Map<string, ReposResult>();

  const matches = $derived(
    repos.filter((row) => row.nameWithOwner.toLowerCase().includes(repo.trim().toLowerCase()))
  );

  /** Where the clone lands — the agent works the same directory out for itself. */
  const cloneInto = $derived.by(() => {
    const name = repoPath(repo).split('/').pop();
    if (!name) return '';
    return `${(cwd.trim() || '~').replace(/(?!^)\/+$/, '')}/${name}`;
  });

  /** The directory the session will run in, whichever way it was arrived at. */
  const workdir = $derived(source === 'repo' ? cloneInto : cwd.trim());

  function adoptRepos(result: ReposResult) {
    if (Array.isArray(result)) repos = result;
    else repoNotice = { kind: result.error };
  }

  async function openRepos() {
    repoOpen = true;
    if (!machineId) return;
    repos = [];
    repoNotice = null;

    const cached = repoCache.get(machineId);
    if (cached) {
      adoptRepos(cached);
      return;
    }

    const asked = machineId;
    reposLoading = true;
    try {
      const result = await machineControl<ReposResult>(machineId, 'listRepos');
      repoCache.set(asked, result);
      // The machine was switched while gh was answering; that list is not this one.
      if (machineId !== asked) return;
      adoptRepos(result);
    } catch (err) {
      if (machineId !== asked) return;
      repoNotice = { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
    } finally {
      reposLoading = false;
    }
  }

  function chooseRepo(row: RepoInfo) {
    repo = row.nameWithOwner;
    repoOpen = false;
    clearInvalid();
  }

  /** A clone needs somewhere to land, and home is the one directory every machine has. */
  function chooseSource(next: string) {
    // A single toggle group answers with `''` when its active item is clicked again.
    if (next !== 'directory' && next !== 'repo') return;
    source = next;
    if (next === 'repo' && !cwd.trim()) cwd = '~';
    clearInvalid();
  }

  async function start(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    // The button stays live and says what is missing — a dead button explains nothing.
    if (!machineId) {
      error = 'Choose a machine to run this session on.';
      await flag('machine');
      machineTrigger?.focus();
      return;
    }
    if (source === 'repo' && !repo.trim()) {
      error = 'Choose a repository, or paste the URL of one.';
      await flag('repo');
      repoInput?.focus();
      return;
    }
    if (!cwd.trim()) {
      error =
        source === 'repo'
          ? 'Enter the directory to clone into.'
          : 'Enter the directory this session should work in.';
      await flag('cwd');
      cwdInput?.focus();
      return;
    }
    invalid = null;
    try {
      const instanceId = spawnSession({
        machineId,
        cwd: workdir,
        prompt,
        permissionMode,
        model: model || undefined,
        scratch: sideQuest ? { worktree, baseCwd: workdir } : undefined,
        bootstrap: source === 'repo' ? { repo: repo.trim(), baseDir: cwd.trim() } : undefined,
      });
      await goto(`/session/${instanceId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Names this machine + directory so it gets a project home to come back to. */
  async function saveProject() {
    saving = true;
    error = null;
    try {
      const project = await createProject({
        machineId,
        cwd: workdir,
        name: projectName.trim() || leaf(workdir),
      });
      await goto(`/project/${project.id}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <header class="flex items-baseline justify-between">
      <h1 class="text-lg font-semibold">Sessions</h1>
      <span class="text-xs text-muted-foreground">hub {cockpit.status}</span>
    </header>

    {#if cockpit.blocked.length > 0}
      <section class="rounded-xl border border-warning/40 bg-warning/5">
        <h2
          class="flex items-center gap-2 border-b border-warning/20 px-4 py-2 text-xs font-medium tracking-wider text-warning uppercase"
        >
          <IconShield class="size-3.5" />
          Needs attention
          <span class="ml-auto font-mono text-xs normal-case">
            {cockpit.blocked.length}
          </span>
        </h2>
        <div class="divide-y divide-warning/15">
          {#each cockpit.blocked as blocked (blocked.request.requestId)}
            <a
              href="/session/{blocked.instanceId}"
              class="flex flex-col gap-0.5 px-4 py-2.5 transition-colors hover:bg-warning/10"
            >
              <span class="flex items-baseline gap-2 text-xs text-muted-foreground">
                <span class="font-medium text-foreground">{blocked.hostname}</span>
                <span class="truncate font-mono">{blocked.cwd || '—'}</span>
              </span>
              <span class="truncate text-sm text-warning">
                {permissionSummary(blocked.request.toolName, blocked.request.input)}
              </span>
            </a>
          {/each}
        </div>
      </section>
    {/if}

    <section class="rounded-xl border border-border bg-card p-4">
      <h2 class="mb-3 text-sm font-medium">New session</h2>
      <form class="flex flex-col gap-3" onsubmit={start}>
        <div class="flex flex-col gap-1 text-xs text-muted-foreground">
          <span id="machine-label">Machine</span>
          <Select.Root type="single" bind:value={machineId} onValueChange={clearInvalid}>
            <Select.Trigger
              bind:ref={machineTrigger}
              aria-labelledby="machine-label"
              class="w-full text-foreground motion-reduce:animate-none
                {invalid === 'machine' ? 'animate-shake border-error' : ''}"
            >
              {machineLabel ? `${machineLabel.hostname} · ${machineLabel.os}` : 'No machines online'}
            </Select.Trigger>
            <Select.Content>
              {#each cockpit.onlineMachines as machine (machine.machineId)}
                <Select.Item
                  value={machine.machineId}
                  label="{machine.hostname} · {machine.os}"
                >
                  {machine.hostname} · {machine.os}
                </Select.Item>
              {:else}
                <span class="block px-2 py-1.5 text-sm">No machines online</span>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <div class="flex flex-col gap-1 text-xs text-muted-foreground">
          <span id="permissions-label">Permissions</span>
          <Select.Root
            type="single"
            value={permissionMode}
            onValueChange={(value) => (permissionMode = value as PermissionMode)}
          >
            <Select.Trigger
              aria-labelledby="permissions-label"
              class="w-full {permissionMode === 'bypassPermissions'
                ? 'text-warning'
                : 'text-foreground'}"
            >
              {permissionModeLabel(permissionMode)}
            </Select.Trigger>
            <Select.Content>
              {#each PERMISSION_MODES as mode (mode.value)}
                <Select.Item value={mode.value} label={mode.label}>
                  <span class="flex flex-col">
                    <span class={mode.value === 'bypassPermissions' ? 'text-warning' : ''}>
                      {mode.label}
                    </span>
                    <span class="text-xs text-muted-foreground">{mode.description}</span>
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <div class="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Model</span>
          <ModelCombobox
            value={model}
            onchoose={(chosen) => {
              model = chosen;
            }}
            showDefault
            size="default"
            class="w-full text-foreground"
          />
        </div>

        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          value={source}
          onValueChange={chooseSource}
          class="self-start"
          aria-label="Where this session works"
        >
          {#each SOURCES as option (option.value)}
            {@const Icon = option.icon}
            <ToggleGroup.Item value={option.value}>
              <Icon />
              {option.label}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>

        {#if source === 'repo'}
          <div class="relative flex flex-col gap-1 text-xs text-muted-foreground">
            <label for="repo">Repository</label>
            <input
              id="repo"
              bind:this={repoInput}
              bind:value={repo}
              placeholder="owner/name, or a clone URL"
              autocomplete="off"
              spellcheck="false"
              class="rounded-md border bg-background px-2 py-1.5 font-mono text-base text-foreground transition-colors duration-200 ease-out placeholder:text-muted-foreground motion-reduce:animate-none sm:text-sm
                {invalid === 'repo' ? 'border-error' : 'border-border'}"
              class:animate-shake={invalid === 'repo'}
              onfocus={openRepos}
              oninput={() => {
                repoOpen = true;
                clearInvalid();
              }}
              onblur={() => (repoOpen = false)}
              onkeydown={(event) => {
                if (event.key === 'Escape') repoOpen = false;
              }}
            />

            {#if repoOpen}
              <div
                class="absolute top-full right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
              >
                {#if reposLoading}
                  <span class="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <IconSpinner class="size-3.5 animate-spin" />
                    Reading repositories…
                  </span>
                {:else if repoNotice}
                  <span class="block border-l-2 border-warning px-2 py-1.5 text-xs text-warning">
                    {#if repoNotice.kind === 'failed'}
                      {repoNotice.message}
                    {:else if repoNotice.kind === 'gh-missing'}
                      The GitHub CLI is not installed on {machineLabel?.hostname ?? 'that machine'}.
                      Install <code class="font-mono">gh</code> there, or paste a clone URL.
                    {:else}
                      Run <code class="font-mono">gh auth login</code>
                      on {machineLabel?.hostname ?? 'that machine'} to list its repositories, or paste
                      a clone URL.
                    {/if}
                  </span>
                {:else}
                  {#each matches as row (row.nameWithOwner)}
                    <button
                      type="button"
                      class="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                      onmousedown={(event) => event.preventDefault()}
                      onclick={() => chooseRepo(row)}
                    >
                      <span class="flex w-full items-center gap-2">
                        <span class="truncate font-mono text-[13px] text-foreground">
                          {row.nameWithOwner}
                        </span>
                        {#if row.visibility === 'PRIVATE'}
                          <span
                            class="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground"
                          >
                            private
                          </span>
                        {/if}
                      </span>
                      {#if row.description}
                        <span class="w-full truncate text-xs text-muted-foreground">
                          {row.description}
                        </span>
                      {/if}
                    </button>
                  {:else}
                    <span class="block px-2 py-1.5 text-xs text-muted-foreground">
                      No repository by that name here — it is cloned as you wrote it.
                    </span>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          {source === 'repo' ? 'Clone into' : 'Working directory'}
          <input
            bind:this={cwdInput}
            bind:value={cwd}
            placeholder={source === 'repo' ? '~' : '/home/you/project'}
            class="rounded-md border bg-background px-2 py-1.5 font-mono text-base text-foreground transition-colors duration-200 ease-out placeholder:text-muted-foreground motion-reduce:animate-none sm:text-sm
              {invalid === 'cwd' ? 'border-error' : 'border-border'}"
            class:animate-shake={invalid === 'cwd'}
            oninput={clearInvalid}
          />
        </label>

        <DirectoryPicker
          {machineId}
          value={cwd}
          onSelect={(path) => {
            cwd = path;
            clearInvalid();
          }}
        />

        {#if source === 'repo' && cloneInto}
          <span class="font-mono text-xs text-muted-foreground/70">{cloneInto}</span>
        {/if}

        {#if workdir}
          <div class="flex items-end gap-2">
            <label class="flex flex-col gap-1 text-xs text-muted-foreground">
              Project name
              <input
                bind:value={projectName}
                placeholder={leaf(workdir)}
                class="w-40 rounded-md border border-border bg-background px-2 py-1 text-base text-foreground placeholder:text-muted-foreground sm:text-xs"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              class="text-xs"
              disabled={!machineId || saving}
              onclick={saveProject}
            >
              <IconFolderOpen />
              Save as project
            </Button>
          </div>
        {/if}

        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          First prompt (optional)
          <textarea
            bind:value={prompt}
            rows={2}
            class="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-base text-foreground placeholder:text-muted-foreground sm:text-sm"
          ></textarea>
        </label>

        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox id="side-quest" bind:checked={sideQuest} />
          <label for="side-quest" class="cursor-pointer">
            Side quest — kept apart from mainline work until you keep or discard it
          </label>
        </div>

        {#if sideQuest}
          <div class="flex items-center gap-2 pl-5 text-xs text-muted-foreground">
            <Checkbox id="worktree" bind:checked={worktree} />
            <label for="worktree" class="cursor-pointer">
              in a git worktree of this directory
            </label>
          </div>
        {/if}

        <div class="flex items-center gap-3">
          <Button type="submit">
            <IconPlay />
            Start session
          </Button>
          {#if error}
            <span class="text-xs text-error" role="alert">{error}</span>
          {/if}
        </div>
      </form>
    </section>

    {#each cockpit.machines as machine, index (machine.machineId)}
      {@const running = cockpit.runningOn(machine.machineId)}
      {@const stored = cockpit.catalogOf(machine.machineId)}
      <section
        class="flex flex-col gap-2"
        in:fly={{
          y: 8,
          duration: entering ? 260 : 0,
          delay: entering ? index * 70 : 0,
          easing: quintOut,
        }}
      >
        <MachineMenu {machine}>
          <h2 class="flex items-center gap-2 text-sm font-medium">
            <span
              class="size-2 rounded-full {machine.status === 'online'
                ? 'bg-success'
                : 'bg-muted-foreground'}"
              title={machine.status === 'online' ? 'Online' : 'Offline'}
            ></span>
            {machine.hostname}
            <span class="text-xs font-normal text-muted-foreground">{machine.os}</span>
            <span class="ml-auto font-mono text-xs font-normal text-muted-foreground">
              {machine.machineId}
            </span>
          </h2>
        </MachineMenu>

        {#each running as instance (instance.id)}
          <LiveSessionRow {instance} />
        {/each}

        {#each stored.slice(0, 8) as info (info.sessionId)}
          <StoredSessionRow machineId={machine.machineId} {info} />
        {:else}
          {#if running.length === 0}
            <p class="text-sm text-muted-foreground">No sessions on this machine yet.</p>
          {/if}
        {/each}
      </section>
    {:else}
      <section class="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <h2 class="text-sm font-medium">No machines yet</h2>
        <p class="text-sm text-muted-foreground">
          Cockpit runs Claude Code on your own hardware and watches it from here. Start the agent
          daemon on a machine, pointed at this hub, and it shows up in the rail.
        </p>
        <pre
          class="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">COCKPIT_HUB_URL=ws://&lt;this-host&gt;:3456/ws bun run agent</pre>
      </section>
    {/each}

    {#if stale.length > 0}
      <section>
        <Collapsible.Root
          open={showStale}
          onOpenChange={() => (showStale = !showStale)}
          class="flex flex-col gap-2"
        >
          <Collapsible.Trigger
            class="flex min-h-6 items-center gap-2 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconChevronRight class="size-3 transition-transform {showStale ? 'rotate-90' : ''}" />
            Stale
            <span class="font-mono normal-case">{stale.length}</span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div class="flex flex-col gap-2">
              <p class="text-xs text-muted-foreground">
                The daemon running these went away. They may still be alive on their machine — the
                hub cannot tell, so it stops counting them as live.
              </p>
              {#each stale as instance (instance.id)}
                <span
                  class="flex items-baseline gap-3 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground"
                >
                  <span class="truncate font-mono">{instance.cwd || '—'}</span>
                  <span class="ml-auto shrink-0 font-mono">{instance.machineId}</span>
                </span>
              {/each}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </section>
    {/if}
  </div>
</div>

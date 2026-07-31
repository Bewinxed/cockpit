<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ChevronRight, ShieldAlert } from '@lucide/svelte';
  import { cockpit, createProject, spawnSession } from '$lib/cockpit/client.svelte';
  import LiveSessionRow from '$lib/cockpit/LiveSessionRow.svelte';
  import StoredSessionRow from '$lib/cockpit/StoredSessionRow.svelte';
  import { permissionSummary } from '$lib/cockpit/permission-summary';
  import DirectoryPicker from '$lib/components/features/DirectoryPicker.svelte';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Select from '$lib/components/ui/select';

  let machineId = $state('');
  let cwd = $state('');
  let prompt = $state('');
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

  const machineLabel = $derived(
    cockpit.onlineMachines.find((machine) => machine.machineId === machineId)
  );

  /** The field the last submit tripped over — drives its border and one shake. */
  let invalid = $state<'machine' | 'cwd' | null>(null);

  // Cleared first so the class comes off and back on, which is what replays the
  // shake when the same field fails twice in a row.
  async function flag(field: 'machine' | 'cwd') {
    invalid = null;
    await tick();
    invalid = field;
  }

  function clearInvalid() {
    invalid = null;
    error = null;
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
    if (!cwd.trim()) {
      error = 'Enter the directory this session should work in.';
      await flag('cwd');
      cwdInput?.focus();
      return;
    }
    invalid = null;
    try {
      const instanceId = spawnSession({
        machineId,
        cwd: cwd.trim(),
        prompt,
        options: sideQuest ? { persistSession: false } : {},
        scratch: sideQuest && worktree ? { worktree: true, baseCwd: cwd.trim() } : undefined,
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
        cwd: cwd.trim(),
        name: projectName.trim() || leaf(cwd.trim()),
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
          <ShieldAlert size={14} />
          Needs attention
          <span class="ml-auto font-mono text-[11px] normal-case">
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
              class="text-foreground motion-reduce:animate-none
                {invalid === 'machine' ? 'animate-shake border-error' : ''}"
            >
              {machineLabel ? `${machineLabel.hostname} · ${machineLabel.os}` : 'No machines online'}
            </Select.Trigger>
            <Select.Content>
              {#each cockpit.onlineMachines as machine (machine.machineId)}
                <Select.Item
                  value={machine.machineId}
                  label="{machine.hostname} · {machine.os}"
                  class="text-foreground"
                >
                  {machine.hostname} · {machine.os}
                </Select.Item>
              {:else}
                <span class="block px-2 py-1.5 text-sm">No machines online</span>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          Working directory
          <input
            bind:this={cwdInput}
            bind:value={cwd}
            placeholder="/home/you/project"
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

        {#if cwd.trim()}
          <div class="flex items-end gap-2">
            <label class="flex flex-col gap-1 text-xs text-muted-foreground">
              Project name
              <input
                bind:value={projectName}
                placeholder={leaf(cwd.trim())}
                class="w-40 rounded-md border border-border bg-background px-2 py-1 text-base text-foreground placeholder:text-muted-foreground sm:text-xs"
              />
            </label>
            <button
              type="button"
              class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              disabled={!machineId || saving}
              onclick={saveProject}
            >
              Save as project
            </button>
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
            Side quest — ephemeral, nothing written to session storage
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
          <button
            type="submit"
            class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start session
          </button>
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
      <section class="flex flex-col gap-2">
        <button
          type="button"
          class="flex min-h-6 items-center gap-2 text-left text-[11px] font-medium tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={showStale}
          aria-controls="stale-instances"
          onclick={() => (showStale = !showStale)}
        >
          <ChevronRight size={12} class="transition-transform {showStale ? 'rotate-90' : ''}" />
          Stale
          <span class="font-mono normal-case">{stale.length}</span>
        </button>
        {#if showStale}
          <div id="stale-instances" class="flex flex-col gap-2">
            <p class="text-xs text-muted-foreground">
              The daemon running these went away. They may still be alive on their machine — the hub
              cannot tell, so it stops counting them as live.
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
        {/if}
      </section>
    {/if}
  </div>
</div>

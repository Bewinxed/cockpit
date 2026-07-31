<script lang="ts">
  import { goto } from '$app/navigation';
  import { ShieldAlert } from '@lucide/svelte';
  import { formatDistanceToNow } from '$lib/utils/time';
  import ActivityDot from '$lib/cockpit/ActivityDot.svelte';
  import { cockpit, spawnSession } from '$lib/cockpit/client.svelte';
  import { sessionTitle, transcriptHref } from '$lib/cockpit/links';
  import { permissionSummary } from '$lib/cockpit/permission-summary';

  let machineId = $state('');
  let cwd = $state('');
  let prompt = $state('');
  let sideQuest = $state(false);
  let worktree = $state(false);
  let error = $state<string | null>(null);

  // Default to the first machine that comes online.
  $effect(() => {
    if (!machineId && cockpit.onlineMachines.length > 0) {
      machineId = cockpit.onlineMachines[0].machineId;
    }
  });

  async function start(event: SubmitEvent) {
    event.preventDefault();
    error = null;
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
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          Machine
          <select
            bind:value={machineId}
            class="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {#each cockpit.onlineMachines as machine (machine.machineId)}
              <option value={machine.machineId}>{machine.hostname} · {machine.os}</option>
            {:else}
              <option value="">No machines online</option>
            {/each}
          </select>
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          Working directory
          <input
            bind:value={cwd}
            placeholder="/home/you/project"
            class="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground"
          />
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          First prompt (optional)
          <textarea
            bind:value={prompt}
            rows={2}
            class="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
          ></textarea>
        </label>

        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" bind:checked={sideQuest} class="accent-primary" />
          Side quest — ephemeral, nothing written to session storage
        </label>

        {#if sideQuest}
          <label class="flex items-center gap-2 pl-5 text-xs text-muted-foreground">
            <input type="checkbox" bind:checked={worktree} class="accent-primary" />
            in a git worktree of this directory
          </label>
        {/if}

        <div class="flex items-center gap-3">
          <button
            type="submit"
            disabled={!machineId || !cwd.trim()}
            class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            Start session
          </button>
          {#if error}
            <span class="text-xs text-error">{error}</span>
          {/if}
        </div>
      </form>
    </section>

    {#each cockpit.machines as machine (machine.machineId)}
      {@const running = cockpit.runningOn(machine.machineId)}
      {@const stored = cockpit.catalogOf(machine.machineId)}
      <section class="flex flex-col gap-2">
        <h2 class="flex items-center gap-2 text-sm font-medium">
          <span
            class="size-2 rounded-full {machine.status === 'online'
              ? 'bg-success'
              : 'bg-muted-foreground'}"
          ></span>
          {machine.hostname}
          <span class="text-xs font-normal text-muted-foreground">{machine.os}</span>
          <span class="ml-auto font-mono text-xs font-normal text-muted-foreground">
            {machine.machineId}
          </span>
        </h2>

        {#each running as instance (instance.id)}
          {@const activity = cockpit.activityOf(instance.id)}
          {@const tool = cockpit.currentToolOf(instance.id)}
          <a
            href="/session/{instance.id}"
            class="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <span class="flex items-center gap-3">
              <ActivityDot {activity} />
              <span class="truncate font-mono">{instance.cwd || '—'}</span>
              <span class="ml-auto shrink-0 text-xs text-muted-foreground">{activity}</span>
            </span>
            {#if activity === 'working' && tool}
              <span class="flex items-baseline gap-2 pl-5 text-xs text-muted-foreground">
                <span class="shrink-0">{tool.name}</span>
                <span class="truncate font-mono opacity-70">{tool.glance}</span>
              </span>
            {/if}
          </a>
        {/each}

        {#each stored.slice(0, 8) as info (info.sessionId)}
          <a
            href={transcriptHref(machine.machineId, info)}
            class="flex flex-col rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent"
          >
            <span class="flex items-baseline gap-3">
              <span class="truncate text-sm">{sessionTitle(info)}</span>
              <span class="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(info.lastModified))}
              </span>
            </span>
            <span class="truncate font-mono text-xs text-muted-foreground">{info.cwd ?? ''}</span>
          </a>
        {:else}
          {#if running.length === 0}
            <p class="text-sm text-muted-foreground">No sessions on this machine yet.</p>
          {/if}
        {/each}
      </section>
    {:else}
      <p class="text-sm text-muted-foreground">No machines registered.</p>
    {/each}
  </div>
</div>

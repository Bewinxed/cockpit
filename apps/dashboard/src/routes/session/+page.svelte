<script lang="ts">
  import { goto } from '$app/navigation';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { cockpit, spawnSession } from '$lib/cockpit/client.svelte';
  import { sessionTitle, transcriptHref } from '$lib/cockpit/links';

  let machineId = $state('');
  let cwd = $state('');
  let prompt = $state('');
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
      const instanceId = spawnSession({ machineId, cwd: cwd.trim(), prompt });
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
          <a
            href="/session/{instance.id}"
            class="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-success"></span>
            <span class="truncate font-mono">{instance.cwd || '—'}</span>
            <span class="ml-auto shrink-0 text-xs text-muted-foreground">{instance.status}</span>
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

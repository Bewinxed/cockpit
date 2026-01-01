<script lang="ts">
  import { page } from '$app/stores';
  import { agents, instances } from '$lib/stores/realtime';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';

  let showNewInstanceModal = $state(false);

  // Get agent from store
  let agent = $derived($agents.get($page.params.id));

  // Get instances for this agent
  let agentInstances = $derived(
    Array.from($instances.values()).filter(i => i.agentId === $page.params.id)
  );

  let runningInstances = $derived(agentInstances.filter(i => i.status === 'running'));
</script>

<svelte:head>
  <title>{agent?.hostname || 'Agent'} | Cockpit</title>
</svelte:head>

{#if agent}
  <div class="max-w-4xl">
    <!-- Header -->
    <header class="mb-8">
      <div class="flex items-center gap-4 mb-4">
        <a href="/agents" class="text-tx-3 hover:text-tx-1 transition-colors">
          &larr; Agents
        </a>
      </div>

      <div class="flex items-start justify-between">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            {#if agent.os === 'darwin'}
              <span class="text-3xl"></span>
            {:else if agent.os === 'windows'}
              <span class="text-3xl"></span>
            {:else}
              <span class="text-3xl"></span>
            {/if}
          </div>
          <div>
            <h1 class="text-2xl font-semibold text-tx-1 flex items-center gap-3">
              {agent.hostname}
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                {agent.status === 'online'
                  ? 'bg-flexoki-green/10 text-flexoki-green'
                  : 'bg-tx-3/10 text-tx-3'}">
                <span class="w-1.5 h-1.5 rounded-full {agent.status === 'online' ? 'bg-flexoki-green animate-pulse' : 'bg-tx-3'}"></span>
                {agent.status}
              </span>
            </h1>
            <p class="text-sm text-tx-3 mt-1">
              {agent.os} &middot; {agent.tailscaleIp}
            </p>
          </div>
        </div>

        {#if agent.status === 'online'}
          <button
            class="btn btn-primary"
            onclick={() => showNewInstanceModal = true}
          >
            <span>+</span> New Instance
          </button>
        {/if}
      </div>
    </header>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="card p-4">
        <div class="text-2xl font-semibold text-tx-1">{runningInstances.length}</div>
        <div class="text-sm text-tx-3">Running Instances</div>
      </div>
      <div class="card p-4">
        <div class="text-2xl font-semibold text-tx-1">{agentInstances.length}</div>
        <div class="text-sm text-tx-3">Total Instances</div>
      </div>
      <div class="card p-4">
        <div class="text-2xl font-semibold text-tx-1">
          {agent.status === 'online' ? 'Connected' : 'Disconnected'}
        </div>
        <div class="text-sm text-tx-3">Status</div>
      </div>
    </div>

    <!-- Instances -->
    <section>
      <h2 class="text-lg font-semibold text-tx-1 mb-4">Instances</h2>

      {#if agentInstances.length > 0}
        <div class="space-y-3">
          {#each agentInstances as instance}
            <a
              href="/instances/{instance.id}"
              class="card card-interactive p-4 flex items-center justify-between"
            >
              <div>
                <div class="font-medium text-tx-1">{instance.cwd}</div>
                <div class="text-sm text-tx-3">{instance.status}</div>
              </div>
              <span class="w-2 h-2 rounded-full {
                instance.status === 'running' ? 'bg-flexoki-green animate-pulse' :
                instance.status === 'error' ? 'bg-flexoki-red' :
                'bg-tx-3'
              }"></span>
            </a>
          {/each}
        </div>
      {:else}
        <div class="text-center py-12 text-tx-3">
          <p>No instances yet.</p>
          {#if agent.status === 'online'}
            <button
              class="btn btn-primary mt-4"
              onclick={() => showNewInstanceModal = true}
            >
              Start First Instance
            </button>
          {/if}
        </div>
      {/if}
    </section>
  </div>

  <NewInstanceModal
    bind:open={showNewInstanceModal}
    onClose={() => showNewInstanceModal = false}
  />
{:else}
  <div class="text-center py-12">
    <h1 class="text-xl font-semibold text-tx-1 mb-2">Agent Not Found</h1>
    <p class="text-tx-3 mb-4">This agent may have disconnected or doesn't exist.</p>
    <a href="/agents" class="btn btn-primary">Back to Agents</a>
  </div>
{/if}

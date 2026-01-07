<script lang="ts">
  import Modal from './Modal.svelte';
  import AuthRequiredModal from './AuthRequiredModal.svelte';
  import FileBrowser from './FileBrowser.svelte';
  import { agents, projects } from '$lib/stores/realtime.svelte';
  import { spawnInstance } from '$lib/actions';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open = $bindable(), onClose }: Props = $props();

  let agentId = $state('');
  let cwd = $state('');
  let projectId = $state('');
  let prompt = $state('');
  let loading = $state(false);
  let error = $state('');
  let showAuthModal = $state(false);
  let authError = $state('');
  let showFileBrowser = $state(false);

  // Get online agents
  $effect(() => {
    const onlineAgents = Array.from($agents.values()).filter(a => a.status === 'online');
    if (onlineAgents.length > 0 && !agentId) {
      agentId = onlineAgents[0].id;
    }
  });

  // Get selected agent name for auth modal
  let selectedAgentName = $derived(
    $agents.get(agentId)?.name || 'the agent'
  );

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = '';

    if (!agentId) {
      error = 'Please select an agent';
      return;
    }

    if (!cwd) {
      error = 'Working directory is required';
      return;
    }

    loading = true;

    const result = await spawnInstance({
      agentId,
      cwd,
      projectId: projectId || undefined,
      prompt: prompt || undefined,
    });

    loading = false;

    if (result.success) {
      // Reset form and close
      agentId = '';
      cwd = '';
      projectId = '';
      prompt = '';
      onClose();
    } else if (result.authRequired) {
      // Show auth modal instead of error
      authError = result.error || '';
      showAuthModal = true;
    } else {
      error = result.error || 'Failed to spawn instance';
    }
  }

  function handleClose() {
    error = '';
    showFileBrowser = false;
    onClose();
  }

  function handlePathSelect(path: string) {
    cwd = path;
    showFileBrowser = false;
  }

  function openFileBrowser() {
    if (agentId) {
      showFileBrowser = true;
    }
  }
</script>

<Modal {open} title="New Instance" onClose={handleClose}>
  {#snippet children()}
    <form onsubmit={handleSubmit} class="space-y-4">
      {#if error}
        <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          {error}
        </div>
      {/if}

      <div>
        <label for="agent" class="block text-sm font-medium text-tx-2 mb-1.5">
          Agent <span class="text-red-500">*</span>
        </label>
        <select
          id="agent"
          bind:value={agentId}
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Select an agent...</option>
          {#each Array.from($agents.values()).filter(a => a.status === 'online') as agent}
            <option value={agent.id}>{agent.name} ({agent.os})</option>
          {/each}
        </select>
        {#if Array.from($agents.values()).filter(a => a.status === 'online').length === 0}
          <p class="mt-1 text-xs text-tx-3">No agents online. Start an agent with "cockpit agent"</p>
        {/if}
      </div>

      <div>
        <label for="cwd" class="block text-sm font-medium text-tx-2 mb-1.5">
          Working Directory <span class="text-red-500">*</span>
        </label>
        {#if showFileBrowser && agentId}
          <div class="h-80 rounded-xl border border-ui-1 overflow-hidden bg-bg-1">
            <FileBrowser
              agentId={agentId}
              initialPath={cwd || undefined}
              onSelect={handlePathSelect}
            />
          </div>
          <button
            type="button"
            onclick={() => showFileBrowser = false}
            class="mt-2 text-sm text-tx-3 hover:text-tx-1 transition-colors"
          >
            Cancel browsing
          </button>
        {:else}
          <div class="flex gap-2">
            <input
              id="cwd"
              type="text"
              bind:value={cwd}
              placeholder="/path/to/project"
              class="flex-1 px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                     placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onclick={openFileBrowser}
              disabled={!agentId}
              class="px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-2
                     hover:bg-bg-3 hover:text-tx-1 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
              title={agentId ? 'Browse files on agent' : 'Select an agent first'}
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          </div>
        {/if}
      </div>

      <div>
        <label for="project" class="block text-sm font-medium text-tx-2 mb-1.5">
          Project (optional)
        </label>
        <select
          id="project"
          bind:value={projectId}
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="">No project</option>
          {#each Array.from($projects.values()) as project}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="prompt" class="block text-sm font-medium text-tx-2 mb-1.5">
          Initial Prompt (optional)
        </label>
        <textarea
          id="prompt"
          bind:value={prompt}
          placeholder="What would you like Claude to do?"
          rows="3"
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
                 resize-none"
        ></textarea>
      </div>

      <div class="flex gap-3 pt-2">
        <button
          type="button"
          onclick={handleClose}
          class="flex-1 px-4 py-2.5 rounded-xl bg-bg-2 text-tx-2 font-medium
                 hover:bg-bg-3 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !agentId || !cwd}
          class="flex-1 px-4 py-2.5 rounded-xl bg-primary text-white font-medium
                 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Starting...' : 'Start Instance'}
        </button>
      </div>
    </form>
  {/snippet}
</Modal>

<AuthRequiredModal
  bind:open={showAuthModal}
  onClose={() => showAuthModal = false}
  agentName={selectedAgentName}
  error={authError}
/>

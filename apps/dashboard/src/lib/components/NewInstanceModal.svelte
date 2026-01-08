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

  let machineId = $state('');
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
    if (onlineAgents.length > 0 && !machineId) {
      machineId = onlineAgents[0].machineId;
    }
  });

  // Get selected agent name for auth modal
  let selectedAgentName = $derived(
    $agents.get(machineId)?.name || 'the agent'
  );

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = '';

    if (!machineId) {
      error = 'Please select a machine';
      return;
    }

    if (!cwd) {
      error = 'Working directory is required';
      return;
    }

    loading = true;

    const result = await spawnInstance({
      machineId,
      cwd,
      projectId: projectId || undefined,
      prompt: prompt || undefined,
    });

    loading = false;

    if (result.success) {
      // Reset form and close
      machineId = '';
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
    if (machineId) {
      showFileBrowser = true;
    }
  }
</script>

<Modal {open} title="New Instance" onClose={handleClose}>
  {#snippet children()}
    <form onsubmit={handleSubmit} class="space-y-5">
      {#if error}
        <div class="flex items-center gap-2 p-3 rounded-lg bg-error-light border border-error/20 text-error text-sm">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      {/if}

      <div class="space-y-1.5">
        <label for="agent" class="block text-sm font-medium text-text">
          Machine <span class="text-error">*</span>
        </label>
        <select
          id="agent"
          bind:value={machineId}
          class="input"
        >
          <option value="">Select a machine...</option>
          {#each Array.from($agents.values()).filter(a => a.status === 'online') as agent}
            <option value={agent.machineId}>{agent.name} ({agent.os})</option>
          {/each}
        </select>
        {#if Array.from($agents.values()).filter(a => a.status === 'online').length === 0}
          <p class="text-xs text-text-muted italic">No machines online. Start an agent with <code class="px-1 bg-surface-hover rounded text-[10px]">cockpit agent</code></p>
        {/if}
      </div>

      <div class="space-y-1.5">
        <label for="cwd" class="block text-sm font-medium text-text">
          Working Directory <span class="text-error">*</span>
        </label>
        {#if showFileBrowser && machineId}
          <div class="h-80 rounded-lg border border-border overflow-hidden bg-bg">
            <FileBrowser
              machineId={machineId}
              initialPath={cwd || undefined}
              onSelect={handlePathSelect}
            />
          </div>
          <button
            type="button"
            onclick={() => showFileBrowser = false}
            class="mt-2 text-sm text-secondary hover:underline transition-colors"
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
              class="input font-mono"
            />
            <button
              type="button"
              onclick={openFileBrowser}
              disabled={!machineId}
              class="px-3 rounded-md border border-border hover:bg-surface-hover text-text-secondary
                     disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={machineId ? 'Browse files on machine' : 'Select a machine first'}
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          </div>
        {/if}
      </div>

      <div class="space-y-1.5">
        <label for="project" class="block text-sm font-medium text-text">
          Project <span class="text-text-muted font-normal text-xs">(optional)</span>
        </label>
        <select
          id="project"
          bind:value={projectId}
          class="input"
        >
          <option value="">No project</option>
          {#each Array.from($projects.values()) as project}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="prompt" class="block text-sm font-medium text-text">
          Initial Prompt <span class="text-text-muted font-normal text-xs">(optional)</span>
        </label>
        <textarea
          id="prompt"
          bind:value={prompt}
          placeholder="What would you like Claude to do?"
          rows="3"
          class="input resize-none"
        ></textarea>
      </div>

      <div class="flex gap-3 pt-2">
        <button
          type="button"
          onclick={handleClose}
          class="btn btn-secondary flex-1"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !machineId || !cwd}
          class="btn btn-primary flex-1"
        >
          {#if loading}
            <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <span>Starting...</span>
          {:else}
            <span>Start Instance</span>
          {/if}
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

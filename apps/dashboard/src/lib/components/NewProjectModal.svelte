<script lang="ts">
  import Modal from './Modal.svelte';
  import { agents } from '$lib/stores/realtime';
  import { createProject } from '$lib/actions';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open = $bindable(), onClose }: Props = $props();

  let name = $state('');
  let description = $state('');
  let rootPath = $state('');
  let agentId = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = '';

    if (!name.trim()) {
      error = 'Project name is required';
      return;
    }

    loading = true;

    const result = await createProject({
      name: name.trim(),
      description: description.trim() || undefined,
      rootPath: rootPath.trim() || undefined,
      agentId: agentId || undefined,
    });

    loading = false;

    if (result.success) {
      // Reset form and close
      name = '';
      description = '';
      rootPath = '';
      agentId = '';
      onClose();
    } else {
      error = result.error || 'Failed to create project';
    }
  }

  function handleClose() {
    error = '';
    onClose();
  }
</script>

<Modal {open} title="New Project" onClose={handleClose}>
  {#snippet children()}
    <form onsubmit={handleSubmit} class="space-y-4">
      {#if error}
        <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          {error}
        </div>
      {/if}

      <div>
        <label for="name" class="block text-sm font-medium text-tx-2 mb-1.5">
          Project Name <span class="text-red-500">*</span>
        </label>
        <input
          id="name"
          type="text"
          bind:value={name}
          placeholder="My Awesome Project"
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div>
        <label for="description" class="block text-sm font-medium text-tx-2 mb-1.5">
          Description (optional)
        </label>
        <textarea
          id="description"
          bind:value={description}
          placeholder="A brief description of the project..."
          rows="2"
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
                 resize-none"
        ></textarea>
      </div>

      <div>
        <label for="rootPath" class="block text-sm font-medium text-tx-2 mb-1.5">
          Root Path (optional)
        </label>
        <input
          id="rootPath"
          type="text"
          bind:value={rootPath}
          placeholder="/path/to/project"
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p class="mt-1 text-xs text-tx-3">Default working directory for instances in this project</p>
      </div>

      <div>
        <label for="agent" class="block text-sm font-medium text-tx-2 mb-1.5">
          Default Agent (optional)
        </label>
        <select
          id="agent"
          bind:value={agentId}
          class="w-full px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Any available agent</option>
          {#each Array.from($agents.values()) as agent}
            <option value={agent.id}>{agent.name} ({agent.os})</option>
          {/each}
        </select>
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
          disabled={loading || !name.trim()}
          class="flex-1 px-4 py-2.5 rounded-xl bg-primary text-white font-medium
                 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Creating...' : 'Create Project'}
        </button>
      </div>
    </form>
  {/snippet}
</Modal>

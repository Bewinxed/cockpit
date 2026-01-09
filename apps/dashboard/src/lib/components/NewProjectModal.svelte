<script lang="ts">
  import Modal from './Modal.svelte';
  import { Button } from '$lib/components/ui/button';
  import { agents } from '$lib/stores/realtime.svelte';
  import { createProject } from '$lib/actions';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open = $bindable(), onClose }: Props = $props();

  let name = $state('');
  let description = $state('');
  let rootPath = $state('');
  let machineId = $state('');
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
      machineId: machineId || undefined,
    });

    loading = false;

    if (result.success) {
      // Reset form and close
      name = '';
      description = '';
      rootPath = '';
      machineId = '';
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
        <div class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      {/if}

      <div class="space-y-1.5">
        <label for="name" class="block text-sm font-medium text-foreground">
          Project Name <span class="text-destructive">*</span>
        </label>
        <input
          id="name"
          type="text"
          bind:value={name}
          placeholder="My Awesome Project"
          class="input"
        />
      </div>

      <div class="space-y-1.5">
        <label for="description" class="block text-sm font-medium text-foreground">
          Description <span class="text-muted-foreground font-normal text-xs">(optional)</span>
        </label>
        <textarea
          id="description"
          bind:value={description}
          placeholder="A brief description of the project..."
          rows="2"
          class="input resize-none"
        ></textarea>
      </div>

      <div class="space-y-1.5">
        <label for="rootPath" class="block text-sm font-medium text-foreground">
          Root Path <span class="text-muted-foreground font-normal text-xs">(optional)</span>
        </label>
        <input
          id="rootPath"
          type="text"
          bind:value={rootPath}
          placeholder="/path/to/project"
          class="input font-mono"
        />
        <p class="text-xs text-muted-foreground">Default working directory for instances in this project</p>
      </div>

      <div class="space-y-1.5">
        <label for="agent" class="block text-sm font-medium text-foreground">
          Default Machine <span class="text-muted-foreground font-normal text-xs">(optional)</span>
        </label>
        <select
          id="agent"
          bind:value={machineId}
          class="input"
        >
          <option value="">Any available machine</option>
          {#each Array.from($agents.values()) as agent}
            <option value={agent.machineId}>{agent.name} ({agent.os})</option>
          {/each}
        </select>
      </div>

      <div class="flex gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          onclick={handleClose}
          class="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading || !name.trim()}
          class="flex-1"
        >
          {loading ? 'Creating...' : 'Create Project'}
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>

<script lang="ts">
  import Modal from '../ui/Modal.svelte';
  import { Check, LoaderCircle } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';

  interface ModelInfo {
    value: string;
    displayName: string;
    description: string;
  }

  interface Props {
    open: boolean;
    instanceId: string;
    onClose: () => void;
    onModelChange?: (model: string) => void;
  }

  let {
    open,
    instanceId,
    onClose,
    onModelChange,
  }: Props = $props();

  let models = $state<ModelInfo[]>([]);
  let currentModel = $state<string | undefined>(undefined);
  let selectedModel = $state<string | undefined>(undefined);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // Fetch models when modal opens
  $effect(() => {
    if (open && instanceId) {
      fetchModels();
    }
  });

  async function fetchModels() {
    loading = true;
    error = null;

    try {
      const response = await fetch(`/api/instances/${instanceId}/models`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch models');
      }

      models = data.data.models || [];
      currentModel = data.data.currentModel;
      selectedModel = currentModel;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to fetch models';
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (!selectedModel || selectedModel === currentModel) {
      onClose();
      return;
    }

    saving = true;
    error = null;

    try {
      const response = await fetch(`/api/instances/${instanceId}/models`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to set model');
      }

      currentModel = selectedModel;
      onModelChange?.(selectedModel);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to set model';
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open || loading) return;

    const currentIndex = models.findIndex(m => m.value === selectedModel);

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = currentIndex > 0 ? currentIndex - 1 : models.length - 1;
      selectedModel = models[newIndex]?.value;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = currentIndex < models.length - 1 ? currentIndex + 1 : 0;
      selectedModel = models[newIndex]?.value;
    } else if (e.key === 'Enter' && !saving) {
      e.preventDefault();
      handleSave();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Modal {open} {onClose} title="Switch Model" size="md">
  {#if loading}
      <div class="flex items-center justify-center py-8">
        <LoaderCircle class="w-6 h-6 animate-spin text-muted-foreground" />
        <span class="ml-2 text-muted-foreground">Loading models...</span>
      </div>
    {:else if error}
      <div class="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
        {error}
      </div>
    {:else if models.length === 0}
      <div class="text-center py-8 text-muted-foreground">
        No models available
      </div>
    {:else}
      <div class="space-y-1 max-h-80 overflow-y-auto">
        {#each models as model (model.value)}
          <button
            type="button"
            class="w-full text-left px-4 py-3 rounded-lg transition-colors flex items-start gap-3
              {selectedModel === model.value
                ? 'bg-accent/10 border border-accent/30'
                : 'hover:bg-accent border border-transparent'}"
            onclick={() => selectedModel = model.value}
          >
            <div class="shrink-0 w-5 h-5 mt-0.5">
              {#if selectedModel === model.value}
                <Check class="w-5 h-5 text-accent" />
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium text-foreground">{model.displayName}</span>
                {#if currentModel === model.value}
                  <span class="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">current</span>
                {/if}
              </div>
              <p class="text-sm text-muted-foreground mt-0.5 line-clamp-2">{model.description}</p>
            </div>
          </button>
        {/each}
      </div>

      <p class="mt-4 text-xs text-muted-foreground text-center">
        Use ↑↓ to navigate, Enter to select
      </p>
  {/if}

  {#snippet footer()}
    <div class="flex justify-end gap-3">
      <Button
        variant="ghost"
        onclick={onClose}
        disabled={saving}
      >
        Cancel
      </Button>
      <Button
        onclick={handleSave}
        disabled={loading || saving || !selectedModel || selectedModel === currentModel}
      >
        {#if saving}
          <LoaderCircle class="w-4 h-4 animate-spin" />
        {/if}
        Apply
      </Button>
    </div>
  {/snippet}
</Modal>

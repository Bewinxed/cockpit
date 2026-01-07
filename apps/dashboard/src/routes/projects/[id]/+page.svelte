<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { projects, instances, agents } from '$lib/stores/realtime.svelte';
  import { deleteProject, updateProject } from '$lib/actions';
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';
  import { Button, Badge, Card, EmptyState, Input, LoadingButton } from '$lib/components/ui';
  import { formatDistanceToNow, formatTimestamp } from '$lib/utils/time';
  import {
    ArrowLeft,
    Plus,
    Terminal,
    FolderOpen,
    Calendar,
    DollarSign,
    Pencil,
    Trash2,
    Save,
    X,
    AlertCircle,
    FolderKanban
  } from 'lucide-svelte';

  // Get project ID from params
  const projectId = $derived(page.params.id);

  // Get project from store
  const project = $derived($projects.get(projectId));

  // Get instances for this project
  const projectInstances = $derived(
    Array.from($instances.values())
      .filter((i) => i.projectId === projectId)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  const runningInstances = $derived(
    projectInstances.filter((i) => i.status === 'running' || i.status === 'starting')
  );

  // Get agent for this project
  const agent = $derived(project?.agentId ? $agents.get(project.agentId) : undefined);

  // Calculate total cost
  const totalCost = $derived(
    projectInstances.reduce((sum, i) => sum + (i.totalCostUsd || 0), 0)
  );

  // UI State
  let showNewInstanceModal = $state(false);
  let isEditing = $state(false);
  let deleting = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // Edit form state
  let editName = $state('');
  let editDescription = $state('');
  let editRootPath = $state('');

  function startEditing() {
    if (!project) return;
    editName = project.name;
    editDescription = project.description || '';
    editRootPath = project.rootPath || '';
    isEditing = true;
  }

  function cancelEditing() {
    isEditing = false;
    error = null;
  }

  async function saveChanges() {
    if (!project || saving) return;

    saving = true;
    error = null;

    try {
      const result = await updateProject(projectId, {
        name: editName,
        description: editDescription || undefined,
        rootPath: editRootPath || undefined,
      });

      if (result.success) {
        isEditing = false;
      } else {
        error = result.error || 'Failed to update project';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!project || deleting) return;

    if (!confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`)) {
      return;
    }

    deleting = true;
    error = null;

    try {
      const result = await deleteProject(projectId);
      if (result.success) {
        goto('/projects');
      } else {
        error = result.error || 'Failed to delete project';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      deleting = false;
    }
  }

  const formattedCost = $derived(
    totalCost > 0 ? `$${totalCost.toFixed(2)}` : '$0.00'
  );

  const createdAt = $derived(
    project?.createdAt ? formatTimestamp(new Date(project.createdAt)) : null
  );
</script>

<svelte:head>
  <title>{project?.name || 'Project'} | Cockpit</title>
</svelte:head>

<div class="page-container animate-fade-in">
  {#if project}
    <!-- Header -->
    <header class="mb-8">
      <div class="flex items-center gap-4 mb-4">
        <a
          href="/projects"
          class="p-2 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft class="w-5 h-5 text-text-secondary" />
        </a>
        <span class="text-text-muted">Projects</span>
      </div>

      {#if isEditing}
        <!-- Edit Mode -->
        <Card padding="lg" class="mb-6">
          <div class="space-y-4">
            <Input
              label="Project Name"
              bind:value={editName}
              placeholder="Enter project name"
            />

            <div class="flex flex-col gap-1.5">
              <label for="edit-description" class="text-sm font-medium text-text">Description</label>
              <textarea
                id="edit-description"
                bind:value={editDescription}
                placeholder="Enter project description (optional)"
                rows={3}
                class="input resize-none"
              ></textarea>
            </div>

            <Input
              label="Root Path"
              bind:value={editRootPath}
              placeholder="/path/to/project"
              hint="The default working directory for instances in this project"
            />

            {#if error}
              <div class="flex items-center gap-2 text-sm text-error">
                <AlertCircle class="w-4 h-4" />
                <span>{error}</span>
              </div>
            {/if}

            <div class="flex items-center gap-3 pt-2">
              <LoadingButton variant="default" onclick={saveChanges} loading={saving}>
                <Save class="size-4" />
                Save Changes
              </LoadingButton>
              <Button variant="ghost" onclick={cancelEditing} disabled={saving}>
                <X class="size-4" />
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      {:else}
        <!-- View Mode -->
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-5">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center
                        text-white text-2xl font-semibold shadow-md">
              {project.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 class="text-2xl font-semibold text-text mb-1">{project.name}</h1>
              {#if project.description}
                <p class="text-text-secondary mb-2">{project.description}</p>
              {/if}
              <div class="flex items-center gap-4 text-sm text-text-secondary">
                {#if project.rootPath}
                  <div class="flex items-center gap-1.5">
                    <FolderOpen class="w-4 h-4 text-text-muted" />
                    <span class="font-mono text-xs">{project.rootPath}</span>
                  </div>
                {/if}
                {#if createdAt}
                  <div class="flex items-center gap-1.5">
                    <Calendar class="w-4 h-4 text-text-muted" />
                    <span>Created {createdAt}</span>
                  </div>
                {/if}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onclick={startEditing}>
              <Pencil class="size-4" />
              Edit
            </Button>
            <LoadingButton variant="destructive" size="sm" onclick={handleDelete} loading={deleting}>
              <Trash2 class="size-4" />
              Delete
            </LoadingButton>
          </div>
        </div>
      {/if}
    </header>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center">
            <Terminal class="w-5 h-5 text-success" />
          </div>
          <div>
            <div class="text-2xl font-bold text-text">{runningInstances.length}</div>
            <div class="text-sm text-text-secondary">Running</div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
            <Terminal class="w-5 h-5 text-primary" />
          </div>
          <div>
            <div class="text-2xl font-bold text-text">{projectInstances.length}</div>
            <div class="text-sm text-text-secondary">Total Instances</div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-warning-light flex items-center justify-center">
            <DollarSign class="w-5 h-5 text-warning" />
          </div>
          <div>
            <div class="text-xl font-bold text-text">{formattedCost}</div>
            <div class="text-sm text-text-secondary">Total Cost</div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-info-light flex items-center justify-center">
            <FolderKanban class="w-5 h-5 text-info" />
          </div>
          <div>
            <div class="text-lg font-bold text-text truncate">{agent?.name || 'Any Agent'}</div>
            <div class="text-sm text-text-secondary">Default Agent</div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Instances -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <h2 class="section-title mb-0">Instances in this Project</h2>
        <Button variant="default" size="sm" onclick={() => showNewInstanceModal = true}>
          <Plus class="size-4" />
          New Instance
        </Button>
      </div>

      <div class="space-y-3">
        {#each projectInstances as instance (instance.id)}
          <InstanceCard {instance} />
        {:else}
          <Card padding="lg">
            <EmptyState
              icon={Terminal}
              title="No instances yet"
              description="Start a new Claude Code instance in this project"
              action={{ label: 'New Instance', onClick: () => showNewInstanceModal = true }}
            />
          </Card>
        {/each}
      </div>
    </section>

    <NewInstanceModal
      bind:open={showNewInstanceModal}
      onClose={() => showNewInstanceModal = false}
    />
  {:else}
    <!-- Project not found -->
    <div class="flex items-center justify-center min-h-[400px]">
      <EmptyState
        icon={AlertCircle}
        title="Project not found"
        description="This project may have been deleted or doesn't exist"
        action={{ label: 'Back to Projects', onClick: () => goto('/projects') }}
      />
    </div>
  {/if}
</div>

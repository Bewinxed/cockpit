<script lang="ts">
  import NewProjectModal from '$lib/components/NewProjectModal.svelte';
  import { Button, Input, Card, EmptyState } from '$lib/components/ui';
  import { projects, instances } from '$lib/stores/realtime';
  import { Plus, Search, FolderKanban, Terminal, ArrowRight } from 'lucide-svelte';

  let searchQuery = $state('');
  let showNewProjectModal = $state(false);

  // Get projects as array from Map store
  let projectsList = $derived(Array.from($projects.values()));

  let filteredProjects = $derived(
    projectsList
      .filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.description || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  );

  // Get instance counts per project
  function getProjectInstanceCount(projectId: string): number {
    return Array.from($instances.values()).filter((i) => i.projectId === projectId).length;
  }

  // Get random gradient colors for project avatars
  const gradients = [
    'from-primary to-secondary',
    'from-success to-info',
    'from-warning to-error',
    'from-info to-primary',
    'from-secondary to-error',
    'from-success to-warning',
  ];

  function getGradient(index: number): string {
    return gradients[index % gradients.length];
  }
</script>

<svelte:head>
  <title>Projects | Cockpit</title>
</svelte:head>

<div class="page-container animate-fade-in">
  <!-- Header -->
  <header class="page-header">
    <div>
      <h1 class="page-title">Projects</h1>
      <p class="page-description">Organize your Claude Code instances by project</p>
    </div>
    <Button variant="default" onclick={() => showNewProjectModal = true}>
      {#snippet icon()}<Plus class="w-4 h-4" />{/snippet}
      {#snippet children()}New Project{/snippet}
    </Button>
  </header>

  <NewProjectModal bind:open={showNewProjectModal} onClose={() => showNewProjectModal = false} />

  <!-- Search -->
  <div class="mb-6 max-w-md">
    <Input
      type="text"
      placeholder="Search projects..."
      bind:value={searchQuery}
      icon={Search}
    />
  </div>

  <!-- Projects Grid -->
  <div class="grid-cards">
    {#each filteredProjects as project, i (project.id)}
      {@const instanceCount = getProjectInstanceCount(project.id)}
      <a href="/projects/{project.id}" class="card card-interactive p-5 group">
        <div class="flex items-start justify-between mb-4">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br {getGradient(i)} flex items-center justify-center
                      text-white text-lg font-semibold shadow-sm">
            {project.name.charAt(0).toUpperCase()}
          </div>
          <div class="flex items-center gap-1.5 text-xs text-text-secondary bg-surface-hover px-2 py-1 rounded-lg">
            <Terminal class="w-3.5 h-3.5" />
            <span>{instanceCount}</span>
          </div>
        </div>

        <h3 class="font-semibold text-text mb-1 group-hover:text-primary transition-colors">
          {project.name}
        </h3>

        {#if project.description}
          <p class="text-sm text-text-secondary mb-3 line-clamp-2">{project.description}</p>
        {:else}
          <p class="text-sm text-text-muted mb-3 italic">No description</p>
        {/if}

        {#if project.rootPath}
          <p class="text-xs text-text-muted font-mono truncate">{project.rootPath}</p>
        {/if}

        <div class="mt-4 flex items-center gap-1 text-sm text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          <span>View project</span>
          <ArrowRight class="w-4 h-4" />
        </div>
      </a>
    {:else}
      <div class="col-span-full">
        <EmptyState
          icon={FolderKanban}
          title={searchQuery ? 'No projects found' : 'No projects yet'}
          description={searchQuery
            ? 'Try a different search term'
            : 'Create your first project to organize your work'}
          action={!searchQuery
            ? { label: 'Create Project', onClick: () => showNewProjectModal = true }
            : undefined}
        />
      </div>
    {/each}
  </div>
</div>

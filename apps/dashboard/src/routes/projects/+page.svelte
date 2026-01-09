<script lang="ts">
  import NewProjectModal from '$lib/components/NewProjectModal.svelte';
  import { Button, Input, Card, EmptyState } from '$lib/components/ui';
  import { projects, populatedInstances } from '$lib/stores/realtime.svelte';
  import { Plus, Search, FolderKanban, Terminal, ArrowUpRight } from 'lucide-svelte';

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
    return $populatedInstances.filter((i) => i.projectId === projectId).length;
  }

  // Project accent colors (Swiss industrial palette)
  const accentColors = [
    'bg-primary',
    'bg-info',
    'bg-secondary',
    'bg-success',
    'bg-warning',
    'bg-error',
  ];

  function getAccentColor(index: number): string {
    return accentColors[index % accentColors.length];
  }
</script>

<svelte:head>
  <title>Projects | Cockpit</title>
</svelte:head>

<div class="p-8 max-w-[1400px] mx-auto animate-fade-in">
  <!-- Header -->
  <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
    <div>
      <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em] mb-2 block">Organization</span>
      <h1 class="text-4xl font-sans font-bold text-foreground tracking-tight">Projects</h1>
      <p class="text-muted-foreground mt-2 text-sm">Organize your Claude Code instances by project</p>
    </div>
    <Button variant="default" onclick={() => showNewProjectModal = true}>
      <Plus class="size-4" />
      New Project
    </Button>
  </header>

  <NewProjectModal bind:open={showNewProjectModal} onClose={() => showNewProjectModal = false} />

  <!-- Search -->
  <div class="bg-card border border-border mb-6">
    <div class="p-4 border-b border-border">
      <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.15em]">Search</span>
    </div>
    <div class="p-4">
      <div class="max-w-md">
        <Input
          type="text"
          placeholder="Search projects..."
          bind:value={searchQuery}
        />
      </div>
    </div>
  </div>

  <!-- Projects Grid -->
  <div class="bg-card border border-border">
    <div class="p-4 border-b border-border flex items-center gap-3">
      <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
      <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.15em]">
        {filteredProjects.length} {filteredProjects.length === 1 ? 'Project' : 'Projects'}
      </span>
    </div>

    {#if filteredProjects.length > 0}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
        {#each filteredProjects as project, i (project.id)}
          {@const instanceCount = getProjectInstanceCount(project.id)}
          <a href="/projects/{project.id}" class="bg-card p-5 group hover:bg-accent/50 transition-colors relative">
            <!-- Accent stripe -->
            <div class="absolute top-0 left-0 w-1 h-full {getAccentColor(i)}"></div>

            <div class="pl-3">
              <div class="flex items-start justify-between mb-4">
                <div class="w-10 h-10 {getAccentColor(i)} flex items-center justify-center
                            text-primary-foreground text-lg font-sans font-bold">
                  {project.name.charAt(0).toUpperCase()}
                </div>
                <div class="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider bg-muted border border-border px-2 py-1">
                  <Terminal class="w-3 h-3" />
                  <span>{instanceCount}</span>
                </div>
              </div>

              <h3 class="font-sans font-bold text-lg text-foreground mb-1 group-hover:text-primary transition-colors">
                {project.name}
              </h3>

              {#if project.description}
                <p class="text-sm text-muted-foreground mb-3 line-clamp-2">{project.description}</p>
              {:else}
                <p class="text-sm text-muted-foreground mb-3 italic">No description</p>
              {/if}

              {#if project.rootPath}
                <p class="text-[10px] text-muted-foreground font-mono truncate bg-muted border border-border px-2 py-1 inline-block max-w-full">{project.rootPath}</p>
              {/if}

              <div class="mt-4 flex items-center gap-1 text-xs font-mono text-primary uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                <span>View</span>
                <ArrowUpRight class="w-3.5 h-3.5" />
              </div>
            </div>
          </a>
        {/each}
      </div>
    {:else}
      <div class="p-12">
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
    {/if}
  </div>
</div>

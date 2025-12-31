<script lang="ts">
  import { onMount } from 'svelte';
  import { projects, fetchProjects } from '$lib/stores/realtime';

  onMount(() => {
    fetchProjects();
  });

  // Mock data for initial UI
  const mockProjects = [
    { id: '1', name: 'Dashboard', description: 'Cockpit dashboard UI', rootPath: '/home/user/dev/cockpit/apps/dashboard', instanceCount: 2, updatedAt: new Date() },
    { id: '2', name: 'API Server', description: 'Backend API service', rootPath: '/home/user/dev/api-server', instanceCount: 1, updatedAt: new Date() },
    { id: '3', name: 'CLI Tool', description: 'Command line interface', rootPath: '/home/user/dev/cli', instanceCount: 0, updatedAt: new Date() },
  ];

  let searchQuery = '';

  $: filteredProjects = mockProjects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );
</script>

<svelte:head>
  <title>Projects | Cockpit</title>
</svelte:head>

<div class="max-w-6xl">
  <header class="flex justify-between items-start mb-8">
    <div>
      <h1 class="text-2xl font-semibold text-tx-1 mb-1">Projects</h1>
      <p class="text-sm text-tx-3">Organize your Claude Code instances by project</p>
    </div>
    <button class="btn btn-primary">
      <span>+</span>
      New Project
    </button>
  </header>

  <!-- Search -->
  <div class="mb-6">
    <input
      type="text"
      placeholder="Search projects..."
      bind:value={searchQuery}
      class="w-full max-w-md px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
             placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
             transition-all"
    />
  </div>

  <!-- Projects Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each filteredProjects as project}
      <a href="/projects/{project.id}" class="card card-interactive group">
        <div class="flex items-start justify-between mb-3">
          <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-lg
                      group-hover:bg-primary group-hover:text-white transition-colors">
            <span class="font-medium">{project.name.charAt(0)}</span>
          </div>
          <span class="text-xs text-tx-3 bg-bg-3 px-2 py-1 rounded-lg">
            {project.instanceCount} {project.instanceCount === 1 ? 'instance' : 'instances'}
          </span>
        </div>

        <h3 class="font-medium text-tx-1 mb-1 group-hover:text-primary transition-colors">
          {project.name}
        </h3>

        {#if project.description}
          <p class="text-sm text-tx-3 mb-3 line-clamp-2">{project.description}</p>
        {/if}

        {#if project.rootPath}
          <p class="text-xs text-tx-3 font-mono truncate">{project.rootPath}</p>
        {/if}
      </a>
    {/each}
  </div>

  {#if filteredProjects.length === 0}
    <div class="text-center py-12">
      <div class="text-4xl mb-4">
        {searchQuery ? '🔍' : '📁'}
      </div>
      <h3 class="text-lg font-medium text-tx-1 mb-2">
        {searchQuery ? 'No projects found' : 'No projects yet'}
      </h3>
      <p class="text-sm text-tx-3 mb-4">
        {searchQuery ? 'Try a different search term' : 'Create your first project to organize your work'}
      </p>
      {#if !searchQuery}
        <button class="btn btn-primary">Create Project</button>
      {/if}
    </div>
  {/if}
</div>

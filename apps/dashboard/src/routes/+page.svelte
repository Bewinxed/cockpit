<script lang="ts">
  import StatsCard from '$lib/components/StatsCard.svelte';
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import AgentCard from '$lib/components/AgentCard.svelte';

  // Mock data - will be replaced with real data from stores
  const stats = {
    instances: { count: 3, label: 'Active Instances', trend: '+2 today' },
    agents: { count: 4, label: 'Connected Agents', trend: 'All online' },
    tasks: { count: 12, label: 'Tasks Completed', trend: '+5 this hour' },
    cost: { value: '$2.34', label: "Today's Cost", trend: '↓ 15% vs yesterday' }
  };

  const recentInstances = [
    {
      id: '1',
      name: 'Frontend Refactor',
      status: 'running' as const,
      agent: 'MacBook Pro',
      project: 'Dashboard',
      lastActivity: '2 min ago'
    },
    {
      id: '2',
      name: 'API Integration',
      status: 'running' as const,
      agent: 'WSL Desktop',
      project: 'Backend',
      lastActivity: '5 min ago'
    },
    {
      id: '3',
      name: 'Bug Fix #234',
      status: 'stopped' as const,
      agent: 'MacBook Pro',
      project: null,
      lastActivity: '1 hour ago'
    }
  ];

  const agents = [
    { id: '1', name: 'MacBook Pro', os: 'darwin' as const, status: 'online' as const, instances: 2, ip: '100.64.0.1' },
    { id: '2', name: 'WSL Desktop', os: 'linux' as const, status: 'online' as const, instances: 1, ip: '100.64.0.2' },
    { id: '3', name: 'Windows Workstation', os: 'windows' as const, status: 'online' as const, instances: 0, ip: '100.64.0.3' }
  ];
</script>

<svelte:head>
  <title>Dashboard | Cockpit</title>
</svelte:head>

<div class="max-w-6xl">
  <!-- Header -->
  <header class="flex justify-between items-start mb-8">
    <div>
      <h1 class="text-2xl font-semibold text-tx-1 mb-1">Dashboard</h1>
      <p class="text-sm text-tx-3">Manage your Claude Code instances across all devices</p>
    </div>
    <button class="btn btn-primary">
      <span>+</span>
      New Instance
    </button>
  </header>

  <!-- Stats Grid -->
  <section class="grid grid-cols-4 gap-4 mb-8">
    <StatsCard
      icon="○"
      count={stats.instances.count}
      label={stats.instances.label}
      trend={stats.instances.trend}
      color="blue"
    />
    <StatsCard
      icon="●"
      count={stats.agents.count}
      label={stats.agents.label}
      trend={stats.agents.trend}
      color="green"
    />
    <StatsCard
      icon="✓"
      count={stats.tasks.count}
      label={stats.tasks.label}
      trend={stats.tasks.trend}
      color="purple"
    />
    <StatsCard
      icon="◇"
      count={stats.cost.value}
      label={stats.cost.label}
      trend={stats.cost.trend}
      color="orange"
    />
  </section>

  <!-- Content Grid -->
  <div class="grid grid-cols-5 gap-6">
    <!-- Recent Instances -->
    <section class="col-span-3 bg-bg-2 rounded-2xl p-6 border border-ui-1">
      <div class="flex justify-between items-center mb-5">
        <h2 class="text-base font-semibold text-tx-1">Recent Instances</h2>
        <a href="/instances" class="text-sm text-tx-3 hover:text-primary transition-colors">
          View all →
        </a>
      </div>
      <div class="flex flex-col gap-3">
        {#each recentInstances as instance}
          <InstanceCard {instance} />
        {/each}
      </div>
    </section>

    <!-- Connected Agents -->
    <section class="col-span-2 bg-bg-2 rounded-2xl p-6 border border-ui-1">
      <div class="flex justify-between items-center mb-5">
        <h2 class="text-base font-semibold text-tx-1">Connected Agents</h2>
        <a href="/agents" class="text-sm text-tx-3 hover:text-primary transition-colors">
          View all →
        </a>
      </div>
      <div class="flex flex-col gap-3">
        {#each agents as agent}
          <AgentCard {agent} />
        {/each}
      </div>
    </section>
  </div>
</div>

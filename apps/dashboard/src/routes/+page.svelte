<script lang="ts">
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import AgentCard from '$lib/components/AgentCard.svelte';
  import StatsCard from '$lib/components/StatsCard.svelte';

  // Mock data - will be replaced with real data from stores
  const stats = {
    instances: { count: 3, label: 'Active Instances', trend: '+2 today' },
    agents: { count: 4, label: 'Connected Agents', trend: 'All online' },
    tasks: { count: 12, label: 'Tasks Completed', trend: '+5 this hour' },
    cost: { value: '$2.34', label: 'Today\'s Cost', trend: '↓ 15% vs yesterday' }
  };

  const recentInstances = [
    { id: '1', name: 'Frontend Refactor', status: 'running', agent: 'MacBook Pro', project: 'Dashboard', lastActivity: '2 min ago' },
    { id: '2', name: 'API Integration', status: 'running', agent: 'WSL Desktop', project: 'Backend', lastActivity: '5 min ago' },
    { id: '3', name: 'Bug Fix #234', status: 'stopped', agent: 'MacBook Pro', project: null, lastActivity: '1 hour ago' },
  ];

  const agents = [
    { id: '1', name: 'MacBook Pro', os: 'darwin', status: 'online', instances: 2, ip: '100.64.0.1' },
    { id: '2', name: 'WSL Desktop', os: 'linux', status: 'online', instances: 1, ip: '100.64.0.2' },
    { id: '3', name: 'Windows Workstation', os: 'windows', status: 'online', instances: 0, ip: '100.64.0.3' },
  ];
</script>

<svelte:head>
  <title>Dashboard | Cockpit</title>
</svelte:head>

<div class="dashboard">
  <header class="header">
    <div>
      <h1>Dashboard</h1>
      <p class="subtitle">Manage your Claude Code instances across all devices</p>
    </div>
    <button class="btn btn-primary">
      <span>+</span>
      New Instance
    </button>
  </header>

  <section class="stats-grid">
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

  <div class="content-grid">
    <section class="section">
      <div class="section-header">
        <h2>Recent Instances</h2>
        <a href="/instances" class="link">View all →</a>
      </div>
      <div class="instances-list">
        {#each recentInstances as instance}
          <InstanceCard {instance} />
        {/each}
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <h2>Connected Agents</h2>
        <a href="/agents" class="link">View all →</a>
      </div>
      <div class="agents-list">
        {#each agents as agent}
          <AgentCard {agent} />
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .dashboard {
    max-width: 1200px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--space-6);
  }

  .header h1 {
    margin-bottom: var(--space-1);
  }

  .subtitle {
    color: var(--tx-3);
    font-size: 0.9375rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: var(--space-5);
  }

  .section {
    background: var(--bg-2);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    border: 1px solid var(--ui-1);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }

  .section-header h2 {
    font-size: 1rem;
    font-weight: 600;
  }

  .link {
    font-size: 0.875rem;
    color: var(--tx-3);
  }

  .link:hover {
    color: var(--primary);
  }

  .instances-list,
  .agents-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (max-width: 1200px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .content-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

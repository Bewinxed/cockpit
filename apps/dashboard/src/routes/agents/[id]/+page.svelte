<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { agents, instances } from '$lib/stores/realtime.svelte';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import { Button, Badge, Card, EmptyState } from '$lib/components/ui';
  import AppleIcon from '$lib/components/icons/AppleIcon.svelte';
  import LinuxIcon from '$lib/components/icons/LinuxIcon.svelte';
  import WindowsIcon from '$lib/components/icons/WindowsIcon.svelte';
  import { formatDistanceToNow } from '$lib/utils/time';
  import {
    ArrowLeft,
    Plus,
    Terminal,
    Activity,
    Clock,
    Wifi,
    AlertCircle
  } from 'lucide-svelte';

  let showNewInstanceModal = $state(false);

  // Get agent ID from params
  const agentId = $derived(page.params.id);

  // Get agent from store
  const agent = $derived($agents.get(agentId));

  // Get instances for this agent
  const agentInstances = $derived(
    Array.from($instances.values())
      .filter((i) => i.agentId === agentId)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  const runningInstances = $derived(
    agentInstances.filter((i) => i.status === 'running' || i.status === 'starting')
  );

  const osConfig = {
    darwin: { icon: AppleIcon, label: 'macOS' },
    linux: { icon: LinuxIcon, label: 'Linux' },
    windows: { icon: WindowsIcon, label: 'Windows' },
  };

  const osInfo = $derived(agent ? osConfig[agent.os] : null);

  const connectedTime = $derived(
    agent?.connectedAt ? formatDistanceToNow(new Date(agent.connectedAt)) : null
  );
</script>

<svelte:head>
  <title>{agent?.name || 'Agent'} | Cockpit</title>
</svelte:head>

<div class="page-container animate-fade-in">
  {#if agent}
    <!-- Header -->
    <header class="mb-8">
      <div class="flex items-center gap-4 mb-4">
        <a
          href="/agents"
          class="p-2 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft class="w-5 h-5 text-text-secondary" />
        </a>
        <span class="text-text-muted">Agents</span>
      </div>

      <div class="flex items-start justify-between">
        <div class="flex items-center gap-5">
          <div class="w-16 h-16 rounded-2xl bg-surface-hover flex items-center justify-center">
            {#if osInfo}
              <osInfo.icon class="w-8 h-8 text-text" />
            {/if}
          </div>
          <div>
            <div class="flex items-center gap-3 mb-1">
              <h1 class="text-2xl font-semibold text-text">{agent.name}</h1>
              <Badge variant={agent.status === 'online' ? 'default' : 'secondary'}>
                {agent.status === 'online' ? 'Online' : 'Offline'}
              </Badge>
            </div>
            <div class="flex items-center gap-4 text-sm text-text-secondary">
              {#if osInfo}
                <span>{osInfo.label}</span>
                <span class="text-text-muted">·</span>
              {/if}
              <span class="font-mono">{agent.ip || 'No IP'}</span>
              {#if connectedTime && agent.status === 'online'}
                <span class="text-text-muted">·</span>
                <span>Connected {connectedTime}</span>
              {/if}
            </div>
          </div>
        </div>

        {#if agent.status === 'online'}
          <Button variant="default" onclick={() => showNewInstanceModal = true}>
            <Plus class="size-4" />
            New Instance
          </Button>
        {/if}
      </div>
    </header>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center">
            <Activity class="w-5 h-5 text-success" />
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
            <div class="text-2xl font-bold text-text">{agentInstances.length}</div>
            <div class="text-sm text-text-secondary">Total Instances</div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-{agent.status === 'online' ? 'success' : 'surface'}-light flex items-center justify-center">
            <Wifi class="w-5 h-5 {agent.status === 'online' ? 'text-success' : 'text-text-muted'}" />
          </div>
          <div>
            <div class="text-xl font-bold text-text">
              {agent.status === 'online' ? 'Connected' : 'Disconnected'}
            </div>
            <div class="text-sm text-text-secondary">Status</div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-info-light flex items-center justify-center">
            <Clock class="w-5 h-5 text-info" />
          </div>
          <div>
            <div class="text-lg font-bold text-text">{connectedTime || 'N/A'}</div>
            <div class="text-sm text-text-secondary">Uptime</div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Instances -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <h2 class="section-title mb-0">Instances on this Agent</h2>
        {#if agent.status === 'online' && agentInstances.length > 0}
          <Button variant="ghost" size="sm" onclick={() => showNewInstanceModal = true}>
            <Plus class="size-4" />
            Add
          </Button>
        {/if}
      </div>

      <div class="space-y-3">
        {#each agentInstances as instance (instance.id)}
          <InstanceCard {instance} />
        {:else}
          <Card padding="lg">
            <EmptyState
              icon={Terminal}
              title="No instances yet"
              description={agent.status === 'online'
                ? 'Start a new Claude Code instance on this agent'
                : 'This agent is offline. Connect it to start instances.'}
              action={agent.status === 'online'
                ? { label: 'New Instance', onClick: () => showNewInstanceModal = true }
                : undefined}
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
    <!-- Agent not found -->
    <div class="flex items-center justify-center min-h-[400px]">
      <EmptyState
        icon={AlertCircle}
        title="Agent not found"
        description="This agent may have disconnected or doesn't exist"
        action={{ label: 'Back to Agents', onClick: () => goto('/agents') }}
      />
    </div>
  {/if}
</div>

<script lang="ts">
  import { Terminal, ChevronRight } from 'lucide-svelte';
  import AppleIcon from '$lib/components/icons/AppleIcon.svelte';
  import LinuxIcon from '$lib/components/icons/LinuxIcon.svelte';
  import WindowsIcon from '$lib/components/icons/WindowsIcon.svelte';

  interface Agent {
    machineId: string;
    name: string;
    os: 'darwin' | 'linux' | 'windows';
    status: 'online' | 'reconnecting' | 'offline';
    instances: number;
    ip: string;
  }

  interface Props {
    agent: Agent;
  }

  let { agent }: Props = $props();

  const osConfig = {
    darwin: { icon: AppleIcon, label: 'macOS' },
    linux: { icon: LinuxIcon, label: 'Linux' },
    windows: { icon: WindowsIcon, label: 'Windows' },
  };

  const config = $derived(osConfig[agent.os]);
  const isOnline = $derived(agent.status === 'online');
</script>

<a
  href="/agents/{agent.machineId}"
  class="group block rounded-2xl bg-secondary/50 p-4
         hover:bg-secondary transition-colors"
>
  <div class="flex items-center gap-4">
    <!-- OS Icon -->
    <div class="flex-shrink-0 size-10 rounded-xl bg-background flex items-center justify-center">
      <config.icon class="size-5 text-muted-foreground" />
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-3">
        <h3 class="font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {agent.name}
        </h3>
        {#if isOnline}
          <span class="size-2 rounded-full bg-success animate-pulse"></span>
        {:else if agent.status === 'reconnecting'}
          <span class="size-2 rounded-full bg-warning animate-pulse"></span>
        {:else}
          <span class="size-2 rounded-full bg-muted-foreground/30"></span>
        {/if}
      </div>

      <div class="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
        <span>{config.label}</span>
        <span class="font-mono text-xs">{agent.ip}</span>
        <span class="flex items-center gap-1">
          <Terminal class="size-3.5" />
          {agent.instances}
        </span>
      </div>
    </div>

    <!-- Arrow -->
    <ChevronRight class="size-4 text-muted-foreground/40 group-hover:text-primary
                         group-hover:translate-x-0.5 transition-all flex-shrink-0" />
  </div>
</a>

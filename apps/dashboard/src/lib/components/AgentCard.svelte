<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import { Monitor, Terminal, ArrowRight } from 'lucide-svelte';

  // OS-specific icons as simple SVG components
  import AppleIcon from '$lib/components/icons/AppleIcon.svelte';
  import LinuxIcon from '$lib/components/icons/LinuxIcon.svelte';
  import WindowsIcon from '$lib/components/icons/WindowsIcon.svelte';

  interface Agent {
    id: string;
    name: string;
    os: 'darwin' | 'linux' | 'windows';
    status: 'online' | 'reconnecting' | 'offline';
    instances: number;
    ip: string;
  }

  interface Props {
    agent: Agent;
    compact?: boolean;
  }

  let { agent, compact = false }: Props = $props();

  const osConfig = {
    darwin: { icon: AppleIcon, label: 'macOS', color: 'text-text' },
    linux: { icon: LinuxIcon, label: 'Linux', color: 'text-warning' },
    windows: { icon: WindowsIcon, label: 'Windows', color: 'text-info' },
  };

  const config = $derived(osConfig[agent.os]);
</script>

<a
  href="/agents/{agent.id}"
  class="card card-interactive p-4 group"
>
  <div class="flex items-center gap-4">
    <!-- OS Icon -->
    <div class="flex-shrink-0">
      <div class="w-12 h-12 rounded-xl bg-surface-hover flex items-center justify-center group-hover:scale-105 transition-transform">
        <config.icon class="w-6 h-6 {config.color}" />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-1">
        <h3 class="font-medium text-text truncate group-hover:text-primary transition-colors">
          {agent.name}
        </h3>
        <Badge
          variant={agent.status === 'online' ? 'default' : agent.status === 'reconnecting' ? 'warning' : 'secondary'}
        >
          {agent.status === 'online' ? 'Online' : agent.status === 'reconnecting' ? 'Reconnecting' : 'Offline'}
        </Badge>
      </div>

      <div class="flex items-center gap-3 text-sm text-text-secondary">
        <span>{config.label}</span>
        <span class="text-text-muted">·</span>
        <span class="font-mono text-xs">{agent.ip}</span>
        <span class="text-text-muted">·</span>
        <div class="flex items-center gap-1">
          <Terminal class="w-3.5 h-3.5" />
          <span>{agent.instances} {agent.instances === 1 ? 'instance' : 'instances'}</span>
        </div>
      </div>
    </div>

    <!-- Arrow with slide effect -->
    <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <ArrowRight class="w-4 h-4 text-text-muted arrow-slide" />
    </div>
  </div>
</a>

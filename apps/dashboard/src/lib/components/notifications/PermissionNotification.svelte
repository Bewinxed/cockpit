<script lang="ts">
  import { Terminal, FileText, FolderOpen, Code } from 'lucide-svelte';
  import type { PermissionRequest } from '$lib/stores';

  interface Props {
    permission: PermissionRequest;
    instanceName: string;
    onClick: () => void;
  }

  let { permission, instanceName, onClick }: Props = $props();

  // Get icon based on tool name
  const ToolIcon = $derived.by(() => {
    const toolName = permission.toolName.toLowerCase();
    if (toolName.includes('read') || toolName.includes('file')) return FileText;
    if (toolName.includes('write') || toolName.includes('edit')) return Code;
    if (toolName.includes('bash') || toolName.includes('exec')) return Terminal;
    if (toolName.includes('glob') || toolName.includes('dir')) return FolderOpen;
    return Terminal;
  });

  // Format tool input for display
  const toolSummary = $derived.by(() => {
    const input = permission.toolInput;
    if (!input) return '';

    // Common patterns
    if ('command' in input && typeof input.command === 'string') {
      return input.command.slice(0, 60) + (input.command.length > 60 ? '...' : '');
    }
    if ('file_path' in input && typeof input.file_path === 'string') {
      return input.file_path;
    }
    if ('path' in input && typeof input.path === 'string') {
      return input.path;
    }
    if ('pattern' in input && typeof input.pattern === 'string') {
      return input.pattern;
    }

    // Fallback: stringify first few chars
    const str = JSON.stringify(input);
    return str.slice(0, 50) + (str.length > 50 ? '...' : '');
  });

  // Time ago
  const timeAgo = $derived.by(() => {
    const now = Date.now();
    const diff = now - permission.createdAt;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  });
</script>

<button
  class="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
  onclick={onClick}
>
  <!-- Icon -->
  <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center mt-0.5">
    <ToolIcon class="w-4 h-4 text-warning" />
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium text-foreground truncate">
        {permission.toolName}
      </span>
      <span class="text-xs text-muted-foreground">
        {timeAgo}
      </span>
    </div>

    <p class="text-xs text-muted-foreground mt-0.5 truncate">
      {toolSummary}
    </p>

    <div class="flex items-center gap-1.5 mt-1">
      <Terminal class="w-3 h-3 text-muted-foreground" />
      <span class="text-xs text-muted-foreground truncate">
        {instanceName}
      </span>
    </div>
  </div>

  <!-- Action indicator -->
  <div class="flex-shrink-0">
    <span class="text-xs text-warning font-medium">Review</span>
  </div>
</button>

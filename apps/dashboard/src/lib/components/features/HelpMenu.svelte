<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';

  interface Command {
    name: string;
    description?: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
  }

  interface Props {
    version: string;
    commands: Command[];
    onClose?: () => void;
  }

  let { version, commands, onClose }: Props = $props();

  type Tab = 'general' | 'commands' | 'custom-commands';
  let activeTab = $state<Tab>('general');

  const tabs: Tab[] = ['general', 'commands', 'custom-commands'];

  function nextTab() {
    const currentIndex = tabs.indexOf(activeTab);
    activeTab = tabs[(currentIndex + 1) % tabs.length];
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      nextTab();
    } else if (e.key === 'Escape') {
      onClose?.();
    }
  }

  // Filter commands by type
  const builtinCommands = $derived(commands.filter(c => c.type === 'builtin'));
  const customCommands = $derived(commands.filter(c => c.type === 'custom'));
  const skillCommands = $derived(commands.filter(c => c.type === 'skill'));
  const mcpCommands = $derived(commands.filter(c => c.type === 'mcp'));

  // Shortcuts data - matches Claude CLI
  const shortcuts = [
    { key: '!', description: 'for bash mode' },
    { key: '/', description: 'for commands' },
    { key: '@', description: 'for file paths' },
    { key: '&', description: 'for background' },
  ];

  const keyboardShortcuts = [
    { key: 'double tap esc', description: 'to clear input' },
    { key: 'ctrl + o', description: 'for verbose output' },
    { key: 'ctrl + t', description: 'to show todos' },
    { key: 'tab', description: 'to toggle thinking' },
    { key: 'ctrl + _', description: 'to undo' },
    { key: 'ctrl + z', description: 'to suspend' },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="font-mono text-sm bg-background border border-border rounded-lg overflow-hidden">
  <!-- Header with tabs -->
  <div class="flex items-center gap-4 px-4 py-2 bg-accent border-b border-border">
    <span class="text-foreground font-semibold">Claude Code v{version}</span>
    <div class="flex items-center gap-1 text-muted-foreground">
      {#each tabs as tab, i (tab)}
        <Button
          variant={activeTab === tab ? 'secondary' : 'ghost'}
          size="sm"
          class="h-6 px-2 text-xs"
          onclick={() => activeTab = tab}
        >
          {tab}
        </Button>
        {#if i < tabs.length - 1}
          <span class="text-muted-foreground/50">|</span>
        {/if}
      {/each}
    </div>
    <span class="text-muted-foreground text-xs ml-auto">(tab to cycle)</span>
  </div>

  <!-- Content -->
  <div class="p-4 min-h-[200px]">
    {#if activeTab === 'general'}
      <!-- Shortcuts section -->
      <div class="space-y-4">
        <h3 class="text-muted-foreground text-xs uppercase tracking-wide">Shortcuts</h3>

        <div class="grid grid-cols-2 gap-x-8 gap-y-1">
          <!-- Left column: prefix shortcuts -->
          <div class="space-y-1">
            {#each shortcuts as shortcut (shortcut.key)}
              <div class="flex items-center gap-2">
                <span class="text-primary font-bold w-4 text-center">{shortcut.key}</span>
                <span class="text-muted-foreground">{shortcut.description}</span>
              </div>
            {/each}
          </div>

          <!-- Right column: keyboard shortcuts -->
          <div class="space-y-1">
            {#each keyboardShortcuts as shortcut (shortcut.key)}
              <div class="flex items-center gap-2">
                <span class="text-muted-foreground">{shortcut.key}</span>
                <span class="text-muted-foreground">{shortcut.description}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- vim mode indicator (if applicable) -->
        <div class="pt-2 border-t border-border/50">
          <span class="text-muted-foreground text-xs">? for shortcuts</span>
        </div>
      </div>

    {:else if activeTab === 'commands'}
      <!-- Built-in commands list -->
      <div class="space-y-3">
        <h3 class="text-muted-foreground text-xs uppercase tracking-wide">Built-in Commands</h3>

        <div class="space-y-1">
          {#each builtinCommands as cmd (cmd.name)}
            <div class="flex items-start gap-2 group">
              <span class="text-primary font-medium">{cmd.name}</span>
              {#if cmd.description}
                <span class="text-muted-foreground">-</span>
                <span class="text-muted-foreground">{cmd.description}</span>
              {/if}
            </div>
          {/each}
        </div>

        {#if skillCommands.length > 0}
          <div class="pt-2 mt-2 border-t border-border/50">
            <h3 class="text-muted-foreground text-xs uppercase tracking-wide mb-2">Skills</h3>
            <div class="space-y-1">
              {#each skillCommands as cmd (cmd.name)}
                <div class="flex items-start gap-2 group">
                  <span class="text-secondary font-medium">{cmd.name}</span>
                  {#if cmd.description}
                    <span class="text-muted-foreground">-</span>
                    <span class="text-muted-foreground">{cmd.description}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if mcpCommands.length > 0}
          <div class="pt-2 mt-2 border-t border-border/50">
            <h3 class="text-muted-foreground text-xs uppercase tracking-wide mb-2">MCP Tools</h3>
            <div class="space-y-1">
              {#each mcpCommands as cmd (cmd.name)}
                <div class="flex items-start gap-2 group">
                  <span class="text-warning font-medium">{cmd.name}</span>
                  {#if cmd.description}
                    <span class="text-muted-foreground">-</span>
                    <span class="text-muted-foreground">{cmd.description}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

    {:else if activeTab === 'custom-commands'}
      <!-- Custom commands list -->
      <div class="space-y-3">
        <h3 class="text-muted-foreground text-xs uppercase tracking-wide">Custom Commands</h3>

        {#if customCommands.length === 0}
          <div class="text-muted-foreground py-4">
            <p>No custom commands defined.</p>
            <p class="mt-2 text-xs">
              Create custom commands by adding <code class="bg-accent px-1 rounded">.md</code> files to:
            </p>
            <p class="text-xs mt-1">
              <code class="bg-accent px-1 rounded">.claude/commands/</code>
            </p>
          </div>
        {:else}
          <div class="space-y-1">
            {#each customCommands as cmd (cmd.name)}
              <div class="flex items-start gap-2 group">
                <ChevronRight class="w-3 h-3 text-muted-foreground mt-1 flex-shrink-0" />
                <span class="text-success font-medium">{cmd.name}</span>
                {#if cmd.description}
                  <span class="text-muted-foreground">-</span>
                  <span class="text-muted-foreground">{cmd.description}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="px-4 py-2 border-t border-border bg-accent/50 text-xs text-muted-foreground flex items-center justify-between">
    <span>Press <kbd class="px-1 py-0.5 bg-card border border-border rounded text-[10px]">Tab</kbd> to switch tabs</span>
    <span>Press <kbd class="px-1 py-0.5 bg-card border border-border rounded text-[10px]">Esc</kbd> to close</span>
  </div>
</div>

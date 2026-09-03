<script lang="ts">
  import type { AvailableCommand } from "@whiffle/core";
  import {
    IconCodeFile,
    IconCommand,
    IconSettings,
    IconSkill,
  } from "$lib/icons";
  import { displayName, filterCommands, groupCommands } from "./command-groups";

  interface Props {
    commands: AvailableCommand[];
    filter: string;
    listboxId?: string;
    onSelect: (command: AvailableCommand) => void;
    optionIdPrefix?: string;
    selectedIndex: number;
  }

  let {
    commands,
    filter,
    selectedIndex,
    onSelect,
    listboxId = "cmd-list",
    optionIdPrefix = "cmd-opt",
  }: Props = $props();

  let itemRefs: HTMLButtonElement[] = $state([]);

  // Scroll selected item into view when index changes. Instant, not smooth:
  // held arrow keys outrun a tween and the list lags behind the highlight.
  $effect(() => {
    itemRefs[selectedIndex]?.scrollIntoView({ block: "nearest" });
  });

  // Filter commands based on input. Ordered the same way the composer's own
  // copy is, since `selectedIndex` is a plain index into it.
  let filteredCommands: AvailableCommand[] = $derived(
    filterCommands(commands, filter)
  );

  // Namespaces become headings between the rows; the rows keep their flat index.
  let groups = $derived(groupCommands(filteredCommands));

  function getCommandIcon(type: AvailableCommand["type"]) {
    switch (type) {
      case "builtin":
        return IconCommand;
      case "custom":
        return IconCodeFile;
      case "skill":
        return IconSkill;
      case "mcp":
        return IconSettings;
      default:
        return IconCommand;
    }
  }

  function getTypeLabel(type: AvailableCommand["type"]) {
    switch (type) {
      case "builtin":
        return "Built-in";
      case "custom":
        return "Custom";
      case "skill":
        return "Skill";
      case "mcp":
        return "MCP";
      default:
        return type;
    }
  }

  function getTypeColor(type: AvailableCommand["type"]) {
    switch (type) {
      case "builtin":
        return "bg-primary/20 text-primary";
      case "custom":
        return "bg-success/20 text-success";
      case "skill":
        return "bg-warning/20 text-warning";
      case "mcp":
        return "bg-info/20 text-info";
      default:
        return "bg-muted text-muted-foreground";
    }
  }
</script>

<!-- Plain content block — the input card gates, frames, and animates this -->
<div class="max-h-64 overflow-y-auto">
  <div class="p-2 border-b border-border">
    <span class="text-xs text-muted-foreground">
      Available commands ({filteredCommands.length})
    </span>
  </div>
  <div
    aria-label="Commands"
    class="p-2 space-y-0.5"
    id={listboxId}
    role="listbox"
  >
    {#each groups as group (group.source ?? '')}
      {#if group.source}
        <!-- A heading, not an option: the keyboard never lands on it. -->
        <div
          aria-hidden="true"
          class="px-2.5 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase"
        >
          {group.source}
        </div>
      {/if}
      {#each group.commands as command, offset (command.name)}
        {@const index = group.start + offset}
        {@const Icon = getCommandIcon(command.type)}
        <button
          aria-label={command.description
              ? `${command.name} — ${command.description}`
              : command.name}
          aria-selected={index === selectedIndex}
          class="w-full px-2.5 py-2 flex items-center gap-3 rounded-[var(--radius-control)] hover:bg-accent transition-colors text-left
                   {index === selectedIndex ? 'bg-accent text-accent-foreground' : ''}"
          id="{optionIdPrefix}-{index}"
          onclick={() => onSelect(command)}
          role="option"
          type="button"
          bind:this={itemRefs[index]}
        >
          <Icon class="w-4 h-4 text-muted-foreground shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-foreground"
                >{displayName(command)}</span
              >
              <span
                class="text-xs px-1.5 py-0.5 rounded {getTypeColor(command.type)}"
              >
                {getTypeLabel(command.type)}
              </span>
            </div>
            {#if command.description}
              <p class="text-xs text-muted-foreground truncate">
                {command.description}
              </p>
            {/if}
          </div>
        </button>
      {/each}
    {/each}
  </div>
  <div
    class="p-2 border-t border-border text-xs text-muted-foreground flex gap-4"
  >
    <span
      ><kbd class="px-1 bg-accent text-accent-foreground rounded">↑↓</kbd>
      navigate</span
    >
    <span
      ><kbd class="px-1 bg-accent text-accent-foreground rounded">↵</kbd>
      select</span
    >
    <span
      ><kbd class="px-1 bg-accent text-accent-foreground rounded">esc</kbd>
      close</span
    >
  </div>
</div>

<script lang="ts">
  import { Plus, ChevronDown, ChevronRight } from 'lucide-svelte';
  import * as SidebarUI from '$lib/components/ui/sidebar';
  import SidebarInstanceItem from '../sidebar/SidebarInstanceItem.svelte';
  import SidebarAgentItem from '../sidebar/SidebarAgentItem.svelte';
  import { stores, agents, ui } from '$lib/stores';

  interface Props {
    collapsed?: boolean;
    onNewInstance?: () => void;
  }

  let { collapsed = false, onNewInstance }: Props = $props();
</script>

<SidebarUI.Sidebar collapsible={collapsed ? 'icon' : 'none'} class="border-r border-border">
  <SidebarUI.SidebarContent>
    <!-- Instances Section -->
    <SidebarUI.SidebarGroup>
      <SidebarUI.SidebarGroupLabel class="flex items-center justify-between">
        <span>Instances</span>
        <span class="text-xs text-muted-foreground font-normal">
          {stores.stats.runningInstances} running
        </span>
      </SidebarUI.SidebarGroupLabel>

      <SidebarUI.SidebarGroupContent>
        <SidebarUI.SidebarMenu>
          {#each stores.instancesByProject as group (group.project?.id ?? '__unassigned__')}
            <!-- Project Group -->
            <SidebarUI.SidebarMenuItem>
              <SidebarUI.SidebarMenuButton
                onclick={() => ui.toggleProjectCollapse(group.project?.id || null)}
                tooltipContent={collapsed ? (group.project?.name || 'Unassigned') : undefined}
              >
                {#if group.isCollapsed}
                  <ChevronRight class="size-4" />
                {:else}
                  <ChevronDown class="size-4" />
                {/if}
                <span class="flex-1 truncate">
                  {group.project?.name || 'Unassigned'}
                </span>
                <SidebarUI.SidebarMenuBadge>
                  {group.instances.length}
                </SidebarUI.SidebarMenuBadge>
              </SidebarUI.SidebarMenuButton>

              <!-- Nested Instance Items -->
              {#if !group.isCollapsed}
                <SidebarUI.SidebarMenuSub>
                  {#each group.instances as instance (instance.id)}
                    <SidebarUI.SidebarMenuSubItem>
                      <SidebarInstanceItem
                        {instance}
                        {collapsed}
                      />
                    </SidebarUI.SidebarMenuSubItem>
                  {/each}
                </SidebarUI.SidebarMenuSub>
              {/if}
            </SidebarUI.SidebarMenuItem>
          {:else}
            <div class="px-2 py-4 text-center text-sm text-muted-foreground">
              No instances yet
            </div>
          {/each}

          <!-- New Instance Button -->
          <SidebarUI.SidebarMenuItem>
            <SidebarUI.SidebarMenuButton
              onclick={() => onNewInstance?.()}
              tooltipContent={collapsed ? 'New Instance' : undefined}
            >
              <Plus class="size-4" />
              <span>New Instance</span>
            </SidebarUI.SidebarMenuButton>
          </SidebarUI.SidebarMenuItem>
        </SidebarUI.SidebarMenu>
      </SidebarUI.SidebarGroupContent>
    </SidebarUI.SidebarGroup>

    <SidebarUI.SidebarSeparator />

    <!-- Agents Section -->
    <SidebarUI.SidebarGroup>
      <SidebarUI.SidebarGroupLabel class="flex items-center justify-between">
        <span>Agents</span>
        <span class="text-xs text-muted-foreground font-normal">
          {stores.stats.onlineAgents} online
        </span>
      </SidebarUI.SidebarGroupLabel>

      <SidebarUI.SidebarGroupContent>
        <SidebarUI.SidebarMenu>
          {#each Array.from(agents.all.values()) as agent (agent.machineId)}
            <SidebarUI.SidebarMenuItem>
              <SidebarAgentItem {agent} {collapsed} />
            </SidebarUI.SidebarMenuItem>
          {:else}
            <div class="px-2 py-4 text-center text-sm text-muted-foreground">
              No agents connected
            </div>
          {/each}
        </SidebarUI.SidebarMenu>
      </SidebarUI.SidebarGroupContent>
    </SidebarUI.SidebarGroup>
  </SidebarUI.SidebarContent>
</SidebarUI.Sidebar>

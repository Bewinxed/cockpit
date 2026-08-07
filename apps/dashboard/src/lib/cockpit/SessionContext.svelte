<script lang="ts">
  /**
   * What this session is running in, beside the chat rather than over it: the
   * CLAUDE.md files it reads (NEW.md §11), the MCP servers it can reach, and
   * the facts about the session itself. Three answers to "what is in front of
   * this model", which is one question and so one rail.
   *
   * The rail is always mounted — the kit slides it and animates the gap the
   * chat shrinks into — so the files are read on the rising edge of open rather
   * than on mount. The servers and the facts are the page's own live state.
   */
  import type { AvailableCommand, McpServerStatus, PermissionMode } from '@cockpit/core';
  import { IconClose } from '$lib/icons';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { CopyButton } from '$lib/components/ui/copy-button';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { useSidebar } from '$lib/components/ui/sidebar';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tabs from '$lib/components/ui/tabs';
  import MemoryCard from '$lib/components/features/MemoryCard.svelte';
  import type { SubagentState } from '$lib/utils/flow-types';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { machineFs } from './client.svelte';
  import { peekMemory } from './fleet';
  import { machineLabel } from './machine';
  import McpServerDetail from './McpServerDetail.svelte';
  import { modelLabel } from './models.svelte';
  import { permissionModeLabel } from './permission-modes';

  interface Props {
    instanceId: string;
    machineId: string;
    cwd: string;
    /** The session's live MCP status; null until the session has reported it. */
    servers: McpServerStatus[] | null;
    /** Its `/` menu, off the init frame — which is where its skills are named. */
    commands: AvailableCommand[];
    model: string | null;
    permissionMode: PermissionMode | null;
    sessionId: string | null;
    /** The machine's own name, when the fleet has one for it. */
    hostname: string | null;
    totalCostUsd: number;
    lastActivityAt: Date | null;
    branches: SubagentState[];
  }

  let {
    instanceId,
    machineId,
    cwd,
    servers,
    commands,
    model,
    permissionMode,
    sessionId,
    hostname,
    totalCostUsd,
    lastActivityAt,
    branches,
  }: Props = $props();

  const sidebar = useSidebar();
  /** The skills this very session listed, as its `/` menu classifies them. */
  const skills = $derived(commands.filter((command) => command.type === 'skill'));
  /** Bound to the kit's tabs, which own the value; a union would not bind to it. */
  let tab = $state('memory');

  /** The rail's own dot for a branch, in the colours the left one uses. */
  const BRANCH_DOT: Record<string, string> = {
    error: 'bg-destructive',
    running: 'bg-success',
    starting: 'bg-warning',
    complete: 'bg-muted-foreground/40',
  };

  let loading = $state(true);

  let user = $state<string | null>(null);
  let project = $state<string | null>(null);
  let local = $state<string | null>(null);
  /** Per scope: a real failure. A file that is not there is content null, not this. */
  let failed = $state<Record<'user' | 'project' | 'local', string | null>>({
    user: null,
    project: null,
    local: null,
  });

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** The `fs` verb's own sentence for a file that is not there. */
  const isMissing = (error: unknown) => message(error).includes('does not exist');

  async function readFile(path: string): Promise<{ content: string | null; error: string | null }> {
    try {
      return { content: await machineFs<string>(machineId, 'read', path), error: null };
    } catch (error) {
      return { content: null, error: isMissing(error) ? null : message(error) };
    }
  }

  async function load() {
    loading = true;
    const [userRead, projectRead, localRead] = await Promise.all([
      peekMemory(machineId)
        .then((copy) => ({ content: copy?.content ?? null, error: null }))
        .catch((error: unknown) => ({ content: null, error: message(error) })),
      readFile(`${cwd}/CLAUDE.md`),
      readFile(`${cwd}/CLAUDE.local.md`),
    ]);
    user = userRead.content;
    project = projectRead.content;
    local = localRead.content;
    failed = { user: userRead.error, project: projectRead.error, local: localRead.error };
    loading = false;
  }

  // Every opening is a fresh read: these files change under a running session,
  // which is the reason to be looking at them. On the rising edge only — the
  // rail stays mounted while it is closed, and a closed rail reads nothing.
  let wasOpen = false;
  $effect(() => {
    const open = sidebar.open || sidebar.openMobile;
    if (open && !wasOpen) void load();
    wasOpen = open;
  });

  const close = () => (sidebar.isMobile ? sidebar.setOpenMobile(false) : sidebar.setOpen(false));

  async function saveProject(text: string): Promise<boolean> {
    await machineFs(machineId, 'write', `${cwd}/CLAUDE.md`, text);
    project = text;
    failed.project = null;
    return true;
  }

  async function saveLocal(text: string): Promise<boolean> {
    await machineFs(machineId, 'write', `${cwd}/CLAUDE.local.md`, text);
    local = text;
    failed.local = null;
    return true;
  }
</script>

{#snippet fact(label: string, value: string, mono: boolean)}
  <div class="flex flex-col gap-0.5">
    <dt class="text-xs text-muted-foreground">{label}</dt>
    <dd class="text-sm break-all {mono ? 'font-mono' : ''}">{value}</dd>
  </div>
{/snippet}

{#snippet scope(name: string, problem: string | null)}
  <span class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
    <span>{name}</span>
    {#if problem}
      <span class="min-w-0 truncate text-error" role="alert">{problem}</span>
    {/if}
  </span>
{/snippet}

<!-- Offcanvas, so the kit animates the gap the chat shrinks into rather than
     the chat snapping to width when the rail mounts.

     The kit's desktop container is `fixed … h-svh`, which would lay the rail
     over the app's own header; anchored to the provider instead, it is exactly
     as tall as the session. Only from `md`, which is where the kit stops
     rendering the mobile sheet — that one is portalled and must stay fixed. -->
<Sidebar.Root side="right" collapsible="offcanvas" class="md:absolute md:h-full">
  <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-0">
    <!-- The kit's header stacks; this one is a row. -->
    <Sidebar.Header class="flex-row items-center gap-2 border-b border-border px-4 py-2">
      <Tabs.List>
        <Tabs.Trigger value="memory">Memory</Tabs.Trigger>
        <Tabs.Trigger value="mcp">MCP</Tabs.Trigger>
        <Tabs.Trigger value="skills">Skills</Tabs.Trigger>
        <Tabs.Trigger value="info">Info</Tabs.Trigger>
      </Tabs.List>
      <Button
        variant="ghost"
        size="icon-sm"
        class="ml-auto shrink-0 text-muted-foreground"
        aria-label="Close context panel"
        onclick={close}
      >
        <IconClose />
      </Button>
    </Sidebar.Header>

    <Sidebar.Content class="gap-4 p-4">
      <Tabs.Content value="memory" class="flex flex-col gap-4">
        <p class="text-[13px] text-muted-foreground">
          What Claude Code reads at <span class="font-mono">{cwd}</span> on this machine — user, project,
          then local.
        </p>

        {#if loading}
          {#each [0, 1, 2] as slot (slot)}
            <Skeleton class="h-32 w-full shrink-0 rounded-xl" />
          {/each}
        {:else}
          <MemoryCard
            path="~/.claude/CLAUDE.md"
            content={user}
            emptyText={failed.user
              ? 'This machine could not be asked for its user memory.'
              : 'No user CLAUDE.md on this machine.'}
          >
            {#snippet meta()}
              {@render scope('user', failed.user)}
            {/snippet}
            {#snippet actions()}
              <Button variant="ghost" size="xs" href="/tools?tab=memory">Manage</Button>
            {/snippet}
          </MemoryCard>

          <MemoryCard
            path="CLAUDE.md"
            content={project}
            save={saveProject}
            emptyText="No CLAUDE.md in this project — click to write one."
          >
            {#snippet meta()}
              {@render scope('project', failed.project)}
            {/snippet}
          </MemoryCard>

          <MemoryCard
            path="CLAUDE.local.md"
            content={local}
            save={saveLocal}
            emptyText="No CLAUDE.local.md — click to write one. Git never sees this file."
          >
            {#snippet meta()}
              {@render scope('local', failed.local)}
            {/snippet}
          </MemoryCard>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="mcp" class="flex flex-col gap-4">
        {#if servers === null}
          {#each [0, 1] as slot (slot)}
            <Skeleton class="h-28 w-full shrink-0 rounded-xl" />
          {/each}
        {:else if servers.length === 0}
          <p class="text-[13px] text-muted-foreground">No MCP servers in this session.</p>
        {:else}
          {#each servers as server (server.name)}
            <div class="shrink-0 rounded-xl border border-border p-3">
              <McpServerDetail {server} {instanceId} {machineId} />
            </div>
          {/each}
        {/if}
      </Tabs.Content>

      <Tabs.Content value="skills" class="flex flex-col gap-4">
        {#if skills.length === 0}
          <p class="text-[13px] text-muted-foreground">
            This session has listed no skills yet. The list arrives with the session's own init
            frame, so it fills in on the first turn.
          </p>
        {:else}
          <p class="text-[13px] text-muted-foreground">
            {skills.length} skill{skills.length === 1 ? '' : 's'} this session can reach, as its
            <span class="font-mono">/</span> menu lists them.
          </p>
          <ul class="flex flex-col rounded-xl border border-border">
            {#each skills as skill (skill.name)}
              <li class="flex flex-col gap-0.5 border-t border-border px-3 py-2 first:border-t-0">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="truncate font-mono text-[13px]">{skill.name}</span>
                  {#if skill.source}
                    <Badge variant="outline">{skill.source}</Badge>
                  {/if}
                </span>
                {#if skill.description}
                  <span class="line-clamp-2 text-xs text-muted-foreground">{skill.description}</span>
                {/if}
              </li>
            {/each}
          </ul>
          <p class="text-xs text-muted-foreground">
            Every machine's own skills are on
            <a class="underline underline-offset-4" href="/tools?tab=skills">the tools page</a>,
            where an unmanaged one can be adopted into the fleet.
          </p>
        {/if}
      </Tabs.Content>


      <Tabs.Content value="info" class="flex flex-col gap-4">
        <dl class="flex shrink-0 flex-col gap-3">
          {#if model}
            {@render fact('Model', modelLabel(model), false)}
          {/if}
          {#if hostname}
            {@render fact('Machine', machineLabel(hostname), false)}
          {/if}
          {@render fact('Directory', cwd, true)}
          {#if permissionMode}
            {@render fact('Permission mode', permissionModeLabel(permissionMode), false)}
          {/if}
          {#if totalCostUsd > 0}
            {@render fact('Cost', `$${totalCostUsd.toFixed(4)}`, false)}
          {/if}
          {#if lastActivityAt}
            {@render fact('Last activity', formatDistanceToNow(lastActivityAt), false)}
          {/if}
          {#if sessionId}
            <div class="flex flex-col gap-0.5">
              <dt class="text-xs text-muted-foreground">Session id</dt>
              <dd class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-mono text-sm">{sessionId}</span>
                <CopyButton
                  text={sessionId}
                  variant="ghost"
                  size="icon-sm"
                  class="shrink-0 text-muted-foreground"
                />
              </dd>
            </div>
          {/if}
        </dl>

        {#if branches.length > 0}
          <div class="flex shrink-0 flex-col gap-2">
            <h3 class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Subagents
            </h3>
            <ul class="flex flex-col gap-1">
              {#each branches as branch (branch.toolUseId)}
                <li>
                  <!-- The hash is the transcript's own jump: the page watches it
                       and scrolls virtua at the branch. -->
                  <Button
                    variant="ghost"
                    href="#subagent-{branch.toolUseId}"
                    class="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                    title={branch.description ?? branch.subagentType}
                  >
                    <span
                      class="size-1.5 shrink-0 rounded-full {BRANCH_DOT[branch.status] ??
                        'bg-muted-foreground/40'} {branch.status === 'running'
                        ? 'animate-pulse'
                        : ''}"
                    ></span>
                    <span class="min-w-0 flex-1 truncate text-left text-[13px]">
                      {branch.description ?? branch.subagentType}
                    </span>
                    {#if branch.model}
                      <span class="shrink-0 text-xs text-muted-foreground">
                        {modelLabel(branch.model)}
                      </span>
                    {/if}
                    <span class="shrink-0 text-xs text-muted-foreground">{branch.status}</span>
                  </Button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </Tabs.Content>
    </Sidebar.Content>
  </Tabs.Root>
</Sidebar.Root>

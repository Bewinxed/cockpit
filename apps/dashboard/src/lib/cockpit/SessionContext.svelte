<script lang="ts">
  /**
   * What this session is running in, beside the chat rather than over it: the
   * CLAUDE.md files it reads (NEW.md §11), the MCP servers it can reach, and
   * the facts about the session itself. Three answers to "what is in front of
   * this model", which is one question and so one rail.
   *
   * Nothing here is fetched twice: the memory files are read once on mount, and
   * the servers and the facts are the page's own live state, passed in.
   */
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { McpServerStatus, PermissionMode } from '@cockpit/core';
  import { IconClose } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { CopyButton } from '$lib/components/ui/copy-button';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
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
    model: string | null;
    permissionMode: PermissionMode | null;
    sessionId: string | null;
    /** The machine's own name, when the fleet has one for it. */
    hostname: string | null;
    totalCostUsd: number;
    lastActivityAt: Date | null;
    branches: SubagentState[];
    onclose: () => void;
  }

  let {
    instanceId,
    machineId,
    cwd,
    servers,
    model,
    permissionMode,
    sessionId,
    hostname,
    totalCostUsd,
    lastActivityAt,
    branches,
    onclose,
  }: Props = $props();

  let tab = $state<'memory' | 'mcp' | 'info'>('memory');

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

  // The panel is mounted only while it is open, so every open is a fresh read:
  // these files change under a running session, which is the reason to look.
  onMount(() => {
    void load();
  });

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

<!-- The wrapper carries the transition, which needs an element rather than a
     component; the rail itself is the kit's, like the one down the left. -->
<div
  class="flex h-full w-full shrink-0 md:w-auto"
  transition:fly={{ x: 16, duration: 200, easing: quintOut }}
  aria-label="Session context"
  role="complementary"
>
  <Sidebar.Root collapsible="none" class="h-full w-full border-l border-border md:w-[26rem]">
    <!-- The kit's header stacks; this one is a row. The tabs are the same
         control the session header swaps its two views with. -->
    <Sidebar.Header class="flex-row items-center gap-2 border-b border-border px-4 py-2">
      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        value={tab}
        onValueChange={(next) => {
          if (next) tab = next as 'memory' | 'mcp' | 'info';
        }}
        class="min-w-0"
        aria-label="Session context"
      >
        <ToggleGroup.Item value="memory" aria-controls="session-context-panel">
          Memory
        </ToggleGroup.Item>
        <ToggleGroup.Item value="mcp" aria-controls="session-context-panel">MCP</ToggleGroup.Item>
        <ToggleGroup.Item value="info" aria-controls="session-context-panel">Info</ToggleGroup.Item>
      </ToggleGroup.Root>
      <Button
        variant="ghost"
        size="icon-sm"
        class="ml-auto shrink-0 text-muted-foreground"
        aria-label="Close context panel"
        onclick={onclose}
      >
        <IconClose />
      </Button>
    </Sidebar.Header>

    <Sidebar.Content class="gap-4 p-4" id="session-context-panel">
      {#if tab === 'memory'}
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
      {:else if tab === 'mcp'}
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
      {:else}
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
      {/if}
    </Sidebar.Content>
  </Sidebar.Root>
</div>

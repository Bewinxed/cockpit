<script lang="ts">
  /**
   * The fleet's user-scope memory (NEW.md §11): `~/.claude/CLAUDE.md`, one
   * document for every machine, hash-synced the way a skill's files are. The
   * hub owns it and fans every write out, so nothing here loops over machines.
   *
   * The document is the page. Machines are only worth a row when they disagree
   * with it — everything that could lose a version is shown first: a machine
   * that edited its own copy is compared, not guessed at; a save against a row
   * somebody else moved says so instead of winning; and every version replaced
   * is in the history, one click from coming back.
   */
  import { toast } from 'svelte-sonner';
  import {
    IconCheck,
    IconChevronDown,
    IconChevronRight,
    IconSpinner,
    IconTrash,
    IconWarningTriangle,
  } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import DiffView from '$lib/components/features/DiffView.svelte';
  import MemoryCard from '$lib/components/features/MemoryCard.svelte';
  import { formatDistanceToNow } from '$lib/utils/time';
  import type { Machine } from './client.svelte';
  import {
    adoptMemory,
    formatBytes,
    memoryHistory,
    memoryVersion,
    peekMemory,
    pushMemory,
    removeMemory,
    restoreMemory,
    saveMemory,
    type FleetMemoryRow,
    type FleetMemoryVersion,
  } from './fleet';
  import { machineLabel } from './machine';

  let {
    memory = $bindable(),
    machines,
    settling,
    error,
  }: {
    /** The hub's row, replaced as writes land. Null while the fleet keeps none. */
    memory: FleetMemoryRow | null;
    machines: Machine[];
    settling: boolean;
    error: string | null;
  } = $props();

  let editing = $state(false);
  let clearing = $state(false);
  let saving = $state(false);
  /**
   * What the hub really has, when a save found the row moved, and the text that
   * save was carrying. The editor keeps the user's words — the choice between
   * the two is theirs, and it is made looking at the difference.
   */
  let conflict = $state<FleetMemoryRow | null>(null);
  let mine = $state('');

  /** Per machine: the row whose diff is open, and what peeking at it came to. */
  let comparing = $state<string | null>(null);
  let copies = $state<Record<string, { content: string; hash: string } | null>>({});
  let peeking = $state<Record<string, boolean>>({});
  let unread = $state<Record<string, string>>({});
  let busy = $state<Record<string, boolean>>({});

  /** The history, read on the first expand and again after anything replaces a version. */
  let historyOpen = $state(false);
  let versions = $state<FleetMemoryVersion[] | null>(null);
  let loadingHistory = $state(false);
  let historyError = $state<string | null>(null);
  let shown = $state<number | null>(null);
  let contents = $state<Record<number, string>>({});
  let reading = $state<Record<number, boolean>>({});
  let restoring = $state<number | null>(null);

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const bytes = $derived(memory ? new TextEncoder().encode(memory.content).length : 0);

  /** Machines are worth a row when they disagree; agreement is worth one line. */
  const applied = $derived(machines.filter((row) => row.fleet?.memory?.state === 'applied'));
  const drifted = $derived(machines.filter((row) => row.fleet?.memory?.state === 'failed'));
  const asleep = $derived(applied.filter((row) => row.status !== 'online'));
  const names = (rows: Machine[]) => rows.map((row) => machineLabel(row.hostname)).join(', ');

  /** Who a version came from, in the names the reader uses for their machines. */
  function sourceLabel(source: string): string {
    if (!source.startsWith('machine:')) return 'the fleet';
    const machineId = source.slice('machine:'.length);
    const machine = machines.find((row) => row.machineId === machineId);
    return machine ? machineLabel(machine.hostname) : machineId;
  }

  /** A version was replaced somewhere: the list says so without being re-opened. */
  async function refreshHistory() {
    if (versions === null) return;
    await loadHistory();
  }

  async function loadHistory() {
    loadingHistory = true;
    historyError = null;
    try {
      versions = await memoryHistory();
    } catch (error) {
      historyError = message(error);
    } finally {
      loadingHistory = false;
    }
  }

  function toggleHistory() {
    historyOpen = !historyOpen;
    if (historyOpen && versions === null && !loadingHistory) void loadHistory();
  }

  /** Every write goes through here, so the card and the history stay honest. */
  function landed(row: FleetMemoryRow) {
    memory = row;
    conflict = null;
    editing = false;
    void refreshHistory();
  }

  /** True when the write landed; false leaves the editor open over the conflict. */
  async function write(text: string, expectedHash: string | undefined): Promise<boolean> {
    const result = await saveMemory(text, expectedHash);
    if (result.ok) {
      landed(result.memory);
      return true;
    }
    mine = text;
    conflict = result.latest;
    return false;
  }

  const save = (text: string) => write(text, memory?.hash);

  /** The reader saw the difference and chose their own text: save against what is there now. */
  async function saveAnyway() {
    if (!conflict) return;
    saving = true;
    try {
      await write(mine, conflict.hash);
    } catch (error) {
      toast.error(message(error));
    } finally {
      saving = false;
    }
  }

  function takeLatest() {
    if (!conflict) return;
    memory = conflict;
    conflict = null;
    editing = false;
  }

  async function forget() {
    clearing = true;
    try {
      await removeMemory();
      memory = null;
      conflict = null;
      editing = false;
      await refreshHistory();
    } catch (error) {
      toast.error(message(error));
    } finally {
      clearing = false;
    }
  }

  /** What that machine really has, read once and kept while the diff is open. */
  async function compare(machine: Machine) {
    if (comparing === machine.machineId) {
      comparing = null;
      return;
    }
    comparing = machine.machineId;
    if (Object.hasOwn(copies, machine.machineId) || peeking[machine.machineId]) return;

    peeking[machine.machineId] = true;
    delete unread[machine.machineId];
    try {
      copies[machine.machineId] = await peekMemory(machine.machineId);
    } catch (error) {
      unread[machine.machineId] = message(error);
    } finally {
      delete peeking[machine.machineId];
    }
  }

  async function adopt(machine: Machine) {
    busy[machine.machineId] = true;
    try {
      landed(await adoptMemory(machine.machineId));
      comparing = null;
      delete copies[machine.machineId];
      toast.success(`The fleet now keeps ${machineLabel(machine.hostname)}'s memory.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[machine.machineId];
    }
  }

  async function overwrite(machine: Machine) {
    busy[machine.machineId] = true;
    try {
      await pushMemory(machine.machineId);
      comparing = null;
      delete copies[machine.machineId];
      await refreshHistory();
      toast.success(`${machineLabel(machine.hostname)} takes the fleet's copy.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      delete busy[machine.machineId];
    }
  }

  async function openVersion(row: FleetMemoryVersion) {
    if (shown === row.id) {
      shown = null;
      return;
    }
    shown = row.id;
    if (contents[row.id] !== undefined || reading[row.id]) return;

    reading[row.id] = true;
    try {
      contents[row.id] = (await memoryVersion(row.id)).content;
    } catch (error) {
      shown = null;
      toast.error(message(error));
    } finally {
      delete reading[row.id];
    }
  }

  async function restore(row: FleetMemoryVersion) {
    restoring = row.id;
    try {
      landed(await restoreMemory(row.id));
      shown = null;
      toast.success('Restored — every machine gets it.');
    } catch (error) {
      toast.error(message(error));
    } finally {
      restoring = null;
    }
  }
</script>

{#snippet driftedRow(machine: Machine)}
  {@const item = machine.fleet?.memory}
  {@const online = machine.status === 'online'}
  {@const open = comparing === machine.machineId}
  <li class="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <IconWarningTriangle class="size-3.5 shrink-0 text-warning" />
        <span class="truncate text-[13px] font-medium {online ? '' : 'opacity-60'}">
          {machineLabel(machine.hostname)}
        </span>
      </span>
      <span class="min-w-0 flex-1 text-xs text-muted-foreground">
        Kept its own copy.{online ? '' : ' Offline — it syncs when it comes back.'}
      </span>
      <Button
        variant={open ? 'secondary' : 'outline'}
        size="xs"
        class="shrink-0"
        disabled={!online}
        onclick={() => compare(machine)}
      >
        {open ? 'Hide' : 'Compare'}
      </Button>
      <!-- Closed, the two ways out are on the row itself: the diff is the way to
           choose well, not the only way to choose. -->
      {#if !open}
        <Button
          variant="outline"
          size="xs"
          class="shrink-0"
          disabled={!online || busy[machine.machineId] === true}
          onclick={() => adopt(machine)}
        >
          Adopt
        </Button>
        <Button
          variant="outline"
          size="xs"
          class="shrink-0"
          disabled={!online || busy[machine.machineId] === true}
          onclick={() => overwrite(machine)}
        >
          Overwrite
        </Button>
      {/if}
    </div>

    {#if item?.detail}
      <!-- Verbatim: what the machine said about its own copy. -->
      <pre
        class="max-h-24 overflow-auto rounded-lg bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap">{item.detail}</pre>
    {/if}

    {#if open}
      <div class="flex flex-col gap-2">
        {#if peeking[machine.machineId]}
          <p class="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
            <IconSpinner class="size-4 shrink-0 animate-spin" />
            Reading this machine's copy…
          </p>
        {:else if unread[machine.machineId]}
          <p class="text-[13px] text-warning" role="alert">{unread[machine.machineId]}</p>
        {:else if copies[machine.machineId] === null}
          <p class="text-[13px] text-muted-foreground">
            This machine has no user CLAUDE.md of its own.
          </p>
        {:else if copies[machine.machineId]}
          <!-- Left is the fleet's, right is this machine's: the reader is
               choosing which of the two the fleet should keep. -->
          {#key `${machine.machineId}:${memory?.hash ?? ''}`}
            <DiffView
              filePath="CLAUDE.md"
              oldContent={memory?.content ?? ''}
              newContent={copies[machine.machineId]?.content ?? ''}
            />
          {/key}
        {/if}
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={!online || busy[machine.machineId] === true}
            onclick={() => adopt(machine)}
          >
            Adopt this machine's copy
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={!online || busy[machine.machineId] === true}
            onclick={() => overwrite(machine)}
          >
            Overwrite it with the fleet's
          </Button>
        </div>
      </div>
    {/if}
  </li>
{/snippet}

<p class="max-w-prose text-[13px] text-muted-foreground">
  One memory for the fleet. What you write here is
  <span class="font-mono">~/.claude/CLAUDE.md</span> on every machine, so what you taught Claude Code
  on one of them is what it knows on all of them.
</p>

{#if error}
  <p class="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-warning" role="alert">
    {error}
  </p>
{:else}
  <MemoryCard
    path="~/.claude/CLAUDE.md"
    content={memory?.content ?? null}
    bind:editing
    {save}
    emptyText="The fleet keeps no memory yet. Click to write one — or adopt a machine's copy below."
  >
    {#snippet meta()}
      {#if memory}
        <span class="flex min-w-0 shrink items-baseline gap-x-3 text-xs text-muted-foreground">
          <span class="font-mono" title={memory.hash}>{memory.hash.slice(0, 8)}</span>
          <span>{formatBytes(bytes)}</span>
          <span class="truncate">saved {formatDistanceToNow(new Date(memory.updatedAt))}</span>
        </span>
      {/if}
    {/snippet}

    {#snippet actions()}
      <Button
        variant="ghost"
        size="xs"
        aria-expanded={historyOpen}
        class="text-muted-foreground"
        onclick={toggleHistory}
      >
        {#if historyOpen}
          <IconChevronDown class="shrink-0" />
        {:else}
          <IconChevronRight class="shrink-0" />
        {/if}
        History
      </Button>
      {#if memory}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground hover:text-destructive"
                aria-label="Delete the fleet memory"
                disabled={clearing}
                onclick={forget}
              >
                <IconTrash />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>
            Takes it off every machine that still has cockpit's copy
          </Tooltip.Content>
        </Tooltip.Root>
      {/if}
    {/snippet}

    {#snippet footer()}
      {#if conflict}
        <div class="flex flex-col gap-2 border-t border-border p-4">
          <p class="text-[13px] text-warning" role="alert">
            Changed elsewhere while you edited. Nothing was overwritten.
          </p>
          <!-- Keyed on the hash: a conflict that moves again re-renders against
               what is really there now. -->
          {#key conflict.hash}
            <DiffView filePath="CLAUDE.md" oldContent={conflict.content} newContent={mine} />
          {/key}
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="xs" disabled={saving} onclick={takeLatest}>
              Take latest
            </Button>
            <Button variant="outline" size="xs" disabled={saving} onclick={saveAnyway}>
              {saving ? 'Saving…' : 'Save mine anyway'}
            </Button>
          </div>
        </div>
      {/if}
    {/snippet}
  </MemoryCard>

  {#if historyOpen}
    {#if loadingHistory && versions === null}
      <Skeleton class="h-16 w-full rounded-xl" />
    {:else if historyError}
      <p class="text-[13px] text-warning" role="alert">{historyError}</p>
    {:else if (versions ?? []).length === 0}
      <p class="text-[13px] text-muted-foreground">
        Nothing replaced yet. Every version a save, an adopt or an overwrite replaces is kept here —
        the last twenty of them.
      </p>
    {:else}
      <ul class="flex flex-col rounded-xl border border-border bg-card">
        {#each versions ?? [] as row (row.id)}
          <li class="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="text-[13px]">{formatDistanceToNow(new Date(row.createdAt))}</span>
              <span class="text-xs text-muted-foreground">from {sourceLabel(row.source)}</span>
              <span class="font-mono text-xs text-muted-foreground" title={row.hash}>
                {row.hash.slice(0, 8)}
              </span>
              <span class="text-xs text-muted-foreground">{formatBytes(row.bytes)}</span>
              <Button
                variant={shown === row.id ? 'secondary' : 'outline'}
                size="xs"
                class="ml-auto shrink-0"
                onclick={() => openVersion(row)}
              >
                {shown === row.id ? 'Hide' : 'Compare'}
              </Button>
            </div>

            {#if shown === row.id}
              {#if reading[row.id]}
                <p class="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
                  <IconSpinner class="size-4 shrink-0 animate-spin" />
                  Reading that version…
                </p>
              {:else if contents[row.id] !== undefined}
                <!-- Left is the old version, right is what the fleet keeps now. -->
                {#key `${row.id}:${memory?.hash ?? ''}`}
                  <DiffView
                    filePath="CLAUDE.md"
                    oldContent={contents[row.id]}
                    newContent={memory?.content ?? ''}
                  />
                {/key}
                <Button
                  variant="outline"
                  size="xs"
                  class="self-start"
                  disabled={restoring === row.id}
                  onclick={() => restore(row)}
                >
                  {restoring === row.id ? 'Restoring…' : 'Restore this version'}
                </Button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if machines.length === 0 && settling}
    <Skeleton class="h-10 w-full rounded-xl" />
  {:else if machines.length === 0}
    <p class="text-[13px] text-muted-foreground">
      No machines yet — this lands on the first one that registers.
    </p>
  {:else if !memory}
    <!-- Nothing to be in sync with yet: every machine is a place to take one from. -->
    <ul class="flex flex-col rounded-xl border border-border bg-card">
      {#each machines as machine (machine.machineId)}
        {@const online = machine.status === 'online'}
        <li class="flex flex-wrap items-center gap-3 border-t border-border p-4 first:border-t-0">
          <span class="min-w-0 flex-1 truncate text-[13px] font-medium {online ? '' : 'opacity-60'}">
            {machineLabel(machine.hostname)}
          </span>
          <Button
            variant="outline"
            size="xs"
            class="shrink-0"
            disabled={!online || busy[machine.machineId] === true}
            onclick={() => adopt(machine)}
          >
            Adopt this machine's copy
          </Button>
        </li>
      {/each}
    </ul>
  {:else}
    {#if applied.length > 0}
      <p
        class="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground"
        title={names(applied)}
      >
        <IconCheck class="size-3.5 shrink-0 text-success" />
        <span>In sync on {applied.length} machine{applied.length === 1 ? '' : 's'}</span>
        {#if asleep.length > 0}
          <span>{names(asleep)} offline — they sync when back.</span>
        {/if}
      </p>
    {/if}

    {#if drifted.length > 0}
      <ul class="flex flex-col rounded-xl border border-border bg-card">
        {#each drifted as machine (machine.machineId)}
          {@render driftedRow(machine)}
        {/each}
      </ul>
      <p class="max-w-prose text-xs text-muted-foreground">
        A machine only ever gives back the copy cockpit wrote it. One edited on the machine itself is
        left where it is, and says so here until you take it or replace it.
      </p>
    {/if}
  {/if}
{/if}

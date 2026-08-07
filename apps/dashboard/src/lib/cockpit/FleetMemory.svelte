<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { IconCheck, IconChevronDown, IconChevronRight, IconSpinner, IconTrash, IconWarningTriangle } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import DiffView from '$lib/components/features/DiffView.svelte';
  import MemoryCard from '$lib/components/features/MemoryCard.svelte';
  import { formatDistanceToNow } from '$lib/utils/time';
  import type { Machine } from './client.svelte';
  import { adoptMemory, formatBytes, memoryHistory, memoryVersion, peekMemory, pushMemory, removeMemory, restoreMemory, saveMemory, type FleetMemoryRow, type FleetMemoryVersion } from './fleet';
  import { machineLabel } from './machine';

  let { memory = $bindable(), machines, settling, error }: {
    memory: FleetMemoryRow | null; machines: Machine[]; settling: boolean; error: string | null;
  } = $props();

  let editing = $state(false);
  let clearing = $state(false);
  let saving = $state(false);
  let conflict = $state<FleetMemoryRow | null>(null);
  let mine = $state('');
  let comparing = $state<string | null>(null);
  let copies = $state<Record<string, { content: string; hash: string } | null>>({});
  let peeking = $state<Record<string, boolean>>({});
  let unread = $state<Record<string, string>>({});
  let busy = $state<Record<string, boolean>>({});
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
  const applied = $derived(machines.filter((row) => row.fleet?.memory?.state === 'applied'));
  const drifted = $derived(machines.filter((row) => row.fleet?.memory?.state === 'failed'));
  const asleep = $derived(applied.filter((row) => row.status !== 'online'));
  const names = (rows: Machine[]) => rows.map((row) => machineLabel(row.hostname)).join(', ');

  function sourceLabel(source: string): string {
    if (!source.startsWith('machine:')) return 'the fleet';
    const machineId = source.slice('machine:'.length);
    const machine = machines.find((row) => row.machineId === machineId);
    return machine ? machineLabel(machine.hostname) : machineId;
  }

  async function refreshHistory() { if (versions === null) return; await loadHistory(); }
  async function loadHistory() {
    loadingHistory = true; historyError = null;
    try { versions = await memoryHistory(); } catch (error) { historyError = message(error); }
    finally { loadingHistory = false; }
  }
  function toggleHistory() { historyOpen = !historyOpen; if (historyOpen && versions === null && !loadingHistory) void loadHistory(); }

  function landed(row: FleetMemoryRow) { memory = row; conflict = null; editing = false; void refreshHistory(); }
  async function write(text: string, expectedHash: string | undefined): Promise<boolean> {
    const result = await saveMemory(text, expectedHash);
    if (result.ok) { landed(result.memory); return true; }
    mine = text; conflict = result.latest; return false;
  }
  const save = (text: string) => write(text, memory?.hash);

  async function saveAnyway() {
    if (!conflict) return; saving = true;
    try { await write(mine, conflict.hash); } catch (error) { toast.error(message(error)); }
    finally { saving = false; }
  }
  function takeLatest() { if (!conflict) return; memory = conflict; conflict = null; editing = false; }

  async function forget() {
    clearing = true;
    try { await removeMemory(); memory = null; conflict = null; editing = false; await refreshHistory(); }
    catch (error) { toast.error(message(error)); } finally { clearing = false; }
  }

  async function compare(machine: Machine) {
    if (comparing === machine.machineId) { comparing = null; return; }
    comparing = machine.machineId;
    if (Object.hasOwn(copies, machine.machineId) || peeking[machine.machineId]) return;
    peeking[machine.machineId] = true; delete unread[machine.machineId];
    try { copies[machine.machineId] = await peekMemory(machine.machineId); }
    catch (error) { unread[machine.machineId] = message(error); }
    finally { delete peeking[machine.machineId]; }
  }

  async function adopt(machine: Machine) {
    busy[machine.machineId] = true;
    try { landed(await adoptMemory(machine.machineId)); comparing = null; delete copies[machine.machineId]; toast.success(`The fleet now keeps ${machineLabel(machine.hostname)}'s memory.`); }
    catch (error) { toast.error(message(error)); } finally { delete busy[machine.machineId]; }
  }

  async function overwrite(machine: Machine) {
    busy[machine.machineId] = true;
    try { await pushMemory(machine.machineId); comparing = null; delete copies[machine.machineId]; await refreshHistory(); toast.success(`${machineLabel(machine.hostname)} takes the fleet's copy.`); }
    catch (error) { toast.error(message(error)); } finally { delete busy[machine.machineId]; }
  }

  async function openVersion(row: FleetMemoryVersion) {
    if (shown === row.id) { shown = null; return; }
    shown = row.id;
    if (contents[row.id] !== undefined || reading[row.id]) return;
    reading[row.id] = true;
    try { contents[row.id] = (await memoryVersion(row.id)).content; }
    catch (error) { shown = null; toast.error(message(error)); }
    finally { delete reading[row.id]; }
  }

  async function restore(row: FleetMemoryVersion) {
    restoring = row.id;
    try { landed(await restoreMemory(row.id)); shown = null; toast.success('Restored — every machine gets it.'); }
    catch (error) { toast.error(message(error)); } finally { restoring = null; }
  }
</script>

{#snippet driftedRow(machine: Machine)}
  {@const item = machine.fleet?.memory}
  {@const online = machine.status === 'online'}
  {@const isOpen = comparing === machine.machineId}
  <li class="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <IconWarningTriangle class="size-3.5 shrink-0 text-warning" />
        <span class="truncate text-caption font-medium {online ? 'text-foreground' : 'text-muted-foreground'}">{machineLabel(machine.hostname)}</span>
      </span>
      <span class="min-w-0 flex-1 text-micro text-muted-foreground">Kept its own copy.{online ? '' : ' Offline — it syncs when it comes back.'}</span>
      <Button variant={isOpen ? 'secondary' : 'outline'} size="xs" class="shrink-0" disabled={!online} onclick={() => compare(machine)}>{isOpen ? 'Hide' : 'Compare'}</Button>
      {#if !isOpen}
        <Button variant="outline" size="xs" class="shrink-0" disabled={!online || busy[machine.machineId] === true} onclick={() => adopt(machine)}>Adopt</Button>
        <Button variant="outline" size="xs" class="shrink-0" disabled={!online || busy[machine.machineId] === true} onclick={() => overwrite(machine)}>Overwrite</Button>
      {/if}
    </div>
    {#if item?.detail}<pre class="max-h-24 overflow-auto rounded-lg bg-muted px-2 py-1.5 font-mono text-micro whitespace-pre-wrap">{item.detail}</pre>{/if}
    {#if isOpen}
      <div class="flex flex-col gap-2">
        {#if peeking[machine.machineId]}
          <p class="flex items-center gap-2 text-caption text-muted-foreground" role="status"><IconSpinner class="size-4 shrink-0 animate-spin" />Reading this machine's copy…</p>
        {:else if unread[machine.machineId]}
          <p class="text-caption text-warning" role="alert">{unread[machine.machineId]}</p>
        {:else if copies[machine.machineId] === null}
          <p class="text-caption text-muted-foreground">This machine has no user CLAUDE.md of its own.</p>
        {:else if copies[machine.machineId]}
          {#key `${machine.machineId}:${memory?.hash ?? ''}`}<DiffView filePath="CLAUDE.md" oldContent={memory?.content ?? ''} newContent={copies[machine.machineId]?.content ?? ''} />{/key}
        {/if}
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="xs" disabled={!online || busy[machine.machineId] === true} onclick={() => adopt(machine)}>Adopt this machine's copy</Button>
          <Button variant="outline" size="xs" disabled={!online || busy[machine.machineId] === true} onclick={() => overwrite(machine)}>Overwrite it with the fleet's</Button>
        </div>
      </div>
    {/if}
  </li>
{/snippet}

<p class="max-w-prose text-caption">
  One memory for the fleet. What you write here is <span class="font-mono">~/.claude/CLAUDE.md</span> on every machine, so what you taught Claude Code on one of them is what it knows on all of them.
</p>

{#if error}
  <div class="rounded-xl bg-card p-4 shadow-md" role="alert"><p class="text-caption text-warning">{error}</p></div>
{:else}
  <MemoryCard path="~/.claude/CLAUDE.md" content={memory?.content ?? null} bind:editing {save} emptyText="The fleet keeps no memory yet. Click to write one — or adopt a machine's copy below.">
    {#snippet meta()}
      {#if memory}
        <span class="flex min-w-0 shrink items-baseline gap-x-3 text-micro text-muted-foreground">
          <span class="font-mono" title={memory.hash}>{memory.hash.slice(0, 8)}</span>
          <span>{formatBytes(bytes)}</span>
          <span class="truncate">saved {formatDistanceToNow(new Date(memory.updatedAt))}</span>
        </span>
      {/if}
    {/snippet}
    {#snippet actions()}
      <Button variant="ghost" size="xs" aria-expanded={historyOpen} class="text-muted-foreground" onclick={toggleHistory}>
        {#if historyOpen}<IconChevronDown class="shrink-0" />{:else}<IconChevronRight class="shrink-0" />{/if}
        History
      </Button>
      {#if memory}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" size="icon-sm" class="text-muted-foreground hover:text-destructive" aria-label="Delete the fleet memory" disabled={clearing} onclick={forget}><IconTrash /></Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Takes it off every machine that still has Outpost's copy</Tooltip.Content>
        </Tooltip.Root>
      {/if}
    {/snippet}
    {#snippet footer()}
      {#if conflict}
        <div class="flex flex-col gap-3 border-t border-border p-4">
          <div class="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2">
            <IconWarningTriangle class="mt-0.5 size-4 shrink-0 text-warning" />
            <p class="text-caption text-warning">Changed elsewhere while you edited. Nothing was overwritten.</p>
          </div>
          {#key conflict.hash}<DiffView filePath="CLAUDE.md" oldContent={conflict.content} newContent={mine} />{/key}
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="xs" disabled={saving} onclick={takeLatest}>Take latest</Button>
            <Button variant="outline" size="xs" disabled={saving} onclick={saveAnyway}>{saving ? 'Saving…' : 'Save mine anyway'}</Button>
          </div>
        </div>
      {/if}
    {/snippet}
  </MemoryCard>

  {#if historyOpen}
    {#if loadingHistory && versions === null}
      <Skeleton class="h-16 w-full rounded-xl" />
    {:else if historyError}
      <p class="text-caption text-warning" role="alert">{historyError}</p>
    {:else if (versions ?? []).length === 0}
      <p class="text-caption text-muted-foreground">Nothing replaced yet. Every version a save, an adopt or an overwrite replaces is kept here.</p>
    {:else}
      <ul class="flex flex-col rounded-xl bg-card shadow-md">
        {#each versions ?? [] as row (row.id)}
          <li class="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="text-caption">{formatDistanceToNow(new Date(row.createdAt))}</span>
              <span class="text-micro text-muted-foreground">from {sourceLabel(row.source)}</span>
              <span class="font-mono text-micro text-muted-foreground" title={row.hash}>{row.hash.slice(0, 8)}</span>
              <span class="text-micro text-muted-foreground">{formatBytes(row.bytes)}</span>
              <Button variant={shown === row.id ? 'secondary' : 'outline'} size="xs" class="ml-auto shrink-0" onclick={() => openVersion(row)}>{shown === row.id ? 'Hide' : 'Compare'}</Button>
            </div>
            {#if shown === row.id}
              {#if reading[row.id]}
                <p class="flex items-center gap-2 text-caption text-muted-foreground" role="status"><IconSpinner class="size-4 shrink-0 animate-spin" />Reading that version…</p>
              {:else if contents[row.id] !== undefined}
                {#key `${row.id}:${memory?.hash ?? ''}`}<DiffView filePath="CLAUDE.md" oldContent={contents[row.id]} newContent={memory?.content ?? ''} />{/key}
                <Button variant="outline" size="xs" class="self-start" disabled={restoring === row.id} onclick={() => restore(row)}>{restoring === row.id ? 'Restoring…' : 'Restore this version'}</Button>
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
    <p class="text-caption text-muted-foreground">No machines yet — this lands on the first one that registers.</p>
  {:else if !memory}
    <ul class="flex flex-col rounded-xl bg-card shadow-md">
      {#each machines as machine (machine.machineId)}
        {@const online = machine.status === 'online'}
        <li class="flex flex-wrap items-center gap-3 border-t border-border p-4 first:border-t-0">
          <span class="min-w-0 flex-1 truncate text-caption font-medium {online ? 'text-foreground' : 'text-muted-foreground'}">{machineLabel(machine.hostname)}</span>
          <Button variant="outline" size="xs" class="shrink-0" disabled={!online || busy[machine.machineId] === true} onclick={() => adopt(machine)}>Adopt this machine's copy</Button>
        </li>
      {/each}
    </ul>
  {:else}
    {#if applied.length > 0}
      <p class="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground" title={names(applied)}>
        <IconCheck class="size-3.5 shrink-0 text-success" />
        <span>In sync on {applied.length} machine{applied.length === 1 ? '' : 's'}</span>
        {#if asleep.length > 0}<span>{names(asleep)} offline — they sync when back.</span>{/if}
      </p>
    {/if}
    {#if drifted.length > 0}
      <ul class="flex flex-col rounded-xl bg-card shadow-md">
        {#each drifted as machine (machine.machineId)}{@render driftedRow(machine)}{/each}
      </ul>
      <p class="max-w-prose text-micro text-muted-foreground">
        A machine only ever gives back the copy Outpost wrote it. One edited on the machine itself is left where it is, and says so here until you take it or replace it.
      </p>
    {/if}
  {/if}
{/if}

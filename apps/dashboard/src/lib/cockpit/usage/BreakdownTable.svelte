<script lang="ts">
  /**
   * The breakdown table (USAGE-SPEC.md §7.2.5). Tabs for Project / Model /
   * Session, driven from a search param like the tools page, plus a harness
   * filter so the cost column is always one currency — Claude's notional cost
   * and opencode's real spend never sit in the same total. Each (tab, harness)
   * pair is fetched once and cached, so switching back costs no request.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Dialog from '$lib/components/ui/dialog';
  import { compactNumber, totalTokensOf, usd, type UsageSummary, type UsageSummaryRow } from '../usage';

  type TabId = 'model' | 'project' | 'session';
  type Harness = 'claude' | 'opencode';

  const TAB_LIST = [
    { id: 'model', label: 'Model' },
    { id: 'project', label: 'Project' },
    { id: 'session', label: 'Session' },
  ] as const;

  const tab: TabId = $derived(
    (['model', 'project', 'session'] as const).find((id) => id === page.url.searchParams.get('tab')) ??
      'model'
  );

  let harness = $state<Harness>('claude');

  const cache = new Map<string, UsageSummary>();
  let summary = $state<UsageSummary | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function fetchTab(): Promise<void> {
    const key = `${tab}:${harness}`;
    const known = cache.get(key);
    if (known) {
      summary = known;
      loading = false;
      return;
    }
    loading = true;
    error = null;
    try {
      const response = await fetch(`/api/usage/summary?groupBy=${tab}&harness=${harness}`);
      if (!response.ok) throw new Error(`the hub answered ${response.status}`);
      const data = (await response.json()) as UsageSummary;
      cache.set(key, data);
      summary = data;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      summary = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void fetchTab();
  });

  function switchTab(next: string): void {
    void goto(`/usage?tab=${next}`, { noScroll: true, replaceState: true });
  }

  type SortKey = 'input' | 'output' | 'cacheCreation' | 'cacheRead' | 'total' | 'costUsd' | 'messages';

  interface Row extends UsageSummaryRow {
    total: number;
  }

  let sortBy = $state<SortKey>('total');
  let sortAsc = $state(false);

  const rows: Row[] = $derived.by(() => {
    const out = (summary?.rows ?? []).map((row) => ({ ...row, total: totalTokensOf(row) }));
    out.sort((a, b) => {
      const cmp =
        typeof a[sortBy] === 'number' && typeof b[sortBy] === 'number'
          ? (a[sortBy] as number) - (b[sortBy] as number)
          : String(a[sortBy]).localeCompare(String(b[sortBy]));
      return sortAsc ? cmp : -cmp;
    });
    return out;
  });

  function sort(next: SortKey): void {
    if (sortBy === next) sortAsc = !sortAsc;
    else {
      sortBy = next;
      sortAsc = false;
    }
  }

  const COLUMNS: { key: SortKey; label: string }[] = $derived([
    { key: 'input', label: 'Input' },
    { key: 'output', label: 'Output' },
    { key: 'cacheCreation', label: 'Cache write' },
    { key: 'cacheRead', label: 'Cache read' },
    { key: 'total', label: 'Total' },
    { key: 'messages', label: 'Messages' },
    { key: 'costUsd', label: harness === 'claude' ? 'Cost · would cost on API' : 'Cost' },
  ]);

  const nameOf = (row: Row): string => String(row.key);

  let selected = $state<Row | null>(null);
  let dialogOpen = $state(false);

  function openSession(row: Row): void {
    selected = row;
    dialogOpen = true;
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between gap-2">
    <div>
      <h2 class="text-title">Breakdown</h2>
      <p class="text-caption">Tokens and cost by {tab}.</p>
    </div>
    <div class="flex gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label="Harness">
      <button
        class="rounded-md px-2.5 py-1 text-micro transition-colors duration-150 ease-out
               {harness === 'claude'
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'}"
        aria-pressed={harness === 'claude'}
        onclick={() => (harness = 'claude')}
      >
        Claude
      </button>
      <button
        class="rounded-md px-2.5 py-1 text-micro transition-colors duration-150 ease-out
               {harness === 'opencode'
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'}"
        aria-pressed={harness === 'opencode'}
        onclick={() => (harness = 'opencode')}
      >
        opencode
      </button>
    </div>
  </div>

  <Tabs.Root value={tab} onValueChange={switchTab}>
    <Tabs.List variant="line" class="w-full">
      {#each TAB_LIST as one (one.id)}
        <Tabs.Trigger value={one.id}>{one.label}</Tabs.Trigger>
      {/each}
    </Tabs.List>
  </Tabs.Root>

  {#if error}
    <p class="text-caption text-error" role="alert">{error}</p>
  {:else if loading}
    <div class="h-40 w-full rounded-xl bg-muted/40"></div>
  {:else}
    <div class="overflow-x-auto rounded-xl bg-card shadow-md">
      <table class="w-full text-caption">
        <thead>
          <tr class="border-b border-border text-left text-micro text-muted-foreground">
            <th class="px-3 py-2 font-medium">Name</th>
            {#each COLUMNS as column (column.key)}
              <th class="px-3 py-2 text-right font-medium">
                <button
                  class="ml-auto inline-flex items-center gap-0.5 tabular-nums transition-colors hover:text-foreground"
                  onclick={() => sort(column.key)}
                >
                  {column.label}
                  {#if sortBy === column.key}
                    <span aria-hidden="true">{sortAsc ? '↑' : '↓'}</span>
                  {/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (String(row.key))}
            <tr
              class="border-b border-border/50 tabular-nums last:border-0 {tab === 'session'
                ? 'cursor-pointer transition-colors hover:bg-muted'
                : ''}"
              onclick={() => (tab === 'session' ? openSession(row) : undefined)}
              role={tab === 'session' ? 'button' : undefined}
              tabindex={tab === 'session' ? 0 : undefined}
              onkeydown={(event) => {
                if (tab === 'session' && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  openSession(row);
                }
              }}
            >
              <td
                class="max-w-56 truncate px-3 py-2 font-medium {tab === 'model' || tab === 'session'
                  ? 'font-mono'
                  : ''}"
                title={nameOf(row)}
              >
                {nameOf(row)}
              </td>
              <td class="px-3 py-2 text-right">{compactNumber(row.input)}</td>
              <td class="px-3 py-2 text-right">{compactNumber(row.output)}</td>
              <td class="px-3 py-2 text-right">{compactNumber(row.cacheCreation)}</td>
              <td class="px-3 py-2 text-right">{compactNumber(row.cacheRead)}</td>
              <td class="px-3 py-2 text-right font-medium">{compactNumber(row.total)}</td>
              <td class="px-3 py-2 text-right">{row.messages.toLocaleString()}</td>
              <td class="px-3 py-2 text-right font-medium">{usd(row.costUsd)}</td>
            </tr>
          {/each}
          {#if rows.length === 0}
            <tr>
              <td colspan="8" class="px-3 py-6 text-center text-muted-foreground">
                Nothing recorded for this harness yet.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<Dialog.Root bind:open={dialogOpen} onOpenChange={(open) => !open && (selected = null)}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Session</Dialog.Title>
      <Dialog.Description class="font-mono text-micro">{selected?.key}</Dialog.Description>
    </Dialog.Header>
    {#if selected}
      <dl class="grid grid-cols-2 gap-2 text-caption">
        <div><dt class="text-muted-foreground">Input</dt><dd class="tabular-nums">{selected.input.toLocaleString()}</dd></div>
        <div><dt class="text-muted-foreground">Output</dt><dd class="tabular-nums">{selected.output.toLocaleString()}</dd></div>
        <div><dt class="text-muted-foreground">Cache write</dt><dd class="tabular-nums">{selected.cacheCreation.toLocaleString()}</dd></div>
        <div><dt class="text-muted-foreground">Cache read</dt><dd class="tabular-nums">{selected.cacheRead.toLocaleString()}</dd></div>
        <div><dt class="text-muted-foreground">Total</dt><dd class="tabular-nums">{selected.total.toLocaleString()}</dd></div>
        <div><dt class="text-muted-foreground">Cost</dt><dd class="tabular-nums">{usd(selected.costUsd)}</dd></div>
      </dl>
    {/if}
  </Dialog.Content>
</Dialog.Root>

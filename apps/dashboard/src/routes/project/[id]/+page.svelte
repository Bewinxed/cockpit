<script lang="ts">
  /**
   * The project home (NEW.md §1, north star 4): what this is and what is
   * happening — read from the repo's own files, never from a store of
   * Outpost's own.
   */
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { Markdown } from '$lib/components/ui/markdown';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import MemoryCard from '$lib/components/features/MemoryCard.svelte';
  import { cockpit, deleteProject, machineFs, spawnSession } from '$lib/cockpit/client.svelte';
  import type { ProjectRow } from '$lib/cockpit/client.svelte';
  import { readDocs, type Doc } from '$lib/cockpit/docs';
  import { spawnPrefs, rememberSpawn } from '$lib/cockpit/spawnPrefs.svelte';
  import { machineLabel, machineOs } from '$lib/cockpit/machine';
  import LiveSessionRow from '$lib/cockpit/LiveSessionRow.svelte';
  import StoredSessionRow from '$lib/cockpit/StoredSessionRow.svelte';
  import MachineInventory from '$lib/cockpit/MachineInventory.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const project = $derived<ProjectRow | null>(
    (data.project && cockpit.project(data.project.id)) ?? data.project
  );
  const machine = $derived(
    cockpit.machines.find((row) => row.machineId === project?.machineId) ?? null
  );

  let docs = $state<Doc[]>([]);
  let open = $state<Doc | null>(null);
  let content = $state('');
  let draft = $state<string | null>(null);
  let docsError = $state<string | null>(null);
  let docError = $state<string | null>(null);
  let saving = $state(false);

  /**
   * 24 lines of `prose-sm`, whose line box is exactly 1.5rem — so the clamp
   * lands between lines instead of through one. What is left over fades under
   * the card's edge until "Read more" lifts it.
   */
  const COLLAPSED_DOC = 'calc(1.5rem * 24)';
  let docBody = $state<HTMLElement | null>(null);
  let expanded = $state(false);
  let clipped = $state(false);
  let showMore = $state(false);
  let forgetOpen = $state(false);
  let spawnOpen = $state(false);
  let spawnPrompt = $state('');

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  let loadedFor = '';

  $effect(() => {
    const current = project;
    const ready = cockpit.status === 'connected';
    if (!current || !ready || loadedFor === current.id) return;
    loadedFor = current.id;
    untrack(() => {
      void loadDocs(current);
      void loadClaude(current);
    });
  });

  async function loadDocs(target: ProjectRow) {
    docsError = null;
    try {
      docs = await readDocs(target.machineId, target.cwd);
      if (docs.length > 0) await openDoc(docs[0]);
    } catch (error) {
      docsError = message(error);
    }
  }

  async function openDoc(doc: Doc) {
    if (!project) return;
    open = doc;
    draft = null;
    docError = null;
    content = '';
    expanded = false;
    try {
      content = await machineFs<string>(project.machineId, 'read', doc.path);
    } catch (error) {
      docError = message(error);
    }
  }

  async function save() {
    if (!project || !open || draft === null) return;
    saving = true;
    docError = null;
    try {
      await machineFs(project.machineId, 'write', open.path, draft);
      content = draft;
      draft = null;
    } catch (error) {
      docError = message(error);
    } finally {
      saving = false;
    }
  }

  let claude = $state<string | null>(null);
  let claudeEditing = $state(false);
  let claudeError = $state<string | null>(null);

  const claudePath = $derived(project ? `${project.cwd}/CLAUDE.md` : '');
  const claudeOnline = $derived(machine?.status === 'online');

  async function loadClaude(target: ProjectRow) {
    claude = null;
    claudeEditing = false;
    claudeError = null;
    try {
      claude = await machineFs<string>(target.machineId, 'read', `${target.cwd}/CLAUDE.md`);
    } catch (error) {
      if (!message(error).includes('does not exist')) claudeError = message(error);
    }
  }

  async function saveClaude(text: string): Promise<boolean> {
    if (!project) return false;
    claudeError = null;
    try {
      await machineFs(project.machineId, 'write', claudePath, text);
      claude = text;
      // CLAUDE.md is in the docs nav too; the viewer must not go on showing
      // what the rail just replaced.
      if (open?.path === claudePath) content = text;
      return true;
    } catch (error) {
      claudeError = message(error);
      return false;
    }
  }

  // Only a document with more to show earns a "Read more"; measured after the
  // markdown paints, because its height is the whole question.
  $effect(() => {
    const element = docBody;
    void content;
    void expanded;
    clipped = element ? element.scrollHeight > element.clientHeight + 4 : false;
  });

  const live = $derived(project ? cockpit.liveIn(project) : []);
  const stored = $derived(project ? cockpit.storedIn(project) : []);
  const storedVisible = $derived(showMore ? stored : stored.slice(0, 8));

  function startSession(scratch: boolean) {
    if (!project) return;
    const perm = spawnPrefs.permissionMode;
    const mod = spawnPrefs.model;
    const prompt = spawnPrompt.trim() || undefined;
    const instanceId = spawnSession({
      machineId: project.machineId,
      cwd: project.cwd,
      projectId: project.id,
      permissionMode: perm,
      model: mod,
      prompt,
      scratch: scratch ? {} : undefined,
    });
    rememberSpawn({ model: mod, permissionMode: perm });
    spawnPrompt = '';
    spawnOpen = false;
    void goto(`/session/${instanceId}`);
  }

  async function forget() {
    if (!project) return;
    await deleteProject(project.id);
    forgetOpen = false;
    await goto('/session');
  }

  function docListKeydown(event: KeyboardEvent) {
    if (!docs.length) return;
    const idx = open ? docs.findIndex((d) => d.path === open?.path) : -1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(idx + 1, docs.length - 1);
      void openDoc(docs[next]);
      (event.currentTarget as HTMLElement).querySelectorAll('button')[next]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(idx - 1, 0);
      void openDoc(docs[prev]);
      (event.currentTarget as HTMLElement).querySelectorAll('button')[prev]?.focus();
    }
  }

  const os = $derived(machine ? machineOs(machine.os) : null);
</script>

<svelte:head>
  <title>{project?.name ?? 'Project'} &middot; Outpost</title>
</svelte:head>

{#if !project}
  <div class="flex flex-1 items-center justify-center">
    <p class="text-body text-muted-foreground">No such project.</p>
  </div>
{:else}
  <div class="flex h-full flex-1 flex-col overflow-hidden">
    <!-- Header -->
    <header class="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pt-6 pb-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h1 class="text-display">{project.name}</h1>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="truncate font-mono text-micro text-muted-foreground">{project.cwd}</span>
          {#if machine}
            <span class="flex items-center gap-1.5">
              {#if os}
                <os.Icon class="size-3.5 text-muted-foreground" />
              {/if}
              <span class="text-micro text-muted-foreground">
                {machineLabel(machine.hostname)}
              </span>
              <span
                class="size-2 shrink-0 rounded-full {machine.status === 'online' ? 'bg-success' : 'bg-muted-foreground/40'}"
                title={machine.status}
              ></span>
            </span>
          {/if}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Popover.Root bind:open={spawnOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button {...props} class="pressable">New session</Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-80 p-0" align="end">
            <form
              class="flex flex-col gap-3 p-4"
              onsubmit={(e) => { e.preventDefault(); startSession(false); }}
            >
              <label class="flex flex-col gap-1 text-caption">
                First prompt (optional)
                <Input
                  bind:value={spawnPrompt}
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="What should this session do?"
                  class="text-sm"
                />
              </label>
              <div class="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onclick={() => startSession(false)}
                >
                  Start empty
                </Button>
                <Button type="submit" size="sm">Start</Button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Root>
        <Button
          variant="outline"
          class="pressable"
          onclick={() => startSession(true)}
        >
          Side quest
        </Button>
        <AlertDialog.Root bind:open={forgetOpen}>
          <AlertDialog.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" class="text-muted-foreground">
                Forget project&hellip;
              </Button>
            {/snippet}
          </AlertDialog.Trigger>
          <AlertDialog.Content class="rounded-2xl shadow-xl">
            <AlertDialog.Header>
              <AlertDialog.Title>Forget {project.name}?</AlertDialog.Title>
              <AlertDialog.Description>
                The grouping is removed. The checkout and its sessions stay on disk.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action onclick={forget}>Forget</AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </div>
    </header>

    <!-- Body: columns at >=768 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 lg:flex-row lg:gap-6 lg:overflow-hidden">
      <!-- Main column: docs -->
      <div class="flex min-w-0 flex-1 flex-col gap-4 lg:overflow-y-auto">
        {#if docs.length === 0 && !docsError}
          <div class="rounded-xl bg-card p-6 shadow-md">
            <p class="text-body text-muted-foreground">
              No markdown yet. Add a README.md at the top of the checkout and it shows up here.
            </p>
          </div>
        {:else if docsError}
          <div class="rounded-xl bg-card p-6 shadow-md" role="alert">
            <p class="text-body text-warning">{docsError}</p>
          </div>
        {:else}
          <!-- Doc nav: Select on mobile -->
          <div class="block md:hidden">
            {#if docs.length > 0}
              <Select.Root
                type="single"
                value={open?.path ?? ''}
                onValueChange={(val) => {
                  const doc = docs.find((d) => d.path === val);
                  if (doc) void openDoc(doc);
                }}
              >
                <Select.Trigger class="w-full font-mono text-sm">
                  {open?.name ?? 'Select a document'}
                </Select.Trigger>
                <Select.Content>
                  {#each docs as doc (doc.path)}
                    <Select.Item value={doc.path} class="font-mono text-sm">{doc.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            {/if}
          </div>

          <div class="flex min-h-0 flex-1 gap-4 xl:gap-0">
            <!-- 3-col ultrawide: doc nav list | document | rail -->
            <nav
              class="hidden shrink-0 flex-col overflow-y-auto pr-2 xl:flex xl:w-48"
              aria-label="Project docs"
            >
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
              <div
                class="flex flex-col gap-0.5"
                role="listbox"
                tabindex="0"
                aria-label="Docs"
                onkeydown={docListKeydown}
              >
                {#each docs as doc (doc.path)}
                  <button
                    type="button"
                    role="option"
                    aria-selected={open?.path === doc.path}
                    class="truncate rounded-lg px-3 py-1.5 text-left font-mono text-micro transition-colors
                      hover:bg-accent
                      {open?.path === doc.path
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground'}"
                    onclick={() => openDoc(doc)}
                  >
                    {doc.name}
                  </button>
                {/each}
              </div>
            </nav>

            <!-- 2-col (768-1919): doc nav is horizontal above reading pane -->
            <div class="flex min-w-0 flex-1 flex-col gap-4">
              <nav
                class="hidden shrink-0 gap-1 overflow-x-auto md:flex xl:hidden"
                aria-label="Project docs"
              >
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <div
                  class="flex gap-1"
                  role="listbox"
                  tabindex="0"
                  aria-label="Docs"
                  onkeydown={docListKeydown}
                >
                  {#each docs as doc (doc.path)}
                    <button
                      type="button"
                      role="option"
                      aria-selected={open?.path === doc.path}
                      class="shrink-0 truncate rounded-lg px-3 py-1.5 font-mono text-micro transition-colors
                        hover:bg-accent
                        {open?.path === doc.path
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground'}"
                      onclick={() => openDoc(doc)}
                    >
                      {doc.name}
                    </button>
                  {/each}
                </div>
              </nav>

              {#if open}
                <section class="rounded-xl bg-card shadow-md">
                  <header class="flex items-center gap-3 px-4 py-2.5">
                    <span class="min-w-0 truncate font-mono text-micro text-muted-foreground">{open.name}</span>
                    {#if docError}
                      <span class="truncate text-micro text-error" role="alert">{docError}</span>
                    {/if}
                    {#if draft === null}
                      <Button variant="outline" size="sm" class="ml-auto shrink-0" onclick={() => (draft = content)}>
                        Edit
                      </Button>
                    {:else}
                      <Button variant="ghost" size="sm" class="ml-auto shrink-0" onclick={() => (draft = null)}>
                        Cancel
                      </Button>
                      <Button variant="outline" size="sm" class="shrink-0" disabled={saving} onclick={save}>
                        {saving ? 'Saving\u2026' : 'Save'}
                      </Button>
                    {/if}
                  </header>
                  {#if draft === null}
                    <!-- Read to a line boundary and stop: the collapsed height is
                         a whole number of prose lines, and the last one fades out
                         rather than being sliced through by the card's edge. -->
                    <div class="relative border-t border-border">
                      <div
                        bind:this={docBody}
                        class="overflow-y-auto px-5 py-4 md:px-6"
                        style="max-height: {expanded ? '70vh' : COLLAPSED_DOC}"
                      >
                        <div class="prose prose-sm dark:prose-invert max-w-[72ch]">
                          <Markdown source={content} />
                        </div>
                      </div>
                      {#if !expanded && clipped}
                        <div
                          class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-card"
                        ></div>
                      {/if}
                    </div>
                    {#if clipped || expanded}
                      <button
                        type="button"
                        class="flex min-h-9 w-full items-center justify-center rounded-b-xl text-caption
                          transition-colors hover:bg-accent hover:text-accent-foreground"
                        onclick={() => (expanded = !expanded)}
                      >
                        {expanded ? 'Show less' : 'Read more'}
                      </button>
                    {/if}
                  {:else}
                    <textarea
                      bind:value={draft}
                      spellcheck="false"
                      class="h-[60vh] w-full resize-none border-t border-border bg-transparent px-5 py-4 font-mono text-sm text-foreground
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:px-6"
                    ></textarea>
                  {/if}
                </section>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- Right rail (320-380px on lg; stacked on mobile) -->
      <aside class="mt-6 flex w-full shrink-0 flex-col gap-4 lg:mt-0 lg:w-[340px] lg:overflow-y-auto xl:w-[360px]">
        <!-- Sessions -->
        <section class="rounded-xl bg-card shadow-md">
          <header class="px-4 py-3">
            <h2 class="text-title">Sessions</h2>
          </header>
          <div class="flex flex-col gap-1.5 px-3 pb-3">
            {#each live as instance (instance.id)}
              <LiveSessionRow {instance} groupCwd={project.cwd} />
            {/each}
            {#each storedVisible as info (info.sessionId)}
              <StoredSessionRow machineId={project.machineId} {info} groupCwd={project.cwd} />
            {:else}
              {#if live.length === 0}
                <p class="px-1 py-2 text-caption">Nothing running, nothing recorded yet.</p>
              {/if}
            {/each}
            {#if stored.length > 8 && !showMore}
              <Button
                variant="ghost"
                size="sm"
                class="self-start text-muted-foreground"
                onclick={() => (showMore = true)}
              >
                Show {stored.length - 8} more
              </Button>
            {/if}
          </div>
        </section>

        <!-- CLAUDE.md. The file itself reads in the docs viewer beside this,
             which is where a 360px rail cannot compete — so the rail only says
             it is there and opens the editor. One reader on screen. -->
        <MemoryCard
          path="CLAUDE.md"
          content={claude}
          bind:editing={claudeEditing}
          save={claudeOnline ? saveClaude : undefined}
          summary="Project memory — every session started here reads it."
          emptyText={claudeOnline
            ? 'No CLAUDE.md in this project — click to create it.'
            : `No machine online — ${machine ? machineLabel(machine.hostname) : project.machineId} has to be up to read this file.`}
        >
          {#snippet meta()}
            {#if claudeError}
              <span class="min-w-0 truncate text-micro text-error" role="alert">{claudeError}</span>
            {/if}
          {/snippet}
          {#snippet footer()}
            {#if claudeEditing}
              <p class="border-t border-border px-4 py-2 text-micro text-muted-foreground">
                This file is the repo's own — commit it to share it. Git is its sync; Outpost does not replicate it.
              </p>
            {/if}
          {/snippet}
        </MemoryCard>

        <!-- Machine inventory -->
        {#if project && machine}
          <MachineInventory
            machines={machine ? [machine] : []}
            kind="mcp"
            taken={[]}
          />
        {/if}
      </aside>
    </div>
  </div>
{/if}

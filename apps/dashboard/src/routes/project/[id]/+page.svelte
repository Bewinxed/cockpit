<script lang="ts">
  /**
   * The project home (NEW.md §1, north star 4): what this is and what is
   * happening — read from the repo's own files, never from a store of
   * cockpit's own.
   */
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { Markdown } from '$lib/components/ui/markdown';
  import MemoryCard from '$lib/components/features/MemoryCard.svelte';
  import { cockpit, deleteProject, machineFs, spawnSession } from '$lib/cockpit/client.svelte';
  import type { ProjectRow } from '$lib/cockpit/client.svelte';
  import { readDocs, type Doc } from '$lib/cockpit/docs';
  import LiveSessionRow from '$lib/cockpit/LiveSessionRow.svelte';
  import StoredSessionRow from '$lib/cockpit/StoredSessionRow.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The load's copy is what SSR renders; the socket's is what stays current.
  const project = $derived<ProjectRow | null>(
    (data.project && cockpit.project(data.project.id)) ?? data.project
  );
  const machine = $derived(
    cockpit.machines.find((row) => row.machineId === project?.machineId) ?? null
  );

  let docs = $state<Doc[]>([]);
  let open = $state<Doc | null>(null);
  let content = $state('');
  /** Non-null while editing: the textarea's text, unsaved. */
  let draft = $state<string | null>(null);
  let docsError = $state<string | null>(null);
  let docError = $state<string | null>(null);
  let saving = $state(false);

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // Not reactive: it only guards the effect below from reloading on every frame.
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

  /**
   * The project's own CLAUDE.md, on the machine the sessions start on. Read and
   * written through the same `fs` verb as the docs: git syncs this file, not
   * cockpit — the fleet memory on /tools is the one cockpit replicates.
   */
  let claude = $state<string | null>(null);
  let claudeEditing = $state(false);
  let claudeError = $state<string | null>(null);

  const claudePath = $derived(project ? `${project.cwd}/CLAUDE.md` : '');
  /** A machine that is not up cannot answer for its files, so the card is a read. */
  const claudeOnline = $derived(machine?.status === 'online');

  async function loadClaude(target: ProjectRow) {
    claude = null;
    claudeEditing = false;
    claudeError = null;
    try {
      claude = await machineFs<string>(target.machineId, 'read', `${target.cwd}/CLAUDE.md`);
    } catch (error) {
      // A project with no CLAUDE.md is the ordinary case — the `fs` verb's own
      // sentence for a file that is not there, which is not a failure to show.
      if (!message(error).includes('does not exist')) claudeError = message(error);
    }
  }

  async function saveClaude(text: string): Promise<boolean> {
    if (!project) return false;
    claudeError = null;
    try {
      await machineFs(project.machineId, 'write', claudePath, text);
      claude = text;
      return true;
    } catch (error) {
      // Said in the card's own header, and the editor stays open over the text.
      claudeError = message(error);
      return false;
    }
  }

  const live = $derived(project ? cockpit.liveIn(project) : []);
  const stored = $derived(project ? cockpit.storedIn(project) : []);

  async function startSession(scratch: boolean) {
    if (!project) return;
    const instanceId = spawnSession({
      machineId: project.machineId,
      cwd: project.cwd,
      projectId: project.id,
      scratch: scratch ? {} : undefined,
    });
    await goto(`/session/${instanceId}`);
  }

  async function forget() {
    if (!project) return;
    await deleteProject(project.id);
    await goto('/session');
  }

  const action =
    'shrink-0 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground hover:text-foreground disabled:opacity-40';
</script>

{#if !project}
  <div class="flex flex-1 items-center justify-center">
    <p class="text-sm text-muted-foreground">No such project.</p>
  </div>
{:else}
  <div class="flex h-full flex-1 flex-col overflow-hidden">
    <header class="flex items-center gap-3 border-b border-border px-4 py-2">
      <h1 class="shrink-0 text-sm font-semibold">{project.name}</h1>
      <span class="truncate font-mono text-xs text-muted-foreground">{project.cwd}</span>
      <span class="shrink-0 text-xs text-muted-foreground">
        {machine?.hostname ?? project.machineId}
      </span>
      <button
        type="button"
        class="{action} ml-auto"
        title="Forget the grouping — the checkout and its sessions stay"
        onclick={forget}
      >
        Forget
      </button>
      <button type="button" class={action} onclick={() => startSession(true)}>Side quest</button>
      <button
        type="button"
        class="shrink-0 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90 hover:text-primary"
        onclick={() => startSession(false)}
      >
        New session
      </button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        class="flex shrink-0 flex-col overflow-y-auto border-b border-border py-2 md:w-52 md:border-r md:border-b-0"
        aria-label="Project docs"
      >
        <span
          class="px-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase"
        >
          Docs
        </span>
        <div class="flex overflow-x-auto md:flex-col" role="tablist" aria-label="Docs">
          {#each docs as doc (doc.path)}
            <button
              type="button"
              role="tab"
              aria-selected={open?.path === doc.path}
              aria-controls="project-doc-panel"
              class="shrink-0 truncate px-3 py-1 text-left font-mono text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:shrink
                {open?.path === doc.path ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}"
              onclick={() => openDoc(doc)}
            >
              {doc.name}
            </button>
          {:else}
            <p class="px-3 py-1 text-xs text-muted-foreground">
              {docsError ?? 'No markdown yet. Add a README.md at the top of the checkout and it shows up here.'}
            </p>
          {/each}
        </div>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {#if open}
          <section id="project-doc-panel" role="tabpanel" class="rounded-xl border border-border bg-card">
            <header class="flex items-center gap-3 border-b border-border px-4 py-2">
              <span class="truncate font-mono text-xs text-muted-foreground">{open.name}</span>
              {#if docError}
                <span class="truncate text-xs text-error" role="alert">{docError}</span>
              {/if}
              {#if draft === null}
                <button type="button" class="{action} ml-auto" onclick={() => (draft = content)}>
                  Edit
                </button>
              {:else}
                <button type="button" class="{action} ml-auto" onclick={() => (draft = null)}>
                  Cancel
                </button>
                <button type="button" class={action} disabled={saving} onclick={save}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              {/if}
            </header>
            {#if draft === null}
              <div class="max-h-[60vh] overflow-y-auto px-4 py-3">
                <Markdown source={content} />
              </div>
            {:else}
              <textarea
                bind:value={draft}
                spellcheck="false"
                class="h-[60vh] w-full resize-none bg-transparent px-4 py-3 font-mono text-base text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:text-xs"
              ></textarea>
            {/if}
          </section>
        {/if}

        <MemoryCard
          path="CLAUDE.md"
          content={claude}
          bind:editing={claudeEditing}
          save={claudeOnline ? saveClaude : undefined}
          emptyText={claudeOnline
            ? 'No CLAUDE.md in this project — click to create it.'
            : `No machine online — ${machine?.hostname ?? project.machineId} has to be up to read this file.`}
        >
          {#snippet meta()}
            {#if claudeError}
              <span class="min-w-0 truncate text-xs text-error" role="alert">{claudeError}</span>
            {/if}
          {/snippet}
          {#snippet footer()}
            <p class="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              This file is the repo's own — commit it to share it. Git is its sync; cockpit does not
              replicate it.
            </p>
          {/snippet}
        </MemoryCard>

        <section class="flex flex-col gap-2">
          <h2 class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Happening
          </h2>
          {#each live as instance (instance.id)}
            <LiveSessionRow {instance} />
          {/each}
          {#each stored.slice(0, 8) as info (info.sessionId)}
            <StoredSessionRow machineId={project.machineId} {info} />
          {:else}
            {#if live.length === 0}
              <p class="text-sm text-muted-foreground">Nothing running, nothing recorded yet.</p>
            {/if}
          {/each}
        </section>
      </div>
    </div>
  </div>
{/if}

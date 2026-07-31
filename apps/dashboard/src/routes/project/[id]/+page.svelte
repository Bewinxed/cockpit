<script lang="ts">
  /**
   * The project home (NEW.md §1, north star 4): what this is, what the plan is,
   * what is happening — read from the repo's own files and flowctl, never from a
   * store of cockpit's own.
   */
  import { IconChevronRight } from '$lib/icons';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { Markdown } from '$lib/components/ui/markdown';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { cockpit, deleteProject, machineFs, spawnSession } from '$lib/cockpit/client.svelte';
  import type { ProjectRow } from '$lib/cockpit/client.svelte';
  import { readDocs, type Doc } from '$lib/cockpit/docs';
  import { readFlow, type FlowEpic } from '$lib/cockpit/flow';
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

  let epics = $state<FlowEpic[]>([]);
  let planError = $state<string | null>(null);
  let expanded = $state<Record<string, boolean>>({});

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
      void loadPlan(current);
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

  async function loadPlan(target: ProjectRow) {
    planError = null;
    try {
      epics = await readFlow(target.machineId, target.cwd);
    } catch (error) {
      planError = message(error);
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
    'shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40';
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
        class="shrink-0 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
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
          class="px-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
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
                {open?.path === doc.path ? 'bg-accent text-foreground' : 'text-muted-foreground'}"
              onclick={() => openDoc(doc)}
            >
              {doc.name}
            </button>
          {:else}
            <p class="px-3 py-1 text-[11px] text-muted-foreground">
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

        <section class="flex flex-col gap-2">
          <h2 class="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Plan
          </h2>
          {#each epics as epic (epic.id)}
            {@const total = epic.tasks.length}
            <div class="rounded-lg border border-border bg-card">
              <Collapsible.Root
                open={!!expanded[epic.id]}
                onOpenChange={() => (expanded[epic.id] = !expanded[epic.id])}
              >
                <Collapsible.Trigger
                  class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconChevronRight
                    class="size-3 shrink-0 text-muted-foreground transition-transform {expanded[epic.id]
                      ? 'rotate-90'
                      : ''}"
                  />
                  <span class="shrink-0 font-mono text-xs text-muted-foreground">{epic.id}</span>
                  <span class="truncate text-sm">{epic.title}</span>
                  <span class="ml-auto flex shrink-0 items-center gap-2">
                    <span class="h-1 w-16 overflow-hidden rounded-full bg-border">
                      <span
                        class="block h-full {epic.status === 'done' ? 'bg-success' : 'bg-primary'}"
                        style="width: {total === 0 ? 0 : (epic.done / total) * 100}%"
                      ></span>
                    </span>
                    <span class="font-mono text-[11px] text-muted-foreground">
                      {epic.done}/{total}
                    </span>
                  </span>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <ul class="border-t border-border">
                    {#each epic.tasks as task (task.id)}
                      <li class="flex items-baseline gap-3 px-3 py-1.5">
                        <span class="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {task.id}
                        </span>
                        <span
                          class="truncate text-xs {task.status === 'done'
                            ? 'text-muted-foreground line-through'
                            : ''}"
                        >
                          {task.title}
                        </span>
                        <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {task.status}
                        </span>
                      </li>
                    {:else}
                      <li class="px-3 py-1.5 text-xs text-muted-foreground">No tasks.</li>
                    {/each}
                  </ul>
                </Collapsible.Content>
              </Collapsible.Root>
            </div>
          {:else}
            <p class="text-sm text-muted-foreground">
              {planError ??
                'No flowctl epics here yet. This reads .flow/ in the checkout — create one with .flow/bin/flowctl and it appears.'}
            </p>
          {/each}
        </section>

        <section class="flex flex-col gap-2">
          <h2 class="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
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

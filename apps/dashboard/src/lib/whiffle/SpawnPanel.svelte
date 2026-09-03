<script lang="ts">
  import type {
    ConfigInspection,
    EffortLevel,
    FsEntry,
    HarnessKind,
    PermissionMode,
    RepoInfo,
    ReposResult,
  } from "@whiffle/core";
  import { repoPath } from "@whiffle/core";
  /**
   * The compact way to start a session from the fleet view: a popover on
   * desktop, a sheet on mobile, both wrapping the same dense form. Replaces
   * the old full-page `/session` form — every data flow that lived there
   * (machine, source, repo listing, model, permissions, side quest, save as
   * project) still lives here, plus a project picker and a prefill path for
   * "spawn here" on a group card.
   */
  import { tick } from "svelte";
  import { quintOut } from "svelte/easing";
  import { fade, slide } from "svelte/transition";
  import { goto } from "$app/navigation";
  import DirectoryPicker from "$lib/components/features/DirectoryPicker.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Popover from "$lib/components/ui/popover";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Select from "$lib/components/ui/select";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Sheet from "$lib/components/ui/sheet";
  import { Textarea } from "$lib/components/ui/textarea";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import { IsMobile } from "$lib/hooks/is-mobile.svelte";
  import {
    IconClose,
    IconFolder,
    IconFolderOpen,
    IconPlay,
    IconRepo,
    IconSpinner,
  } from "$lib/icons";
  import {
    createProject,
    machineControl,
    machineFs,
    type ProjectRow,
    spawnSession,
    whiffle,
  } from "./client.svelte";
  import EffortSlider from "./EffortSlider.svelte";
  import { effortStops, hasEffortScale } from "./effort-levels";
  import { inspectMachine } from "./fleet";
  import ModelCombobox from "./ModelCombobox.svelte";
  import { covers, MODEL_DEFAULT, modelLabel, models } from "./models.svelte";
  import { PERMISSION_MODES, permissionModeLabel } from "./permission-modes";
  import { rememberSpawn, spawnPrefs } from "./spawnPrefs.svelte";

  interface SpawnPanelProps {
    /** An external element to anchor the popover to. When absent, a fixed point
     *  near the top-right corner is used (the fleet view's default). */
    anchor?: HTMLElement | null;
    /** Called to close the panel. */
    onclose: () => void;
    open: boolean;
    /** Prefill when "spawn here" is used from a group card. */
    prefill?: { machineId?: string; cwd?: string; projectId?: string };
  }

  let { open, prefill, onclose, anchor }: SpawnPanelProps = $props();

  /** Where the session works: a directory that is already there, or a fresh clone. */
  const SOURCES = [
    { value: "directory", label: "Directory", icon: IconFolder },
    { value: "repo", label: "GitHub repo", icon: IconRepo },
  ] as const;

  type Source = (typeof SOURCES)[number]["value"];

  const isMobile = new IsMobile();

  let machineId = $state("");
  /** Which harness runs the session. Defaults to the first the machine has. */
  let harness = $state<HarnessKind>("claude");
  let source = $state<Source>("directory");
  let cwd = $state("");
  let repo = $state("");
  let prompt = $state("");
  let permissionMode = $state<PermissionMode>(spawnPrefs.permissionMode);
  /** Empty is a choice: the spawn leaves `model` out and the SDK picks. */
  let model = $state(spawnPrefs.model || MODEL_DEFAULT);
  /** Same again for effort: `null` leaves the level to the harness. */
  let effort = $state<EffortLevel | null>(spawnPrefs.effort);
  let sideQuest = $state(false);
  let worktree = $state(false);
  let saveAsProject = $state(false);
  let projectName = $state("");
  let submitting = $state(false);
  let formError = $state<string | null>(null);

  /** The project this form is tied to — picked, prefilled, or neither. */
  let projectId = $state<string | null>(null);
  let projectQuery = $state("");
  let projectOpen = $state(false);

  /** A prefill locks its fields behind a summary line until "Edit" is clicked. */
  let editingPrefill = $state(false);

  const leaf = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

  /** Trailing slashes on a directory, past the one that could be root. */
  const TRAILING_SLASHES = /(?!^)\/+$/;

  const hasPrefill = $derived(
    Boolean(prefill && (prefill.machineId || prefill.cwd || prefill.projectId))
  );
  const showFields = $derived(!hasPrefill || editingPrefill);

  let machineTrigger = $state<HTMLElement | null>(null);
  let cwdInput = $state<HTMLInputElement | null>(null);
  let repoInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let promptField = $state<HTMLTextAreaElement | null>(null);
  /** A virtual anchor for the desktop popover — see the markup for why. */
  let anchorEl = $state<HTMLElement | null>(null);

  const machineRow = $derived(
    whiffle.machines.find((row) => row.machineId === machineId) ?? null
  );
  const hostnameOf = (id: string) =>
    whiffle.machines.find((row) => row.machineId === id)?.hostname ?? id;

  /** The harnesses this machine can actually run, in a stable order. */
  const HARNESS_ORDER: HarnessKind[] = ["claude", "opencode", "pi"];
  const availableHarnesses = $derived(
    HARNESS_ORDER.filter((kind) =>
      (machineRow?.harnesses ?? []).some(
        (report) => report.harness === kind && report.installed
      )
    )
  );
  const harnessReport = $derived(
    machineRow?.harnesses?.find((report) => report.harness === harness) ?? null
  );
  /** The permission modes this harness can honour; empty hides the picker. */
  const offeredModes = $derived(
    harnessReport
      ? PERMISSION_MODES.filter((mode) =>
          harnessReport.capabilities.permissionModes.includes(mode.value)
        )
      : PERMISSION_MODES
  );
  /** Choosing a harness that cannot take the current mode walks it back. */
  $effect(() => {
    if (offeredModes.length === 0) {
      return;
    }
    if (!offeredModes.some((mode) => mode.value === permissionMode)) {
      permissionMode = offeredModes[0].value;
    }
  });

  /** The offered row for the model in the field, which is what carries its scale. */
  const chosenModel = $derived(
    models.offered.find((row) => covers(row, model)) ?? null
  );
  /**
   * The effort control is offered only when both halves are known to have one:
   * the harness, and the model. An unreported harness or a model nothing has
   * described is not a reason to draw a scale and hope.
   */
  const showEffort = $derived(
    harnessReport?.capabilities.effort === true && hasEffortScale(chosenModel)
  );
  const effortStopsForModel = $derived(effortStops(chosenModel));

  /**
   * A model that does not reach the chosen level clears it rather than sliding
   * it down to one that fits: a spawn quietly sent at `high` because the new
   * model has no `max` is a session running at a level nobody picked.
   */
  $effect(() => {
    if (!effort) {
      return;
    }
    if (
      !effortStopsForModel.some(
        (stop) => stop.reachable && stop.value === effort
      )
    ) {
      effort = null;
    }
  });

  /** A machine switched to may not run the harness the form still names. */
  let lastMachine = $state("");
  $effect(() => {
    if (machineId === lastMachine) {
      return;
    }
    lastMachine = machineId;
    if (!availableHarnesses.includes(harness)) {
      harness = availableHarnesses[0] ?? "claude";
    }
  });

  /** The field the last submit tripped over — drives its border and one shake. */
  let invalid = $state<"machine" | "cwd" | "repo" | null>(null);

  // Cleared first so the class comes off and back on, which is what replays the
  // shake when the same field fails twice in a row.
  async function flag(field: "machine" | "cwd" | "repo") {
    invalid = null;
    await tick();
    invalid = field;
  }

  function clearInvalid() {
    invalid = null;
    formError = null;
  }

  /** A field that decided the project changed by hand no longer names it. */
  function diverge() {
    projectId = null;
    clearInvalid();
  }

  let repoOpen = $state(false);
  let repos = $state<RepoInfo[]>([]);
  let reposLoading = $state(false);
  /** Why the list has nothing to offer, when it has nothing to offer. */
  let repoNotice = $state<
    | { kind: "gh-missing" | "gh-unauthenticated" }
    | { kind: "failed"; message: string }
    | null
  >(null);

  /** Listing repositories shells out to `gh` on the machine, so it is read once. */
  const repoCache = new Map<string, ReposResult>();

  const matches = $derived(
    repos.filter((row) =>
      row.nameWithOwner.toLowerCase().includes(repo.trim().toLowerCase())
    )
  );

  /** Where the clone lands — the agent works the same directory out for itself. */
  const cloneInto = $derived.by(() => {
    const name = repoPath(repo).split("/").pop();
    if (!name) {
      return "";
    }
    return `${(cwd.trim() || "~").replace(TRAILING_SLASHES, "")}/${name}`;
  });

  /** The directory the session will run in, whichever way it was arrived at. */
  const workdir = $derived(source === "repo" ? cloneInto : cwd.trim());

  /** A project already names this exact machine + directory — no point offering to save it again. */
  const existingProject = $derived(
    whiffle.projects.find(
      (row) => row.machineId === machineId && row.cwd === workdir
    ) ?? null
  );

  const projectMatches = $derived.by(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) {
      return whiffle.projects;
    }
    return whiffle.projects.filter(
      (row) =>
        row.name.toLowerCase().includes(q) || row.cwd.toLowerCase().includes(q)
    );
  });

  function adoptRepos(result: ReposResult) {
    if (Array.isArray(result)) {
      repos = result;
    } else {
      repoNotice = { kind: result.error };
    }
  }

  async function openRepos() {
    repoOpen = true;
    if (!machineId) {
      return;
    }
    repos = [];
    repoNotice = null;

    const cached = repoCache.get(machineId);
    if (cached) {
      adoptRepos(cached);
      return;
    }

    const asked = machineId;
    reposLoading = true;
    try {
      const result = await machineControl<ReposResult>(machineId, "listRepos");
      repoCache.set(asked, result);
      // The machine was switched while gh was answering; that list is not this one.
      if (machineId !== asked) {
        return;
      }
      adoptRepos(result);
    } catch (err) {
      if (machineId !== asked) {
        return;
      }
      repoNotice = {
        kind: "failed",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      reposLoading = false;
    }
  }

  function chooseRepo(row: RepoInfo) {
    repo = row.nameWithOwner;
    repoOpen = false;
    clearInvalid();
  }

  /** A clone needs somewhere to land, and home is the one directory every machine has. */
  function chooseSource(next: string) {
    // A single toggle group answers with `''` when its active item is clicked again.
    if (next !== "directory" && next !== "repo") {
      return;
    }
    source = next;
    if (next === "repo" && !cwd.trim()) {
      cwd = "~";
    }
    diverge();
    inspectFolder();
  }

  function openProjects() {
    projectOpen = true;
  }

  function chooseProject(project: ProjectRow) {
    projectId = project.id;
    ({ machineId, cwd } = project);
    projectQuery = project.name;
    projectOpen = false;
    clearInvalid();
    inspectFolder();
  }

  /**
   * What the chosen folder gives a session — `inspectConfig` (NEW.md §11), run
   * the moment a folder is picked rather than found out after the session is
   * already running. Kept for the page's life and keyed by machine + directory:
   * it is the same answer for every panel that asks, and the read shells out on
   * the machine, so a keystroke must not be able to buy one.
   */
  const inspections = new Map<string, ConfigInspection>();
  const reading = new Map<string, Promise<ConfigInspection | null>>();

  let inspection = $state<ConfigInspection | null>(null);
  let inspecting = $state(false);
  /** Only the answer to the folder still in the field is allowed to land. */
  let asked = 0;
  let settling: ReturnType<typeof setTimeout> | undefined;

  /**
   * A machine answers for its user scope whatever path it is handed, so its own
   * word cannot tell a real directory from a typo — the listing is what does,
   * and a folder that is not there gives a session nothing to load.
   */
  async function readFolder(
    id: string,
    dir: string
  ): Promise<ConfigInspection> {
    const [found] = await Promise.all([
      inspectMachine(id, dir),
      machineFs<FsEntry[]>(id, "list", dir),
    ]);
    return found;
  }

  /** Nothing is said about a folder that cannot be named yet, or cannot answer. */
  function inspectFolder() {
    clearTimeout(settling);
    const id = machineId;
    const dir = cwd.trim().replace(TRAILING_SLASHES, "");
    asked += 1;
    const epoch = asked;
    inspecting = false;
    inspection = null;
    // A clone's directory is not there to be read until the clone has landed.
    if (!id || source !== "directory" || !dir.startsWith("/")) {
      return;
    }

    const key = `${id}:${dir}`;
    const known = inspections.get(key);
    if (known) {
      inspection = known;
      return;
    }

    inspecting = true;
    let pending = reading.get(key);
    if (!pending) {
      pending = readFolder(id, dir).catch(() => null);
      reading.set(key, pending);
    }
    // biome-ignore lint/complexity/noVoid: fire-and-forget by intent — the epoch check above discards any answer to a folder no longer in the field
    void pending.then((found) => {
      reading.delete(key);
      if (found) {
        inspections.set(key, found);
      }
      if (epoch !== asked) {
        return;
      }
      inspection = found;
      inspecting = false;
    });
  }

  /**
   * A path mid-typing is not a path yet: what is on screen describes a folder
   * that is no longer in the field, so it goes, and the machine is asked once
   * the typing settles rather than once per character.
   */
  function inspectTyped() {
    clearTimeout(settling);
    asked += 1;
    inspecting = false;
    inspection = null;
    settling = setTimeout(inspectFolder, 600);
  }

  /** Everything a folder brings, in one row: its servers by name, the rest counted. */
  interface FolderChip {
    dim?: string;
    key: string;
    label: string;
    /** A measurement, and the only part of a chip set in mono. */
    measure?: string;
    title?: string;
  }

  /** An MCP server chip's dim/title, from where the server comes from. */
  function serverChipFlags(server: ConfigInspection["mcp"][number]) {
    if (server.shadowedBy) {
      return {
        title: `shadowed by nearer ${server.shadowedBy} scope`,
        dim: "opacity-60",
      };
    }
    if (server.managed) {
      return {};
    }
    return { title: "machine-local, not fleet-managed", dim: "opacity-80" };
  }

  const chips = $derived.by((): FolderChip[] => {
    const found = inspection;
    if (!found) {
      return [];
    }
    const row: FolderChip[] = found.mcp.map((server) => ({
      key: `mcp:${server.scope}:${server.name}`,
      label: server.name,
      ...serverChipFlags(server),
    }));
    if (found.skills.length > 0) {
      row.push({
        key: "skills",
        label: `${found.skills.length} skill${found.skills.length === 1 ? "" : "s"}`,
      });
    }
    if (found.plugins.length > 0) {
      row.push({
        key: "plugins",
        label: `${found.plugins.length} plugin${found.plugins.length === 1 ? "" : "s"}`,
      });
    }
    if (found.memory) {
      row.push({
        key: "memory",
        label: "memory · ",
        measure: `${(found.memory.bytes / 1024).toFixed(1)} KB`,
      });
    }
    return row;
  });

  /** Past eight the row is a paragraph; the tail folds into one chip that names it. */
  const shownChips = $derived(chips.length > 8 ? chips.slice(0, 7) : chips);
  const foldedChips = $derived(chips.length > 8 ? chips.slice(7) : []);

  /** Everything the form knows, seeded from a prefill where one was handed in. */
  function resetForm() {
    const seededProject = prefill?.projectId
      ? whiffle.project(prefill.projectId)
      : null;
    projectId = seededProject?.id ?? null;
    projectQuery = seededProject?.name ?? "";
    machineId =
      prefill?.machineId ||
      seededProject?.machineId ||
      whiffle.onlineMachines[0]?.machineId ||
      "";
    harness = "claude";
    source = "directory";
    cwd = prefill?.cwd || seededProject?.cwd || "";
    repo = "";
    prompt = "";
    ({ permissionMode, effort } = spawnPrefs);
    model = spawnPrefs.model || MODEL_DEFAULT;
    sideQuest = false;
    worktree = false;
    saveAsProject = false;
    projectName = "";
    submitting = false;
    formError = null;
    invalid = null;
    editingPrefill = false;
    projectOpen = false;
    repoOpen = false;
    repos = [];
    repoNotice = null;
    inspectFolder();
  }

  // Edge-triggered: only the moment `open` turns true, never on every render
  // while it stays true — a fleet snapshot arriving mid-fill must not wipe out
  // what the user just typed.
  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) {
      resetForm();
      if (hasPrefill) {
        // biome-ignore lint/complexity/noVoid: focusing the prompt field is fire-and-forget — nothing awaits it
        void tick().then(() => promptField?.focus());
      }
    }
    wasOpen = isOpen;
  });

  function close() {
    onclose();
  }

  async function start(event: SubmitEvent) {
    event.preventDefault();
    formError = null;
    // The button stays live and says what is missing — a dead button explains nothing.
    if (!machineId) {
      formError = "Choose a machine to run this session on.";
      await flag("machine");
      machineTrigger?.focus();
      return;
    }
    if (source === "repo" && !repo.trim()) {
      formError = "Choose a repository, or paste the URL of one.";
      await flag("repo");
      repoInput?.focus();
      return;
    }
    if (!cwd.trim()) {
      formError =
        source === "repo"
          ? "Enter the directory to clone into."
          : "Enter the directory this session should work in.";
      await flag("cwd");
      cwdInput?.focus();
      return;
    }
    invalid = null;
    submitting = true;
    try {
      rememberSpawn({ model, permissionMode, effort });

      let toAttach = projectId ?? undefined;
      if (saveAsProject && !toAttach) {
        const project = await createProject({
          machineId,
          cwd: workdir,
          name: projectName.trim() || leaf(workdir),
        });
        toAttach = project.id;
      }

      const instanceId = spawnSession({
        machineId,
        cwd: workdir,
        prompt,
        harness,
        permissionMode,
        model: model || undefined,
        effort: effort ?? undefined,
        scratch: sideQuest ? { worktree, baseCwd: workdir } : undefined,
        bootstrap:
          source === "repo"
            ? { repo: repo.trim(), baseDir: cwd.trim() }
            : undefined,
        projectId: toAttach,
      });
      onclose();
      await goto(`/session/${instanceId}`);
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
      submitting = false;
    }
  }
</script>

{#snippet prefillSummary()}
  {@const proj = projectId ? whiffle.project(projectId) : null}
  <div
    class="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border/60 bg-muted/30 px-3 py-2.5"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-micro text-muted-foreground">Spawning on</span>
      <span class="text-body truncate">
        <span class="font-medium"
          >{machineRow?.hostname ?? machineId ?? 'No machine'}</span
        >
        <span class="text-muted-foreground"> · </span>
        {#if proj}
          {proj.name}
        {:else}
          <span class="font-mono text-caption text-muted-foreground"
            >{cwd || '—'}</span
          >
        {/if}
      </span>
    </div>
    <button
      class="shrink-0 text-micro text-muted-foreground transition-colors duration-[240ms] ease-[var(--e-in)] hover:text-foreground"
      onclick={() => {
        editingPrefill = true;
      }}
      type="button"
    >
      Edit
    </button>
  </div>
{/snippet}

{#snippet targetFields()}
  <div class="flex flex-col gap-1">
    <span class="text-micro text-muted-foreground" id="spawn-machine-label"
      >Machine</span
    >
    <Select.Root
      onValueChange={() => {
        diverge();
        inspectFolder();
      }}
      type="single"
      bind:value={machineId}
    >
      <Select.Trigger
        aria-labelledby="spawn-machine-label"
        class="w-full text-foreground motion-reduce:animate-none
          {invalid === 'machine' ? 'animate-shake border-error' : ''}"
        size="sm"
        bind:ref={machineTrigger}
      >
        {machineRow ? `${machineRow.hostname} · ${machineRow.os}` : 'No machines online'}
      </Select.Trigger>
      <Select.Content>
        {#each whiffle.onlineMachines as machine (machine.machineId)}
          <Select.Item
            label="{machine.hostname} · {machine.os}"
            value={machine.machineId}
          >
            {machine.hostname}
            · {machine.os}
          </Select.Item>
        {:else}
          <span class="block px-2 py-1.5 text-sm">No machines online</span>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="relative flex flex-col gap-1">
    <label class="text-micro text-muted-foreground" for="spawn-project"
      >Project (optional)</label
    >
    <Input
      autocomplete="off"
      id="spawn-project"
      onblur={() => {
        projectOpen = false;
      }}
      onfocus={openProjects}
      oninput={() => {
        projectOpen = true;
        if (projectId) {
          projectId = null;
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          projectOpen = false;
        }
      }}
      placeholder="Search projects…"
      spellcheck="false"
      bind:ref={projectInput}
      bind:value={projectQuery}
    />

    {#if projectOpen}
      <div
        class="absolute top-full right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-popover shadow-md"
        transition:slide={{ duration: 160 }}
      >
        {#each projectMatches as row (row.id)}
          <button
            class="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
            onclick={() => chooseProject(row)}
            onmousedown={(event) => event.preventDefault()}
            type="button"
          >
            <span class="truncate text-caption text-foreground"
              >{row.name}</span
            >
            <span
              class="w-full truncate font-mono text-micro text-muted-foreground"
            >
              {hostnameOf(row.machineId)}
              · {row.cwd}
            </span>
          </button>
        {:else}
          <span class="block px-2 py-1.5 text-micro text-muted-foreground">
            No project by that name — pick a directory below instead.
          </span>
        {/each}
      </div>
    {/if}
  </div>

  <ToggleGroup.Root
    aria-label="Where this session works"
    class="self-start"
    onValueChange={chooseSource}
    size="sm"
    type="single"
    value={source}
    variant="outline"
  >
    {#each SOURCES as option (option.value)}
      {@const Icon = option.icon}
      <ToggleGroup.Item value={option.value}>
        <Icon />
        {option.label}
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>

  {#if source === 'repo'}
    <div
      class="relative flex flex-col gap-1"
      transition:slide={{ duration: 160 }}
    >
      <label class="text-micro text-muted-foreground" for="spawn-repo"
        >Repository</label
      >
      <Input
        autocomplete="off"
        class="font-mono motion-reduce:animate-none {invalid === 'repo' ? 'animate-shake border-error' : ''}"
        id="spawn-repo"
        onblur={() => {
          repoOpen = false;
        }}
        onfocus={openRepos}
        oninput={() => {
          repoOpen = true;
          clearInvalid();
        }}
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            repoOpen = false;
          }
        }}
        placeholder="owner/name, or a clone URL"
        spellcheck="false"
        bind:ref={repoInput}
        bind:value={repo}
      />

      {#if repoOpen}
        <div
          class="absolute top-full right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-popover shadow-md"
          transition:slide={{ duration: 160 }}
        >
          {#if reposLoading}
            <span
              class="flex items-center gap-2 px-2 py-1.5 text-micro text-muted-foreground"
            >
              <IconSpinner class="size-3.5 animate-spin" />
              Reading repositories…
            </span>
          {:else if repoNotice}
            <span
              class="block border-l-2 border-warning px-2 py-1.5 text-micro text-warning"
            >
              {#if repoNotice.kind === 'failed'}
                {repoNotice.message}
              {:else if repoNotice.kind === 'gh-missing'}
                The GitHub CLI is not installed on
                {machineRow?.hostname ?? 'that machine'}. Install
                <code class="font-mono">gh</code>
                there, or paste a clone URL.
              {:else}
                Run <code class="font-mono">gh auth login</code>
                on {machineRow?.hostname ?? 'that machine'} to list its
                repositories, or paste a clone URL.
              {/if}
            </span>
          {:else}
            {#each matches as row (row.nameWithOwner)}
              <button
                class="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                onclick={() => chooseRepo(row)}
                onmousedown={(event) => event.preventDefault()}
                type="button"
              >
                <span class="flex w-full items-center gap-2">
                  <span class="truncate font-mono text-caption text-foreground">
                    {row.nameWithOwner}
                  </span>
                  {#if row.visibility === 'PRIVATE'}
                    <span
                      class="shrink-0 rounded bg-muted px-1 py-px text-micro text-muted-foreground"
                    >
                      private
                    </span>
                  {/if}
                </span>
                {#if row.description}
                  <span
                    class="w-full truncate text-micro text-muted-foreground"
                  >
                    {row.description}
                  </span>
                {/if}
              </button>
            {:else}
              <span class="block px-2 py-1.5 text-micro text-muted-foreground">
                No repository by that name here — it is cloned as you wrote it.
              </span>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex flex-col gap-1">
    <label class="text-micro text-muted-foreground" for="spawn-cwd">
      {source === 'repo' ? 'Clone into' : 'Working directory'}
    </label>
    <Input
      class="font-mono motion-reduce:animate-none {invalid === 'cwd' ? 'animate-shake border-error' : ''}"
      id="spawn-cwd"
      oninput={() => {
        diverge();
        inspectTyped();
      }}
      placeholder={source === 'repo' ? '~' : '/home/you/project'}
      bind:ref={cwdInput}
      bind:value={cwd}
    />
  </div>

  <div class="flex items-center justify-between gap-2">
    <DirectoryPicker
      {machineId}
      onSelect={(path) => {
        cwd = path;
        diverge();
        inspectFolder();
      }}
      value={cwd}
    />
    {#if source === 'repo' && cloneInto}
      <span class="truncate font-mono text-micro text-faint">{cloneInto}</span>
    {/if}
  </div>
{/snippet}

<!-- What the folder itself brings to the session, under whichever way the folder
     was arrived at. Inventory, not state: no status hue, no action — adopting
     what is only on that machine is the fleet inventory's job, not this form's.
     A folder that says nothing renders nothing. -->
{#snippet folderLoads()}
  {#if inspecting}
    <p class="text-micro text-muted-foreground" role="status">
      Reading folder…
    </p>
  {:else if shownChips.length > 0}
    <div
      class="flex flex-wrap items-center gap-1.5"
      in:fade={{ duration: 160, easing: quintOut }}
    >
      <span class="text-caption">This folder loads</span>
      {#each shownChips as chip (chip.key)}
        <span
          class="rounded-full bg-muted px-2 py-0.5 text-micro {chip.dim ?? ''}"
          title={chip.title}
        >
          {chip.label}
          {#if chip.measure}
            <span class="font-mono">{chip.measure}</span>
          {/if}
        </span>
      {/each}
      {#if foldedChips.length > 0}
        <span
          class="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground"
          title={foldedChips.map((chip) => `${chip.label}${chip.measure ?? ''}`).join(', ')}
        >
          +{foldedChips.length}
          more
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet formBody()}
  <form class="flex flex-col gap-3" onsubmit={start}>
    {#if showFields}
      {@render targetFields()}
    {:else}
      {@render prefillSummary()}
    {/if}
    {@render folderLoads()}

    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1">
        <span class="text-micro text-muted-foreground" id="spawn-harness-label"
          >Harness</span
        >
        <Select.Root
          onValueChange={(value) => {
            harness = value as HarnessKind;
          }}
          type="single"
          value={harness}
        >
          <Select.Trigger
            aria-labelledby="spawn-harness-label"
            class="w-full capitalize"
            size="sm"
          >
            {harness}
          </Select.Trigger>
          <Select.Content>
            {#each availableHarnesses as kind (kind)}
              <Select.Item label={kind} value={kind}>
                <span class="capitalize">{kind}</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-micro text-muted-foreground">Model</span>
        <ModelCombobox
          class="w-full text-foreground"
          onchoose={(chosen) => {
            model = chosen;
          }}
          showDefault
          size="sm"
          value={model}
        />
      </div>
    </div>

    {#if offeredModes.length > 0}
      <div class="flex flex-col gap-1">
        <span
          class="text-micro text-muted-foreground"
          id="spawn-permissions-label"
          >Permissions</span
        >
        <Select.Root
          onValueChange={(value) => {
            permissionMode = value as PermissionMode;
          }}
          type="single"
          value={permissionMode}
        >
          <Select.Trigger
            aria-labelledby="spawn-permissions-label"
            class="w-full {permissionMode === 'bypassPermissions' ? 'text-warning' : 'text-foreground'}"
            size="sm"
          >
            {permissionModeLabel(permissionMode)}
          </Select.Trigger>
          <Select.Content>
            {#each offeredModes as mode (mode.value)}
              <Select.Item label={mode.label} value={mode.value}>
                <span class="flex flex-col">
                  <span
                    class={mode.value === 'bypassPermissions' ? 'text-warning' : ''}
                  >
                    {mode.label}
                  </span>
                  <span class="text-micro text-muted-foreground"
                    >{mode.description}</span
                  >
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}

    {#if showEffort}
      <div transition:slide={{ duration: 160 }}>
        <EffortSlider
          modelName={modelLabel(model)}
          onchange={(level) => {
            effort = level;
          }}
          stops={effortStopsForModel}
          value={effort}
        />
      </div>
    {/if}

    <div class="flex flex-col gap-1">
      <label class="text-micro text-muted-foreground" for="spawn-prompt"
        >First prompt (optional)</label
      >
      <Textarea
        class="rounded-[var(--radius-control)] border-[var(--border-control)] bg-[var(--surface-raised)] text-[var(--ink-strong)] field-sizing-content max-h-40 min-h-9"
        id="spawn-prompt"
        placeholder="What should it work on?"
        rows={1}
        bind:ref={promptField}
        bind:value={prompt}
      />
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2 text-micro text-muted-foreground">
        <Checkbox id="spawn-side-quest" bind:checked={sideQuest} />
        <label class="cursor-pointer" for="spawn-side-quest">
          Side quest — kept apart from mainline work until you keep or discard
          it
        </label>
      </div>

      {#if sideQuest}
        <div
          class="flex items-center gap-2 pl-5 text-micro text-muted-foreground"
          transition:slide={{ duration: 160 }}
        >
          <Checkbox id="spawn-worktree" bind:checked={worktree} />
          <label class="cursor-pointer" for="spawn-worktree"
            >in a git worktree of this directory</label
          >
        </div>
      {/if}
    </div>

    {#if workdir && !existingProject && !projectId}
      <div
        class="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border/60 px-3 py-2.5"
        transition:slide={{ duration: 160 }}
      >
        <div class="flex items-center gap-2 text-micro text-muted-foreground">
          <Checkbox id="spawn-save-project" bind:checked={saveAsProject} />
          <label
            class="cursor-pointer text-foreground"
            for="spawn-save-project"
          >
            <IconFolderOpen
              class="mr-1 inline-block size-3.5 align-[-2px] opacity-70"
            />
            Also save as project
          </label>
        </div>
        {#if saveAsProject}
          <label
            class="flex flex-col gap-1 text-micro text-muted-foreground"
            for="spawn-project-name"
            transition:slide={{ duration: 160 }}
          >
            Project name
            <Input
              id="spawn-project-name"
              placeholder={leaf(workdir)}
              bind:value={projectName}
            />
          </label>
        {/if}
      </div>
    {/if}

    <div class="flex items-center gap-3 pt-1">
      <Button class="pressable" disabled={submitting} type="submit">
        {#if submitting}
          <IconSpinner class="animate-spin" />
        {:else}
          <IconPlay />
        {/if}
        Start session
      </Button>
      {#if formError}
        <span class="text-caption text-error" role="alert">{formError}</span>
      {/if}
    </div>
  </form>
{/snippet}

{#if isMobile.current}
  <Sheet.Root onOpenChange={(next) => !next && close()} {open}>
    <Sheet.Content
      class="material-panel flex max-h-[92vh] flex-col gap-0 rounded-t-[var(--radius-shell)] border-t border-border/60 p-0 shadow-xl duration-[240ms] ease-[var(--e-in)]"
      side="bottom"
    >
      <Sheet.Title class="text-title px-5 pt-5 pb-1">New session</Sheet.Title>
      <Sheet.Description class="sr-only"
        >Start a Claude Code session on a machine</Sheet.Description
      >
      <div class="flex-1 overflow-y-auto px-5 pt-2 pb-6">
        {@render formBody()}
      </div>
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <Popover.Root onOpenChange={(next) => !next && close()} {open}>
    <!--
      This popover has no visible trigger of its own — it is opened from
      wherever the fleet view puts its "new session" affordance, over the
      `open` prop. When an external `anchor` element is provided (the tab
      strip's "+" button, for instance), the popover anchors to it. Otherwise
      a fixed 1px point near the top-right corner serves as the fallback.
    -->
    {#if !anchor}
      <span
        aria-hidden="true"
        class="pointer-events-none fixed top-4 right-6 size-px"
        bind:this={anchorEl}
      ></span>
    {/if}
    <Popover.Content
      align="end"
      aria-label="New session"
      class="material-panel w-[480px] max-w-[calc(100vw-2rem)] rounded-[var(--radius-shell)] border border-border/60 p-0 shadow-xl duration-[240ms] ease-[var(--e-in)]"
      customAnchor={anchor ?? anchorEl}
      side="bottom"
      sideOffset={10}
    >
      <div
        class="flex items-center justify-between border-b border-border/60 px-5 py-3.5"
      >
        <h2 class="text-title">New session</h2>
        <Popover.Close>
          {#snippet child({ props })}
            <Button
              {...props}
              aria-label="Close"
              size="icon-sm"
              variant="ghost"
            >
              <IconClose />
            </Button>
          {/snippet}
        </Popover.Close>
      </div>
      <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
        {@render formBody()}
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}

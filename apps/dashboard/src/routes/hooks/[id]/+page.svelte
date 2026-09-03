<script lang="ts">
  import type { HookDraft, HookEvent, HookHandler } from "@whiffle/core";
  import {
    HOOK_EVENTS,
    hookEventInfo,
    hookProblem,
    hookSentence,
    hookTakesMatcher,
  } from "@whiffle/core";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import {
    NativeSelect,
    NativeSelectOptGroup,
  } from "$lib/components/ui/native-select";
  import { Switch } from "$lib/components/ui/switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import { IconArrowRight, IconTrash } from "$lib/icons";
  import { whiffle } from "$lib/whiffle/client.svelte";
  import { confirm } from "$lib/whiffle/confirm.svelte";
  import HookTester from "$lib/whiffle/HookTester.svelte";
  import {
    blankHook,
    draftOf,
    type HookVersion,
    loadHookVersions,
    message,
    removeHook,
    restoreHookVersion,
    saveHook,
  } from "$lib/whiffle/hooks";
  import { newId } from "$lib/whiffle/id";
  import type { PageData } from "./$types";

  /**
   * The hook editor.
   *
   * A hook is a sentence too, same as a rule, and this screen reads it back
   * live for the same reason — but a hook also carries a matcher whose meaning
   * is easy to get silently wrong (`Edit.*` matches `NotebookEdit`), and saving
   * one writes executable material to every machine in the fleet. Both of
   * those get their own weight here that a rule's editor does not need: a live
   * tester for the matcher, and a confirmation naming the blast radius before
   * Save does anything.
   */
  let { data }: { data: PageData } = $props();

  let draft = $state<HookDraft>(
    untrack(() => (data.hook ? draftOf(data.hook) : blankHook()))
  );
  let sample = $state("");
  let busy = $state(false);
  let deleting = $state(false);
  let failed = $state<string | undefined>(undefined);
  /** Problems are held back until a field has been left, so typing is not nagged at. */
  let touched = $state<Record<string, boolean>>({});
  let attempted = $state(false);

  const id = $derived(data.composing ? null : page.params.id);
  const wrong = $derived(hookProblem(draft));
  const shown = (field: string): string | undefined =>
    attempted || touched[field] ? wrong[field] : undefined;

  const duplicate = $derived(
    draft.name.trim() !== "" && data.taken.includes(draft.name.trim())
      ? "Another hook already has that name. Two hooks called the same thing are two hooks you cannot tell apart in a machine’s registration."
      : undefined
  );
  const ready = $derived(
    Object.keys(wrong).length === 0 && duplicate === undefined
  );

  /** HOOK_EVENTS bucketed by group, in the same lifecycle order they are listed. */
  const GROUPED = (() => {
    const groups: { group: string; events: typeof HOOK_EVENTS }[] = [];
    for (const info of HOOK_EVENTS) {
      let bucket = groups.find((candidate) => candidate.group === info.group);
      if (!bucket) {
        bucket = { group: info.group, events: [] };
        groups.push(bucket);
      }
      bucket.events.push(info);
    }
    return groups;
  })();

  const eventInfo = $derived(hookEventInfo(draft.event));

  /** Switching to an event with no matcher clears one — it would otherwise be
   *  saved and silently ignored, which {@link hookProblem} would then flag. */
  function setEvent(next: HookEvent) {
    draft.event = next;
    if (!hookTakesMatcher(next)) {
      draft.matcher = "";
    }
  }

  type HandlerType = HookHandler["type"];
  const HANDLER_LABEL: Record<HandlerType, string> = {
    command: "Command",
    http: "HTTP",
    mcp_tool: "MCP tool",
    prompt: "Prompt",
    agent: "Agent",
  };

  /** Swapping type keeps the three fields every handler shares and drops the rest. */
  function setHandlerType(next: HandlerType) {
    if (draft.handler.type === next) {
      return;
    }
    const { if: cond, timeout, statusMessage } = draft.handler;
    const shared = { if: cond, timeout, statusMessage };
    draft.handler =
      next === "command"
        ? { type: "command", ...shared }
        : next === "http"
          ? { type: "http", url: "", ...shared }
          : next === "mcp_tool"
            ? {
                type: "mcp_tool",
                mcp_server_name: "",
                tool_name: "",
                ...shared,
              }
            : next === "prompt"
              ? { type: "prompt", prompt: "", ...shared }
              : { type: "agent", prompt: "", ...shared };
  }

  /** The command handler's `args` as one line — kept local since the array is
   *  what the fleet reads, and a text field is what a reader types into. */
  let commandArgs = $state(
    untrack(() =>
      draft.handler.type === "command"
        ? (draft.handler.args ?? []).join(" ")
        : ""
    )
  );
  $effect(() => {
    if (draft.handler.type !== "command") {
      return;
    }
    const parts = commandArgs.trim().split(/\s+/).filter(Boolean);
    draft.handler.args = parts.length > 0 ? parts : undefined;
  });

  const scoped = $derived(draft.scope === "project" || draft.scope === "local");

  function setProject(projectId: string) {
    if (projectId === "") {
      draft.scope = undefined;
      draft.projectId = undefined;
      return;
    }
    draft.scope = "project";
    draft.projectId = projectId;
  }

  /** What this hook used to be, for a hook that has already been saved. */
  let versions = $state<HookVersion[]>([]);
  let versionsFailed = $state<string | undefined>(undefined);
  let versionsLoading = $state(false);
  let restoring = $state<number | null>(null);
  $effect(() => {
    const current = id;
    if (!current) {
      versions = [];
      return;
    }
    versionsLoading = true;
    versionsFailed = undefined;
    loadHookVersions(current)
      .then((rows) => {
        if (current !== id) {
          return;
        }
        versions = rows;
      })
      .catch((error: unknown) => {
        if (current !== id) {
          return;
        }
        versionsFailed = message(error);
      })
      .finally(() => {
        if (current === id) {
          versionsLoading = false;
        }
      });
  });

  async function restore(version: HookVersion) {
    restoring = version.id;
    try {
      const hook = await restoreHookVersion(version.id);
      draft = draftOf(hook);
      touched = {};
      attempted = false;
      toast.success(`Restored — this is now what ${hook.name} runs.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      restoring = null;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    if (!ready || busy) {
      return;
    }
    const total = whiffle.machines.length;
    const project = whiffle.projects.find(
      (candidate) => candidate.id === draft.projectId
    );
    const ok = await confirm({
      title: data.composing
        ? `Write ${draft.name.trim()} to the fleet?`
        : `Save ${draft.name.trim()}?`,
      body: scoped
        ? `This writes a script and registers it to run with no prompt, on every machine that has ${project?.name ?? "this project"} checked out.`
        : `This writes a script and registers it to run with no prompt, on every machine in the fleet — ${total} machine${total === 1 ? "" : "s"} right now.`,
      confirmLabel: data.composing ? "Create hook" : "Save changes",
    });
    if (!ok) {
      return;
    }
    busy = true;
    failed = undefined;
    try {
      await saveHook(id ?? newId(), { ...draft, name: draft.name.trim() });
      toast.success(
        `${draft.name.trim()} is written to every machine it applies to.`
      );
      await goto("/hooks");
    } catch (error) {
      failed = message(error);
    } finally {
      busy = false;
    }
  }

  async function askRemove() {
    if (!id) {
      return;
    }
    const ok = await confirm({
      title: `Delete ${draft.name || "this hook"}?`,
      body: "This removes it from every machine that has it — not just switches it off. There's no undo.",
      confirmLabel: "Delete hook",
      destructive: true,
    });
    if (ok) {
      await remove();
    }
  }

  async function remove() {
    if (!id) {
      return;
    }
    deleting = true;
    try {
      await removeHook(id, draft.name);
      await goto("/hooks");
    } catch (error) {
      failed = message(error);
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>{data.composing ? 'New hook' : draft.name || 'Hook'} · Whiffle</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <form class="mx-auto flex max-w-2xl flex-col gap-6" onsubmit={save}>
    <a
      class="flex w-fit items-center gap-1 text-micro text-muted-foreground hover:text-foreground"
      href="/hooks"
    >
      <IconArrowRight class="size-3 shrink-0 rotate-180" />
      Hooks
    </a>

    {#if data.error}
      <div
        class="rounded-[var(--radius-card)] bg-card p-4 shadow-md"
        role="alert"
      >
        <p class="text-caption text-warning">{data.error}</p>
      </div>
    {/if}

    <header class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="sr-only">Hook name</span>
        <input
          aria-invalid={shown('name') || duplicate ? 'true' : undefined}
          autocomplete="off"
          class="w-full border-0 bg-transparent p-0 text-display text-foreground caret-primary outline-none placeholder:text-faint"
          onblur={() => (touched.name = true)}
          placeholder="Name this hook"
          spellcheck="false"
          bind:value={draft.name}
        >
      </label>
      {#if shown('name')}
        <p class="text-micro text-destructive">{wrong.name}</p>
      {:else if duplicate}
        <p class="text-micro text-destructive">{duplicate}</p>
      {/if}

      <!-- The hook, read back. Every field below is a clause of this sentence. -->
      <p
        aria-live="polite"
        class="max-w-prose rounded-[var(--radius-card)] bg-primary/8 p-4 text-body text-foreground transition-all duration-240 ease-[var(--e-in)]"
      >
        {hookSentence(draft)}
      </p>

      <label class="flex w-fit items-center gap-3">
        <Switch bind:checked={draft.enabled} />
        <span class="text-caption">
          {draft.enabled ? 'Registered on every machine it applies to' : 'Off — nothing is registered'}
        </span>
      </label>
    </header>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">When it runs</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          One lifecycle event. The events with a matcher are the ones Claude
          Code lets you narrow further.
        </p>
      </div>

      <label class="flex flex-col gap-1.5 text-caption">
        Event
        <NativeSelect
          class="w-full"
          onchange={(event) => {
            touched.event = true;
            setEvent(event.currentTarget.value as HookEvent);
          }}
          value={draft.event}
        >
          {#each GROUPED as bucket (bucket.group)}
            <NativeSelectOptGroup label={bucket.group}>
              {#each bucket.events as info (info.event)}
                <option value={info.event}>{info.event}</option>
              {/each}
            </NativeSelectOptGroup>
          {/each}
        </NativeSelect>
        {#if shown('event')}
          <span class="text-micro text-destructive">{wrong.event}</span>
        {:else if eventInfo}
          <span class="text-micro text-muted-foreground"
            >Runs {eventInfo.blurb}.</span
          >
        {/if}
      </label>

      {#if hookTakesMatcher(draft.event)}
        <label class="flex flex-col gap-1.5 text-caption">
          Matcher — {eventInfo?.filters}
          <Input
            aria-invalid={shown('matcher') ? 'true' : undefined}
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            onblur={() => (touched.matcher = true)}
            placeholder={eventInfo?.suggests?.[0] ?? '*'}
            spellcheck="false"
            bind:value={draft.matcher}
          />
          {#if shown('matcher')}
            <span class="text-micro text-destructive">{wrong.matcher}</span>
          {:else}
            <span class="text-micro text-muted-foreground">
              Empty or <span class="font-mono">*</span> matches every value. See
              below for what this one actually does.
            </span>
          {/if}
        </label>

        <HookTester
          event={draft.event}
          bind:matcher={draft.matcher}
          bind:sample
        />
      {/if}
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What it runs</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Whiffle writes this to every machine it applies to and registers it —
          no prompt, no approval, every time the event fires.
        </p>
      </div>

      <ToggleGroup.Root
        class="w-full"
        onValueChange={(next) => next && setHandlerType(next as HandlerType)}
        size="sm"
        type="single"
        value={draft.handler.type}
        variant="outline"
      >
        {#each Object.entries(HANDLER_LABEL) as [value, label] (value)}
          <ToggleGroup.Item class="flex-1 text-caption" {value}
            >{label}</ToggleGroup.Item
          >
        {/each}
      </ToggleGroup.Root>

      {#if draft.handler.type === 'command'}
        <label class="flex flex-col gap-1.5 text-caption">
          Script
          <Textarea
            aria-invalid={shown('script') ? 'true' : undefined}
            class="resize-y font-mono text-sm md:text-sm"
            onblur={() => (touched.script = true)}
            placeholder={'#!/bin/bash\nset -euo pipefail\n\n# The event JSON arrives on stdin.'}
            rows={10}
            spellcheck="false"
            bind:value={draft.script}
          />
          {#if shown('script')}
            <span class="text-micro text-destructive">{wrong.script}</span>
          {:else}
            <span class="text-micro text-muted-foreground">
              Written to every machine, at a path Whiffle picks — the hook
              always points at that copy, never at one you keep locally.
            </span>
          {/if}
        </label>

        <label class="flex flex-col gap-1.5 text-caption">
          Arguments (optional)
          <Input
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            placeholder="--flag value"
            spellcheck="false"
            bind:value={commandArgs}
          />
        </label>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-3">
            <Switch
              checked={draft.handler.async === true}
              onCheckedChange={(next) => {
                if (draft.handler.type === 'command') draft.handler.async = next;
              }}
            />
            <span class="flex flex-col gap-0.5">
              <span class="text-caption">Run in the background</span>
              <span class="max-w-prose text-micro text-muted-foreground">
                Claude Code does not wait for it before continuing.
              </span>
            </span>
          </label>

          <ToggleGroup.Root
            onValueChange={(next) => {
              if (draft.handler.type !== 'command' || !next) return;
              draft.handler.shell = next === 'bash' ? undefined : (next as 'powershell');
            }}
            size="sm"
            type="single"
            value={draft.handler.shell ?? 'bash'}
            variant="outline"
          >
            <ToggleGroup.Item class="text-caption" value="bash"
              >bash</ToggleGroup.Item
            >
            <ToggleGroup.Item class="text-caption" value="powershell"
              >PowerShell</ToggleGroup.Item
            >
          </ToggleGroup.Root>
        </div>
      {:else if draft.handler.type === 'http'}
        <label class="flex flex-col gap-1.5 text-caption">
          URL
          <Input
            aria-invalid={shown('url') ? 'true' : undefined}
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            onblur={() => (touched.url = true)}
            placeholder="https://example.com/hooks/whiffle"
            spellcheck="false"
            bind:value={draft.handler.url}
          />
          {#if shown('url')}
            <span class="text-micro text-destructive">{wrong.url}</span>
          {:else}
            <span class="text-micro text-muted-foreground">
              Every machine posts the event's own JSON here — https, or
              localhost for something running on the same box.
            </span>
          {/if}
        </label>
      {:else if draft.handler.type === 'mcp_tool'}
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-caption">
            MCP server
            <Input
              aria-invalid={shown('mcp_server_name') ? 'true' : undefined}
              autocomplete="off"
              class="font-mono text-sm md:text-sm"
              onblur={() => (touched.mcp_server_name = true)}
              placeholder="filesystem"
              spellcheck="false"
              bind:value={draft.handler.mcp_server_name}
            />
            {#if shown('mcp_server_name')}
              <span class="text-micro text-destructive"
                >{wrong.mcp_server_name}</span
              >
            {/if}
          </label>
          <label class="flex flex-col gap-1.5 text-caption">
            Tool
            <Input
              aria-invalid={shown('tool_name') ? 'true' : undefined}
              autocomplete="off"
              class="font-mono text-sm md:text-sm"
              onblur={() => (touched.tool_name = true)}
              placeholder="read_file"
              spellcheck="false"
              bind:value={draft.handler.tool_name}
            />
            {#if shown('tool_name')}
              <span class="text-micro text-destructive">{wrong.tool_name}</span>
            {/if}
          </label>
        </div>
      {:else}
        <label class="flex flex-col gap-1.5 text-caption">
          Prompt
          <Textarea
            aria-invalid={shown('prompt') ? 'true' : undefined}
            class="resize-y text-sm md:text-sm"
            onblur={() => (touched.prompt = true)}
            placeholder="Decide whether this change needs a changelog entry, and say why."
            rows={4}
            bind:value={draft.handler.prompt}
          />
          {#if shown('prompt')}
            <span class="text-micro text-destructive">{wrong.prompt}</span>
          {/if}
        </label>
        {#if draft.handler.type === 'agent'}
          <label class="flex flex-col gap-1.5 text-caption">
            Subagent (optional)
            <Input
              autocomplete="off"
              class="font-mono text-sm md:text-sm"
              placeholder="Inherits Claude Code's default"
              spellcheck="false"
              bind:value={draft.handler.agent}
            />
          </label>
        {/if}
      {/if}
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Common fields</h2>
      </div>

      <label class="flex flex-col gap-1.5 text-caption">
        Condition (optional)
        <Input
          aria-invalid={shown('if') ? 'true' : undefined}
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          onblur={() => (touched.if = true)}
          oninput={(event) => (draft.handler.if = event.currentTarget.value || undefined)}
          placeholder="Bash(git *)"
          spellcheck="false"
          value={draft.handler.if ?? ''}
        />
        {#if shown('if')}
          <span class="text-micro text-destructive">{wrong.if}</span>
        {:else}
          <span class="text-micro text-muted-foreground">
            A permission rule narrowing when this runs. Only read on tool
            events.
          </span>
        {/if}
      </label>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5 text-caption">
          Timeout, seconds (optional)
          <Input
            aria-invalid={shown('timeout') ? 'true' : undefined}
            class="font-mono text-sm md:text-sm"
            min="1"
            oninput={(event) => {
              const raw = event.currentTarget.value;
              draft.handler.timeout = raw === '' ? undefined : Number(raw);
            }}
            placeholder="Claude Code's default"
            step="1"
            type="number"
            value={draft.handler.timeout ?? ''}
          />
          {#if shown('timeout')}
            <span class="text-micro text-destructive">{wrong.timeout}</span>
          {/if}
        </label>
        <label class="flex flex-col gap-1.5 text-caption">
          Status message (optional)
          <Input
            autocomplete="off"
            class="text-sm md:text-sm"
            oninput={(event) => (draft.handler.statusMessage = event.currentTarget.value || undefined)}
            placeholder="Formatting…"
            spellcheck="false"
            value={draft.handler.statusMessage ?? ''}
          />
        </label>
      </div>
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Where it applies</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Every machine in the fleet unless you narrow it to one project.
        </p>
      </div>

      <label class="flex flex-col gap-1.5 text-caption">
        Scope
        <NativeSelect
          class="w-full"
          onchange={(event) => setProject(event.currentTarget.value)}
          value={draft.projectId ?? ''}
        >
          <option value="">Every machine in the fleet</option>
          {#each whiffle.projects as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </NativeSelect>
        {#if shown('scope')}
          <span class="text-micro text-destructive">{wrong.scope}</span>
        {/if}
      </label>
    </section>

    <!-- Only a saved hook has a past; a draft has not been anything else yet. -->
    {#if id}
      <section
        class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
      >
        <div class="flex flex-col gap-1">
          <h2 class="text-body font-medium">Previous versions</h2>
          <p class="max-w-prose text-micro text-muted-foreground">
            Every save keeps what it replaced. Restoring writes an old version
            back as this one.
          </p>
        </div>
        {#if versionsLoading}
          <p class="text-caption text-muted-foreground">Loading…</p>
        {:else if versionsFailed}
          <p class="text-caption text-warning" role="alert">{versionsFailed}</p>
        {:else if versions.length === 0}
          <p class="text-caption text-muted-foreground">
            Nothing has been saved over yet.
          </p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each versions as version (version.id)}
              <li
                class="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] bg-muted/40 p-3"
              >
                <span class="flex flex-col gap-0.5">
                  <span class="text-caption text-foreground"
                    >{version.name}</span
                  >
                  <span class="text-micro text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString()}
                    · <span class="font-mono">{version.hash.slice(0, 7)}</span>
                  </span>
                </span>
                <Button
                  disabled={restoring !== null}
                  onclick={() => restore(version)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  {restoring === version.id ? 'Restoring…' : 'Restore'}
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if failed}
      <p class="text-caption text-destructive" role="alert">{failed}</p>
    {/if}

    <!-- Pinned, same reasoning as /rules/[id]: a Save that scrolls off is a Save
         nobody finds on a long form. -->
    <div
      class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-[var(--surface-content)] py-[var(--space-4)] [padding-bottom:calc(var(--space-4)+env(safe-area-inset-bottom))]"
    >
      {#if id}
        <Button
          class="text-muted-foreground hover:text-destructive"
          disabled={deleting || busy}
          onclick={askRemove}
          size="sm"
          type="button"
          variant="ghost"
        >
          <IconTrash class="shrink-0" />
          {deleting ? 'Deleting…' : 'Delete hook'}
        </Button>
      {:else}
        <span></span>
      {/if}
      <div class="flex items-center gap-2">
        <Button
          disabled={busy}
          onclick={() => goto('/hooks')}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={busy || deleting} type="submit">
          {busy ? 'Saving…' : data.composing ? 'Create hook' : 'Save changes'}
        </Button>
      </div>
    </div>
  </form>
</div>

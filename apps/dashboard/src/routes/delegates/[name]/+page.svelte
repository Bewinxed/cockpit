<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { NativeSelect } from "$lib/components/ui/native-select";
  import { Switch } from "$lib/components/ui/switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import { IconArrowRight, IconTrash } from "$lib/icons";
  import { confirm } from "$lib/whiffle/confirm.svelte";
  import type { DelegateType } from "$lib/whiffle/delegate-types";
  import {
    blankDelegateType,
    DELEGATE_EFFORTS,
    DELEGATE_HARNESSES,
    delegateTypeProblem,
    message,
    removeDelegateType,
    saveDelegateType,
  } from "$lib/whiffle/delegate-types";
  import type { PageData } from "./$types";

  /**
   * The delegate-type editor.
   *
   * The description is the whole of how a calling agent routes here — there
   * is no separate "when to use this" field, because that field would just be
   * a second, competing description — so it gets the largest field on the
   * form, above harness/model/effort rather than beside them.
   *
   * Its own page rather than a dialog, the same reasoning as `rules/[id]`:
   * there is a name, a big description, a harness/model/effort group, two
   * list fields and a delete — a modal that scrolls should have been a page.
   */
  let { data }: { data: PageData } = $props();

  const blank = blankDelegateType();
  let draft = $state<DelegateType>(
    untrack(() => (data.type ? { ...data.type } : blank))
  );
  let skillsText = $state(untrack(() => (data.type?.skills ?? []).join(", ")));
  let denyToolsText = $state(
    untrack(() => (data.type?.denyTools ?? []).join(", "))
  );
  /** A stored `undefined` reads as the leaf default the hub applies anyway. */
  let canDelegate = $state(untrack(() => data.type?.canDelegate === true));
  let busy = $state(false);
  let deleting = $state(false);
  let failed = $state<string | undefined>(undefined);
  let touched = $state<Record<string, boolean>>({});
  let attempted = $state(false);

  const name = $derived(data.composing ? null : page.params.name);

  const parsedList = (text: string): string[] | undefined => {
    const items = text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length ? items : undefined;
  };

  const submission = $derived<DelegateType>({
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    model: draft.model.trim(),
    skills: parsedList(skillsText),
    denyTools: parsedList(denyToolsText),
    canDelegate,
  });

  const problem = $derived(delegateTypeProblem(submission));
  const shown = (field: string): boolean =>
    attempted || touched[field] === true;

  const duplicate = $derived(
    submission.name !== "" && data.taken.includes(submission.name)
      ? "Another delegate type already has that name. Two types called the same thing are two a calling agent cannot tell apart."
      : undefined
  );

  const ready = $derived(problem === undefined && duplicate === undefined);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    if (!ready || busy) {
      return;
    }
    busy = true;
    failed = undefined;
    try {
      await saveDelegateType(submission);
      toast.success(`${submission.name} is available to new sessions.`);
      await goto("/delegates");
    } catch (error) {
      failed = message(error);
    } finally {
      busy = false;
    }
  }

  async function askRemove() {
    if (!name) {
      return;
    }
    const ok = await confirm({
      title: `Delete ${draft.name || "this delegate type"}?`,
      body: "A session already running keeps the type list it started with — the prompt cache is frozen for its lifetime. This only stops the name from being offered to new sessions.",
      confirmLabel: "Delete delegate type",
      destructive: true,
    });
    if (ok) {
      await remove();
    }
  }

  async function remove() {
    if (!name) {
      return;
    }
    deleting = true;
    try {
      await removeDelegateType(name);
      await goto("/delegates");
    } catch (error) {
      failed = message(error);
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>
    {data.composing ? 'New delegate type' : draft.name || 'Delegate type'}
    &middot; Whiffle
  </title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <form class="mx-auto flex max-w-2xl flex-col gap-6" onsubmit={save}>
    <a
      class="flex w-fit items-center gap-1 text-micro text-muted-foreground hover:text-foreground"
      href="/delegates"
    >
      <IconArrowRight class="size-3 shrink-0 rotate-180" />
      Delegates
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
      <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <Input> component renders a native input as its only child; Biome can't see through the component boundary -->
      <label class="flex flex-col gap-1.5">
        <span class="text-micro text-muted-foreground">Name</span>
        <Input
          aria-invalid={(shown('name') && problem) || duplicate ? 'true' : undefined}
          autocomplete="off"
          class="font-mono"
          disabled={!data.composing}
          onblur={() => {
            touched.name = true;
          }}
          placeholder="explore"
          spellcheck="false"
          bind:value={draft.name}
        />
        <span class="text-micro text-muted-foreground">
          {data.composing
            ? 'Lowercase letters, digits and hyphens — the exact string a delegate call\'s type param names.'
            : 'The name is the key a running call already asks for by; renaming means creating a new type.'}
        </span>
      </label>
      {#if shown('name') && problem?.includes('name')}
        <p class="text-micro text-destructive">{problem}</p>
      {:else if duplicate}
        <p class="text-micro text-destructive">{duplicate}</p>
      {/if}
    </header>

    <!-- The description is the product: the calling agent's only signal for
         whether this is the right type, so it is the largest field on the form. -->
    <section
      class="flex flex-col gap-2 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Description</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          What the calling model reads to decide whether this is the type to
          route to — not a note for you, a routing signal for it.
        </p>
      </div>
      <Textarea
        aria-invalid={shown('description') && problem?.includes('description') ? 'true' : undefined}
        class="resize-y text-sm md:text-sm"
        onblur={() => {
          touched.description = true;
        }}
        placeholder="Read-only codebase exploration and fan-out search; returns conclusions, not file dumps."
        rows={4}
        bind:value={draft.description}
      />
      {#if shown('description') && problem?.includes('description')}
        <span class="text-micro text-destructive">{problem}</span>
      {/if}
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What it runs on</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          The harness and model the delegate spawns on, and how hard it should
          think.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <NativeSelect> component renders a native select as its only child; Biome can't see through the component boundary -->
        <label class="flex flex-col gap-1.5 text-caption">
          Harness
          <NativeSelect class="w-full" bind:value={draft.harness}>
            {#each DELEGATE_HARNESSES as harness (harness)}
              <option value={harness}>{harness}</option>
            {/each}
          </NativeSelect>
        </label>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <Input> component renders a native input as its only child; Biome can't see through the component boundary -->
        <label class="flex flex-col gap-1.5 text-caption">
          Model
          <Input
            aria-invalid={shown('model') && problem?.includes('model') ? 'true' : undefined}
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            onblur={() => {
              touched.model = true;
            }}
            placeholder="sonnet"
            spellcheck="false"
            bind:value={draft.model}
          />
        </label>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <NativeSelect> component renders a native select as its only child; Biome can't see through the component boundary -->
        <label class="flex flex-col gap-1.5 text-caption">
          Effort
          <NativeSelect
            class="w-full"
            onchange={(event) => {
              const next = event.currentTarget.value;
              if (next === '') {
                // biome-ignore lint/performance/noDelete: removes the key entirely so an unset effort is omitted from the saved payload, not serialized as effort: undefined
                delete draft.effort;
              } else {
                draft.effort = next as DelegateType['effort'];
              }
            }}
            value={draft.effort ?? ''}
          >
            <option value="">Unset</option>
            {#each DELEGATE_EFFORTS as effort (effort)}
              <option value={effort}>{effort}</option>
            {/each}
          </NativeSelect>
        </label>
      </div>
      {#if shown('model') && problem?.includes('model')}
        <span class="text-micro text-destructive">{problem}</span>
      {/if}
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What it can reach</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Comma-separated. Both are optional narrowings, not requirements —
          empty means the delegate has the harness's ordinary defaults.
        </p>
      </div>

      <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <Input> component renders a native input as its only child; Biome can't see through the component boundary -->
      <label class="flex flex-col gap-1.5 text-caption">
        Skills
        <Input
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          placeholder="svelte-foundations:coding, ui-observer"
          spellcheck="false"
          bind:value={skillsText}
        />
      </label>

      <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <Input> component renders a native input as its only child; Biome can't see through the component boundary -->
      <label class="flex flex-col gap-1.5 text-caption">
        Tools denied
        <Input
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          placeholder="Write, Edit, NotebookEdit"
          spellcheck="false"
          bind:value={denyToolsText}
        />
      </label>

      <!-- The one field here that widens rather than narrows: a delegate is a
           leaf unless its type (or the call itself) says otherwise. -->
      <!-- biome-ignore lint/a11y/noLabelWithoutControl: the <Switch> component renders a native checkbox input; Biome can't see through the component boundary -->
      <label class="flex w-fit items-center gap-3">
        <Switch bind:checked={canDelegate} />
        <span class="text-caption">
          {canDelegate
            ? 'May delegate — it can spawn delegates and sessions of its own'
            : 'Leaf — it does the work itself and cannot delegate further'}
        </span>
      </label>
    </section>

    <Alert.Root
      class="rounded-[var(--radius-control)] border-[var(--border-control)] bg-[var(--surface-field)]"
    >
      <Alert.Description
        class="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[color:var(--ink-muted)]"
      >
        Changes apply to new sessions only — running sessions keep the type list
        they started with.
      </Alert.Description>
    </Alert.Root>

    {#if failed}
      <p class="text-caption text-destructive" role="alert">{failed}</p>
    {/if}

    <div
      class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-[var(--surface-content)] py-[var(--space-4)] [padding-bottom:calc(var(--space-4)+env(safe-area-inset-bottom))]"
    >
      {#if name}
        <Button
          class="text-muted-foreground hover:text-destructive"
          disabled={deleting || busy}
          onclick={askRemove}
          size="sm"
          type="button"
          variant="ghost"
        >
          <IconTrash class="shrink-0" />
          {deleting ? 'Deleting…' : 'Delete delegate type'}
        </Button>
      {:else}
        <span></span>
      {/if}
      <div class="flex items-center gap-2">
        <Button
          disabled={busy}
          onclick={() => goto('/delegates')}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={busy || deleting} type="submit">
          {#if busy}
            Saving…
          {:else if data.composing}
            Create delegate type
          {:else}
            Save changes
          {/if}
        </Button>
      </div>
    </div>
  </form>
</div>

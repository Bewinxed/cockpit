<script lang="ts">
  import type {
    HarnessKind,
    RuleAction,
    RuleDraft,
    RuleTiming,
    RuleTrigger,
    RuleWatch,
  } from "@whiffle/core";
  import { HARNESSES, ruleProblem, ruleSentence } from "@whiffle/core";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { NativeSelect } from "$lib/components/ui/native-select";
  import { Switch } from "$lib/components/ui/switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Toggle } from "$lib/components/ui/toggle";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import { IconArrowRight, IconTrash } from "$lib/icons";
  import { whiffle } from "$lib/whiffle/client.svelte";
  import { confirm } from "$lib/whiffle/confirm.svelte";
  import RuleActivity from "$lib/whiffle/RuleActivity.svelte";
  import RuleTester from "$lib/whiffle/RuleTester.svelte";
  import {
    blankRule,
    createRule,
    draftOf,
    message,
    removeRule,
    saveRule,
    WHIP_PRESETS,
  } from "$lib/whiffle/rules";
  import type { PageData } from "./$types";

  /**
   * The rule editor.
   *
   * A rule is a sentence, and this screen is that sentence twice: once read
   * back in English at the top, live, and once as the fields that compose it.
   * The English is not decoration — it is the only place the interaction
   * between timing, interruption and acknowledgement is legible at a glance,
   * and it is what catches a rule that says something its author did not mean.
   *
   * Its own page rather than a dialog: there are four groups of decisions and a
   * test box here, and a modal that has to scroll is a modal that should have
   * been a page.
   */
  let { data }: { data: PageData } = $props();

  let draft = $state<RuleDraft>(
    untrack(() => (data.rule ? draftOf(data.rule) : blankRule()))
  );
  let sample = $state("");
  let busy = $state(false);
  let deleting = $state(false);
  let failed = $state<string | undefined>(undefined);
  /** Problems are held back until a field has been left, so typing is not nagged at. */
  let touched = $state<Record<string, boolean>>({});
  let attempted = $state(false);

  const id = $derived(data.composing ? null : page.params.id);
  const wrong = $derived(ruleProblem(draft));
  const shown = (field: string): string | undefined =>
    attempted || touched[field] ? wrong[field] : undefined;

  const duplicate = $derived(
    draft.name.trim() !== "" && data.taken.includes(draft.name.trim())
      ? "Another rule already has that name. Two rules called the same thing are two rules you cannot tell apart in a transcript."
      : undefined
  );

  /** Every model the fleet is actually running, so the filter is not free text. */
  const models = $derived(
    [
      ...new Set(
        whiffle.instances
          .map((row) => row.model)
          .filter(
            (model): model is string =>
              typeof model === "string" && model !== ""
          )
      ),
    ].sort()
  );

  const TIMING: { value: RuleTiming; label: string; how: string }[] = [
    {
      value: "turn",
      label: "When the turn ends",
      how: "The session has stopped and is idle, so your reply wakes it into a new turn. This is the one that makes it keep working.",
    },
    {
      value: "message",
      label: "When the message ends",
      how: "Queued as soon as the message that tripped the rule is complete. The session reads it at the next turn boundary, uninterrupted.",
    },
    {
      value: "immediate",
      label: "The moment it appears",
      how: "Sent mid-message, as soon as the words show up in the stream.",
    },
  ];

  const WATCH: { value: RuleWatch; label: string }[] = [
    { value: "text", label: "What it says" },
    { value: "thinking", label: "What it thinks" },
    { value: "both", label: "Both" },
  ];

  const how = $derived(
    TIMING.find((option) => option.value === draft.timing)?.how ?? ""
  );

  /** Switching trigger clears fields that belong to the other shape. */
  function setTrigger(next: RuleTrigger) {
    draft.trigger = next;
    if (next === "every-turn") {
      // every-turn + reply is illegal; force llm action
      draft.action = "llm";
      draft.timing = "turn";
      draft.interrupt = false;
      draft.requireAck = false;
    }
  }

  /** Switching action clears fields that belong to the other shape. */
  function setAction(next: RuleAction) {
    draft.action = next;
    if (next === "llm") {
      draft.timing = "turn";
      draft.interrupt = false;
      draft.requireAck = false;
    }
  }

  /** Fills the form from a whip preset — the click-to-fill rack. */
  function usePreset(preset: (typeof WHIP_PRESETS)[number]) {
    draft.name = preset.name;
    draft.trigger = preset.trigger;
    draft.action = preset.action;
    draft.prompt = preset.prompt;
    draft.timing = "turn";
    draft.interrupt = false;
    draft.requireAck = false;
    draft.enabled = true;
  }

  /** Interruption is only meaningful mid-turn; changing away from it clears the flag. */
  function setTiming(next: RuleTiming) {
    draft.timing = next;
    if (next !== "immediate") {
      draft.interrupt = false;
    }
  }

  /** A blank select means "everywhere", which is stored as the key being absent. */
  function narrow(
    key: "machineId" | "projectId" | "harness" | "model",
    value: string
  ) {
    if (value === "") {
      delete draft.scope[key];
    } else if (key === "harness") {
      draft.scope.harness = value as HarnessKind;
    } else {
      draft.scope[key] = value;
    }
  }

  const ready = $derived(
    Object.keys(wrong).length === 0 && duplicate === undefined
  );

  async function save(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    if (!ready || busy) {
      return;
    }
    busy = true;
    failed = undefined;
    try {
      const trimmed = { ...draft, name: draft.name.trim() };
      await (id ? saveRule(id, trimmed) : createRule(trimmed));
      toast.success(
        `${draft.name.trim()} is live on every session it applies to.`
      );
      await goto("/rules");
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
      title: `Delete ${draft.name || "this rule"}?`,
      body: "This rule stops applying to every session and is removed for good. You can always write it again, but there's no undo.",
      confirmLabel: "Delete rule",
      destructive: true,
    });
    if (ok) {
      await remove();
    }
  }

  const saveLabel = $derived.by(() => {
    if (busy) {
      return "Saving…";
    }
    return data.composing ? "Create rule" : "Save changes";
  });

  async function remove() {
    if (!id) {
      return;
    }
    deleting = true;
    try {
      await removeRule(id, draft.name);
      await goto("/rules");
    } catch (error) {
      failed = message(error);
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>{data.composing ? 'New rule' : draft.name || 'Rule'} · Whiffle</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <form class="mx-auto flex max-w-2xl flex-col gap-6" onsubmit={save}>
    <a
      class="flex w-fit items-center gap-1 text-micro text-muted-foreground hover:text-foreground"
      href="/rules"
    >
      <IconArrowRight class="size-3 shrink-0 rotate-180" />
      Rules
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
        <span class="sr-only">Rule name</span>
        <input
          aria-invalid={shown('name') || duplicate ? 'true' : undefined}
          autocomplete="off"
          class="w-full border-0 bg-transparent p-0 text-display text-foreground caret-primary outline-none placeholder:text-faint"
          onblur={() => {
            touched.name = true;
          }}
          placeholder="Name this rule"
          spellcheck="false"
          bind:value={draft.name}
        >
      </label>
      {#if shown('name')}
        <p class="text-micro text-destructive">{wrong.name}</p>
      {:else if duplicate}
        <p class="text-micro text-destructive">{duplicate}</p>
      {/if}

      <!-- The rule, read back. It is the only place the whole thing is one thought. -->
      <p
        aria-live="polite"
        class="max-w-prose rounded-[var(--radius-card)] bg-primary/8 p-4 text-body text-foreground transition-all duration-240 ease-[var(--e-in)]"
      >
        {ruleSentence(draft)}
      </p>

      <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> component; the native control it renders is not visible to Biome -->
      <label class="flex w-fit items-center gap-3">
        <Switch bind:checked={draft.enabled} />
        <span class="text-caption">
          {draft.enabled ? 'Watching every session it applies to' : 'Off — it watches nothing'}
        </span>
      </label>
    </header>

    {#if data.composing}
      <section
        class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
      >
        <div class="flex flex-col gap-1">
          <h2 class="text-body font-medium">Whip presets</h2>
          <p class="max-w-prose text-micro text-muted-foreground">
            Pre-written supervisor rules that beat bad habits out of coding
            agents. Click one to fill the form — it is an ordinary rule once
            saved.
          </p>
        </div>
        <ul class="flex flex-col">
          {#each WHIP_PRESETS as preset (preset.name)}
            <li
              class="flex flex-wrap items-start justify-between gap-3 border-t border-[var(--border-hairline)] py-3 first:border-t-0 first:pt-0"
            >
              <div
                class="flex min-w-0 flex-1 flex-col gap-1"
                style="flex-basis: 280px"
              >
                <span
                  class="text-caption font-medium text-[color:var(--ink-strong)]"
                  >{preset.name}</span
                >
                <span class="text-micro text-muted-foreground"
                  >{preset.prompt}</span
                >
              </div>
              <Button
                onclick={() => usePreset(preset)}
                size="sm"
                type="button"
                variant="outline"
              >
                Use
              </Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What to watch for</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Whiffle reads what a session writes, not what you write to it.
        </p>
      </div>

      <fieldset class="flex flex-col gap-1.5 text-caption">
        <legend class="mb-1.5">Trigger</legend>
        <ToggleGroup.Root
          class="w-full"
          onValueChange={(next) => next && setTrigger(next as RuleTrigger)}
          size="sm"
          type="single"
          value={draft.trigger}
          variant="outline"
        >
          <ToggleGroup.Item class="flex-1 text-caption" value="pattern">
            A pattern match
          </ToggleGroup.Item>
          <ToggleGroup.Item class="flex-1 text-caption" value="every-turn">
            Every turn
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        {#if shown('trigger')}
          <span class="text-micro text-destructive">{wrong.trigger}</span>
        {/if}
        {#if draft.trigger === 'every-turn'}
          <span class="text-micro text-muted-foreground">
            The rule fires at the end of every turn — no pattern needed. The
            supervisor judges each turn and decides what to do.
          </span>
        {/if}
      </fieldset>

      {#if draft.trigger === 'pattern'}
        <ToggleGroup.Root
          class="w-full"
          onValueChange={(next) => {
            if (next) {
              draft.matchKind = next as 'phrase' | 'regex';
            }
          }}
          size="sm"
          type="single"
          value={draft.matchKind}
          variant="outline"
        >
          <ToggleGroup.Item class="flex-1 text-caption" value="phrase"
            >A phrase</ToggleGroup.Item
          >
          <ToggleGroup.Item class="flex-1 text-caption" value="regex">
            A regular expression
          </ToggleGroup.Item>
        </ToggleGroup.Root>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Input> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          {draft.matchKind === 'phrase' ? 'Phrase' : 'Expression'}
          <Input
            aria-invalid={shown('pattern') ? 'true' : undefined}
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            onblur={() => {
              touched.pattern = true;
            }}
            placeholder={draft.matchKind === 'phrase'
              ? 'honest caveat'
              : 'should (work|be fine)|probably works'}
            spellcheck="false"
            bind:value={draft.pattern}
          />
          {#if shown('pattern')}
            <span class="text-micro text-destructive">{wrong.pattern}</span>
          {:else if draft.matchKind === 'regex'}
            <span class="text-micro text-muted-foreground">
              JavaScript syntax. It is matched against the whole message, not
              line by line.
            </span>
          {/if}
        </label>

        <div class="flex flex-wrap items-center gap-2">
          <Toggle
            onPressedChange={(next) => {
              draft.caseSensitive = next;
            }}
            pressed={draft.caseSensitive}
            size="sm"
            variant="outline"
          >
            Case sensitive
          </Toggle>
          {#if draft.matchKind === 'phrase'}
            <Toggle
              onPressedChange={(next) => {
                draft.wholeWord = next;
              }}
              pressed={draft.wholeWord}
              size="sm"
              variant="outline"
            >
              Whole words only
            </Toggle>
          {/if}
        </div>

        <fieldset class="flex flex-col gap-1.5 text-caption">
          <legend class="mb-1.5">Read</legend>
          <ToggleGroup.Root
            class="w-full"
            onValueChange={(next) => {
              if (next) {
                draft.watch = next as RuleWatch;
              }
            }}
            size="sm"
            type="single"
            value={draft.watch}
            variant="outline"
          >
            {#each WATCH as option (option.value)}
              <ToggleGroup.Item
                class="flex-1 text-caption"
                value={option.value}
              >
                {option.label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
          {#if draft.watch !== 'text' && draft.timing === 'turn'}
            <span class="text-micro text-warning">
              Reasoning is not kept once a turn is over. To watch thinking, fire
              on the message or the moment instead.
            </span>
          {/if}
        </fieldset>

        <RuleTester {draft} bind:sample />
      {/if}
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What Whiffle sends back</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          The session is told this is Whiffle and not you, so it does not answer
          you for something you never said.
        </p>
      </div>

      <fieldset class="flex flex-col gap-1.5 text-caption">
        <legend class="mb-1.5">Action</legend>
        <ToggleGroup.Root
          class="w-full"
          onValueChange={(next) => next && setAction(next as RuleAction)}
          size="sm"
          type="single"
          value={draft.action}
          variant="outline"
        >
          <ToggleGroup.Item
            class="flex-1 text-caption"
            disabled={draft.trigger === 'every-turn'}
            value="reply"
          >
            Canned reply
          </ToggleGroup.Item>
          <ToggleGroup.Item class="flex-1 text-caption" value="llm">
            LLM verdict
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        {#if draft.action === 'llm'}
          <span class="text-micro text-muted-foreground">
            The supervisor reads the turn and decides what to say. You write the
            standing instructions; it writes the reply.
          </span>
        {/if}
      </fieldset>

      {#if draft.action === 'reply'}
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Textarea> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          Reply
          <Textarea
            aria-invalid={shown('reply') ? 'true' : undefined}
            class="resize-y text-sm md:text-sm"
            onblur={() => {
              touched.reply = true;
            }}
            placeholder="if there's an honest caveat that you are aware of and you're just reporting it to the user instead of fixing it, then your work is not done yet"
            rows={4}
            bind:value={draft.reply}
          />
          {#if shown('reply')}
            <span class="text-micro text-destructive">{wrong.reply}</span>
          {/if}
        </label>
      {:else}
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Textarea> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          Supervisor instructions
          <Textarea
            aria-invalid={shown('prompt') ? 'true' : undefined}
            class="resize-y text-sm md:text-sm"
            onblur={() => {
              touched.prompt = true;
            }}
            placeholder="If the agent claims work is done without pasting test output, reject the claim. Tell it to run the tests and paste the full output."
            rows={4}
            bind:value={draft.prompt}
          />
          {#if shown('prompt')}
            <span class="text-micro text-destructive">{wrong.prompt}</span>
          {/if}
        </label>
      {/if}

      {#if draft.action === 'reply'}
        <fieldset class="flex flex-col gap-1.5 text-caption">
          <legend class="mb-1.5">Send it</legend>
          <ToggleGroup.Root
            class="w-full"
            onValueChange={(next) => next && setTiming(next as RuleTiming)}
            size="sm"
            type="single"
            value={draft.timing}
            variant="outline"
          >
            {#each TIMING as option (option.value)}
              <ToggleGroup.Item
                class="flex-1 text-caption"
                value={option.value}
              >
                {option.label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
          <span class="max-w-prose text-micro text-muted-foreground"
            >{how}</span
          >
        </fieldset>

        {#if draft.timing === 'immediate'}
          <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> component; the native control it renders is not visible to Biome -->
          <label class="flex items-start gap-3">
            <Switch class="mt-0.5" bind:checked={draft.interrupt} />
            <span class="flex flex-col gap-0.5">
              <span class="text-caption">Interrupt the running turn</span>
              <span class="max-w-prose text-micro text-muted-foreground">
                A claude session reads it mid-turn without stopping. Other
                harnesses cut the turn short to deliver it, which loses whatever
                they were partway through.
              </span>
            </span>
          </label>
        {/if}
      {:else}
        {#if shown('timing')}
          <span class="text-micro text-destructive">{wrong.timing}</span>
        {/if}
      {/if}
    </section>

    <section
      class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Where it applies</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Everywhere unless you narrow it. Each filter you set has to match for
          the rule to fire.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <NativeSelect> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          Machine
          <NativeSelect
            class="w-full"
            onchange={(event) => narrow('machineId', event.currentTarget.value)}
            value={draft.scope.machineId ?? ''}
          >
            <option value="">Every machine</option>
            {#each whiffle.machines as machine (machine.machineId)}
              <option value={machine.machineId}>{machine.hostname}</option>
            {/each}
          </NativeSelect>
        </label>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <NativeSelect> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          Project
          <NativeSelect
            class="w-full"
            onchange={(event) => narrow('projectId', event.currentTarget.value)}
            value={draft.scope.projectId ?? ''}
          >
            <option value="">Every project</option>
            {#each whiffle.projects as project (project.id)}
              <option value={project.id}>{project.name}</option>
            {/each}
          </NativeSelect>
        </label>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <NativeSelect> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          Harness
          <NativeSelect
            class="w-full"
            onchange={(event) => narrow('harness', event.currentTarget.value)}
            value={draft.scope.harness ?? ''}
          >
            <option value="">Every harness</option>
            {#each HARNESSES as harness (harness)}
              <option value={harness}>{harness}</option>
            {/each}
          </NativeSelect>
        </label>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <NativeSelect> component; the native control it renders is not visible to Biome -->
        <label class="flex flex-col gap-1.5 text-caption">
          Model
          <NativeSelect
            class="w-full"
            onchange={(event) => narrow('model', event.currentTarget.value)}
            value={draft.scope.model ?? ''}
          >
            <option value="">Every model</option>
            {#each models as model (model)}
              <option value={model}>{model}</option>
            {/each}
            {#if draft.scope.model && !models.includes(draft.scope.model)}
              <option value={draft.scope.model}>{draft.scope.model}</option>
            {/if}
          </NativeSelect>
          <span class="text-micro text-muted-foreground">
            Matched as a substring, so a family name covers every dated build of
            it.
          </span>
        </label>
      </div>
    </section>

    {#if draft.action === 'reply'}
      <section
        class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md"
      >
        <div class="flex flex-col gap-1">
          <h2 class="text-body font-medium">Making it stick</h2>
          <p class="max-w-prose text-micro text-muted-foreground">
            A note a session can read and walk past is a note a session will
            read and walk past.
          </p>
        </div>

        <!-- biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Switch> component; the native control it renders is not visible to Biome -->
        <label class="flex items-start gap-3">
          <Switch class="mt-0.5" bind:checked={draft.requireAck} />
          <span class="flex flex-col gap-0.5">
            <span class="text-caption"
              >Keep firing until the session acknowledges</span
            >
            <span class="max-w-prose text-micro text-muted-foreground">
              {#if draft.requireAck}
                The session has to call
                <span class="font-mono">acknowledge_rule</span>
                and say what it did about it. Until then the rule fires again
                every time it is tripped, and the reminder counts up. It stops
                after ten in one session.
              {:else}
                The rule fires once per session and then goes quiet, whether or
                not anything came of it.
              {/if}
            </span>
          </span>
        </label>
      </section>
    {/if}

    <!-- Only a saved rule has a history; a draft has caught nothing by definition. -->
    {#if id}
      <RuleActivity ruleId={id} />
    {/if}

    {#if failed}
      <p class="text-caption text-destructive" role="alert">{failed}</p>
    {/if}

    <!-- Pinned: on a long rule the Save used to scroll off, so the reader edited
         with no way to commit in view. It rides the foot of the viewport now. -->
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
          {deleting ? 'Deleting…' : 'Delete rule'}
        </Button>
      {:else}
        <span></span>
      {/if}
      <div class="flex items-center gap-2">
        <Button
          disabled={busy}
          onclick={() => goto('/rules')}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={busy || deleting} type="submit">
          {saveLabel}
        </Button>
      </div>
    </div>
  </form>
</div>

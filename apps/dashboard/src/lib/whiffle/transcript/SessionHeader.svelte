<script lang="ts" module>
  /**
   * What one settings change reports back.
   *
   * A change that the hub can acknowledge is a tracked COMMAND, and its id is
   * how this bar reads its stages. The one exception is bypassPermissions,
   * which the SDK refuses to switch into: that mode relaunches the session
   * instead, which is a different operation on the wire and not a command — so
   * it hands back its own promise and the row draws the same flight from that.
   * `null` is "nothing was submitted at all", and the row never moves.
   */
  export type SettingChange = string | Promise<unknown> | null;
</script>

<script lang="ts">
  /**
   * The run's fixed identity bar, as ONE line (the mock's `.shead`): the
   * session's mark, its title and `machine : path` on a single baseline, the
   * state pill, the Chat / Flow switch, and everything that can be *changed*
   * about the session behind a single "Session settings" disclosure.
   *
   * There is no Back control. Fleet is the first tab in the strip above this
   * bar, so a second way out would be two affordances for one destination —
   * and it was the one element in this row that was not the session's identity.
   *
   * Model, permission mode and effort are never inline. Three pickers of three
   * different natural heights is what made this bar read as a toolbar rather
   * than a title; behind one disclosure they are one control, and the bar keeps
   * one height for every interactive element in it. Desktop opens it as a
   * popover, a phone as a bottom sheet — the same panel either way.
   */
  import type { EffortLevel, PermissionMode } from "@whiffle/core";
  import { TextMorph } from "torph/svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Drawer from "$lib/components/ui/drawer";
  import * as Popover from "$lib/components/ui/popover";
  import * as Select from "$lib/components/ui/select";
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import { IsMobile } from "$lib/hooks/is-mobile.svelte";
  import { IconChat, IconFlow, IconSettings, IconUnfold } from "$lib/icons";
  import type { Activity } from "../activity";
  import type { CommandRecord, CommandStage } from "../client.svelte";
  import EffortSlider from "../EffortSlider.svelte";
  import { type EffortStop, effortLabel } from "../effort-levels";
  import HarnessGlyph from "../HarnessGlyph.svelte";
  import ModelCombobox from "../ModelCombobox.svelte";
  import { markHue } from "../mark";
  import { modelLabel } from "../models.svelte";
  import {
    type PermissionModeOption,
    permissionModeLabel,
  } from "../permission-modes";

  let {
    title,
    seed,
    harness,
    machineName,
    cwd,
    activity,
    model,
    permissionMode,
    effort,
    mcpCount,
    turns,
    totalTokens,
    maxTokens,
    cost,
    view,
    onview,
    offeredModes,
    effortStops,
    showEffort,
    harnessEffort,
    onmodel,
    onpermission,
    oneffort,
    trackedCommand,
    streaming,
  }: {
    title: string;
    /** What the identity HUE is keyed to — the project, so a repo reads as one. */
    seed: string;
    harness: string;
    machineName: string;
    cwd: string;
    activity: Activity;
    model: string | null;
    permissionMode: PermissionMode | null;
    effort: EffortLevel | null;
    mcpCount: number | null;
    turns: number | null;
    totalTokens: number | null;
    maxTokens: number | null;
    cost: number | null;
    view: "chat" | "flow";
    onview: (v: "chat" | "flow") => void;
    /** Permission modes this session's harness can honour. */
    offeredModes: PermissionModeOption[];
    /** Every effort stop, each carrying whether this model reaches it. */
    effortStops: EffortStop[];
    /** Whether this harness + model pair has an effort scale worth drawing. */
    showEffort: boolean;
    /** Whether the harness runs at an effort at all — the row is named either way. */
    harnessEffort: boolean;
    onmodel: (model: string) => SettingChange;
    onpermission: (mode: PermissionMode) => SettingChange;
    oneffort: (level: EffortLevel) => SettingChange;
    /** One submitted command's record, by the id its callback handed back. */
    trackedCommand: (commandId: string) => CommandRecord | null;
    /**
     * Whether commands on this connection are hub-sequenced. It is the one
     * thing that tells `accepted` apart: against a stream hub it means "taken,
     * still being applied", and against a legacy one it is the last word the
     * call will ever have — a row that waited on it there would recede for good.
     */
    streaming: boolean;
  } = $props();

  const k = (n: number): string => `${Math.round(n / 1000)}k`;

  /**
   * Changing a setting is a request to a machine at the other end of a tailnet,
   * not a local toggle: it takes time and it can be refused. Each of the three
   * controls carries its own flight, so a slow model change never greys the
   * permission row beside it, and a second submission while one is still out is
   * dropped rather than raced. Nothing here invents a value — the control still
   * shows the prop, and only the *attempt* is drawn.
   *
   * What a row knows about its flight is the command tracker's, not this
   * component's: the callback hands back the id of the command it submitted and
   * every state below is read off that record's stage. A row therefore holds
   * only the id of ITS OWN latest attempt — never "the newest command of this
   * kind" — so an ack that arrives for the attempt the reader has already
   * replaced lands on a record nothing is reading.
   */
  type Slot = "model" | "permission" | "effort";
  const SLOTS: Slot[] = ["model", "permission", "effort"];
  const per = <T>(value: T): Record<Slot, T> =>
    Object.fromEntries(SLOTS.map((slot) => [slot, value])) as Record<Slot, T>;

  /** The round trip that beat the eye is no round trip at all — say nothing under it. */
  const SETTLE = 150;
  const REFUSED = "Didn't land — try again.";

  /** One row's last attempt — the only thing a row knows about its own flight. */
  interface Attempt {
    /** The tracked command it is waiting on, when the change was a command. */
    commandId: string | null;
    /** Still out on the untracked (relaunch) path. */
    local: boolean;
    /**
     * What it was refused with, in the row's own words, from whichever path
     * carried it. Written down rather than re-read, because the tracker prunes
     * a settled record and a refusal on screen must not go with it.
     */
    refused: string | null;
    /** Whether the hub will say more than "taken" about this one. */
    sequenced: boolean;
    /** Past the anti-flash window — the one thing that lets pending be drawn. */
    settled: boolean;
    /** What was asked for — on the sequenced path, the prop matching it is the answer. */
    value: unknown;
  }

  let attempt = $state(per<Attempt | null>(null));

  /**
   * Which attempt a row is on. Held outside `$state` on purpose: it is not
   * drawn, it is what a late timer or a late promise checks itself against, so
   * that a reply to a superseded attempt cannot write over the current one.
   */
  const counter = per(0);

  /** What the session says is actually in force for a row, right now. */
  function inForce(slot: Slot): unknown {
    if (slot === "model") {
      return model;
    }
    if (slot === "permission") {
      return permissionMode;
    }
    return effort;
  }

  function stageOf(slot: Slot): CommandStage | null {
    const id = attempt[slot]?.commandId;
    return id ? (trackedCommand(id)?.stage ?? null) : null;
  }

  /**
   * Whether a row's last attempt is still out — the one-in-flight guard, and
   * what `aria-busy` says.
   */
  function out(slot: Slot): boolean {
    const flight = attempt[slot];
    if (!flight) {
      return false;
    }
    // The value came back, so the row has its answer whatever the tracker still
    // has to say — but only where the value moves when the MACHINE says so.
    // Today's calls write it the instant they are asked and put it back if the
    // switch is refused, so on that path a matching prop is the reader's own
    // click coming back and says nothing about where the change got to.
    if (flight.sequenced && inForce(slot) === flight.value) {
      return false;
    }
    if (flight.local) {
      return true;
    }
    const stage = stageOf(slot);
    // No record left (swept) is not a flight: a row must never wait on
    // something nothing will ever answer.
    if (stage === null) {
      return false;
    }
    if (stage === "submitted") {
      return true;
    }
    return stage === "accepted" && flight.sequenced;
  }

  const refusal = (reason: string | undefined): string =>
    reason ? `${REFUSED} ${reason}` : REFUSED;

  /** What a row's last attempt was refused with, in the row's own words. */
  function failure(slot: Slot): string | null {
    const flight = attempt[slot];
    if (!flight) {
      return null;
    }
    if (flight.refused) {
      return flight.refused;
    }
    const record = flight.commandId ? trackedCommand(flight.commandId) : null;
    return record?.stage === "failed" ? refusal(record.reason) : null;
  }

  /**
   * A refusal is the row's to keep. The tracker holds a settled command for a
   * few minutes and then drops it, so a row that only ever re-read the record
   * would lose the words off the screen while the reader was still looking at
   * them — this copies them down, once, the moment they exist.
   */
  $effect(() => {
    for (const slot of SLOTS) {
      const flight = attempt[slot];
      if (!flight || flight.refused || !flight.commandId) {
        continue;
      }
      const record = trackedCommand(flight.commandId);
      if (record?.stage === "failed") {
        flight.refused = refusal(record.reason);
      }
    }
  });

  /** Pending — held back until the round trip has visibly failed to be instant. */
  function pending(slot: Slot): boolean {
    const flight = attempt[slot];
    return !!flight && flight.settled && out(slot) && !failure(slot);
  }

  const thrown = (error: unknown): string =>
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  function apply<T>(
    slot: Slot,
    send: (value: T) => SettingChange,
    value: T
  ): void {
    if (out(slot)) {
      return;
    }
    const token = (counter[slot] += 1);
    /** This row's attempt, or null once a newer one has replaced it. */
    const mine = (): Attempt | null =>
      counter[slot] === token ? attempt[slot] : null;
    attempt[slot] = {
      commandId: null,
      local: false,
      refused: null,
      sequenced: streaming,
      settled: false,
      value,
    };
    const change = send(value);
    if (typeof change === "string") {
      attempt[slot]!.commandId = change;
    } else if (change) {
      attempt[slot]!.local = true;
      void change.then(
        () => {
          const flight = mine();
          if (flight) {
            flight.local = false;
          }
        },
        (error: unknown) => {
          const flight = mine();
          if (!flight) {
            return;
          }
          flight.local = false;
          flight.refused = refusal(thrown(error) || undefined);
        }
      );
    } else {
      // Nothing went out — the row has nothing to report and must not recede.
      attempt[slot] = null;
      return;
    }
    setTimeout(() => {
      const flight = mine();
      if (flight) {
        flight.settled = true;
      }
    }, SETTLE);
  }

  const pill = $derived(
    activity === "blocked"
      ? { status: "attn" as const, label: "needs you" }
      : activity === "working"
        ? { status: "live" as const, label: "working" }
        : { status: "idle" as const, label: "idle" }
  );

  // A single-select toggle can hand back `undefined` when the active item is
  // pressed again; the view always has to be one of the two, so an empty
  // change is dropped rather than applied.
  function pickView(next: string | undefined) {
    if (next === "chat" || next === "flow") {
      onview(next);
    }
  }

  const modelText = $derived(model ? modelLabel(model) : "Model");
  const permissionText = $derived(
    permissionMode ? permissionModeLabel(permissionMode) : "Permissions"
  );
  const effortText = $derived(effort ? effortLabel(effort) : null);
  // Everything the closed disclosure stands in for, in the order the panel
  // stacks it. Effort joins the line only once the session has reported one —
  // a trailing separator with nothing after it is worse than a shorter summary.
  const summary = $derived(
    effortText
      ? `${modelText} · ${permissionText} · ${effortText}`
      : `${modelText} · ${permissionText}`
  );
  const summaryLabel = $derived(
    `Session settings — model ${modelText}, permission ${permissionText}${
      effortText ? `, effort ${effortText}` : ""
    }`
  );

  // The disclosure is one panel with two containers. A phone gets the sheet,
  // because a popover anchored to a 34px trigger on a 390px bar is a popover
  // with nowhere to go; the breakpoint is the same one the bar reshapes at.
  const narrow = new IsMobile(900);
  let open = $state(false);
</script>

<!-- What a row says about its own attempt. Pending is held back until the
     round trip has visibly failed to be instant, so a fast machine never
     flashes; a refusal replaces it, and the next attempt clears it. -->
{#snippet flight(slot: Slot)}
  {@const refused = failure(slot)}
  {#if refused}
    <p class="ctl-fail" role="alert">{refused}</p>
  {:else if pending(slot)}
    <p class="ctl-note" role="status">Applying…</p>
  {/if}
{/snippet}

{#snippet settings()}
  <div aria-busy={out('model')} class="ctl" class:is-pending={pending('model')}>
    <span class="ctl-label" id="sh-model-label">Model</span>
    <ModelCombobox
      class="w-full text-foreground"
      onchoose={(next) => apply('model', onmodel, next)}
      size="sm"
      value={model ?? ''}
    />
    {@render flight('model')}
  </div>

  {#if offeredModes.length > 0}
    <div
      aria-busy={out('permission')}
      class="ctl"
      class:is-pending={pending('permission')}
    >
      <span class="ctl-label" id="sh-perm-label">Permissions</span>
      <Select.Root
        onValueChange={(v) => apply('permission', onpermission, v as PermissionMode)}
        type="single"
        value={permissionMode ?? undefined}
      >
        <Select.Trigger
          aria-labelledby="sh-perm-label"
          class="w-full {permissionMode === 'bypassPermissions'
            ? 'text-[color:var(--status-attn-ink)]'
            : 'text-foreground'}"
          size="sm"
        >
          {permissionText}
        </Select.Trigger>
        <Select.Content>
          {#each offeredModes as mode (mode.value)}
            <Select.Item label={mode.label} value={mode.value}>
              <span class="flex flex-col">
                <!-- "Bypass is on" is one colour wherever it is said: the same
                     token the closed trigger wears, and the same the attention
                     pill wears — not shadcn's separate warning ramp. -->
                <span
                  class={mode.value === 'bypassPermissions'
                    ? 'text-[color:var(--status-attn-ink)]'
                    : ''}
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
      {@render flight('permission')}
    </div>
  {/if}

  {#if showEffort}
    <div
      aria-busy={out('effort')}
      class="ctl"
      class:is-pending={pending('effort')}
    >
      <span class="ctl-label">Reasoning effort</span>
      <EffortSlider
        modelName={model ? modelLabel(model) : undefined}
        onchange={(level) => apply('effort', oneffort, level)}
        stops={effortStops}
        value={effort}
      />
      {@render flight('effort')}
    </div>
  {:else if harnessEffort}
    <!-- The scale belongs to the model, not to us. Naming the control and
         saying why it is not yet drawable beats an absent row, which reads as
         "this harness has no effort" — which is a different, wrong, thing. -->
    <div class="ctl">
      <span class="ctl-label">Reasoning effort</span>
      <p class="ctl-note">
        {model ? `${modelLabel(model)} has not reported its effort scale yet.` : 'Waiting for this session to report its model.'}
      </p>
    </div>
  {/if}

  <!-- A count with somewhere to go: which servers, and what they expose, is the
       tools board's whole job, so the footnote is the way there rather than a
       fact that ends the panel. -->
  {#if mcpCount}
    <a class="ctl-note ctl-foot ctl-link" href="/tools">
      {mcpCount}
      MCP {mcpCount === 1 ? 'server' : 'servers'} connected
    </a>
  {/if}
{/snippet}

<!-- The glance meta and the view switch the narrow bar folds away, shown at the
     top of the sheet so the phone's disclosure is the whole of what the desktop
     bar carries (JOURNEY §Narrow width). -->
{#snippet folded()}
  <div class="sh-folded">
    <div class="sh-meta-row">
      <span>{harness}</span>
      {#if turns !== null}
        <span><b>{turns}</b> turns</span>
      {/if}
      {#if totalTokens !== null && maxTokens}
        <span><b>{k(totalTokens)}</b>/{k(maxTokens)} ctx</span>
      {/if}
      {#if cost !== null}
        <span><b>${cost.toFixed(2)}</b></span>
      {/if}
    </div>
    <ToggleGroup.Root
      aria-label="Transcript view"
      class="view-toggle compact-toggle"
      onValueChange={pickView}
      type="single"
      value={view}
    >
      <ToggleGroup.Item aria-label="Chat view" class="view-item" value="chat">
        <IconChat />
        <span>Chat</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item aria-label="Flow view" class="view-item" value="flow">
        <IconFlow />
        <span>Flow</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>
{/snippet}

<header class="shead">
  <span aria-hidden="true" class="mark m{markHue(seed)}"
    ><HarnessGlyph {harness} /></span
  >
  <h1><TextMorph as="span" duration={120} text={title} /></h1>
  <span class="path"
    ><TextMorph as="span" duration={120} text="{machineName} : {cwd}" /></span
  >
  <span class="pill {pill.status}"
    ><TextMorph as="span" duration={100} text={pill.label} /></span
  >

  <div class="mid">
    <ToggleGroup.Root
      aria-label="Transcript view"
      class="view-toggle inline-toggle"
      onValueChange={pickView}
      type="single"
      value={view}
    >
      <ToggleGroup.Item aria-label="Chat view" class="view-item" value="chat">
        <IconChat />
        <span>Chat</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item aria-label="Flow view" class="view-item" value="flow">
        <IconFlow />
        <span>Flow</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>

    {#if narrow.current}
      <Drawer.Root bind:open>
        <Drawer.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              aria-label={summaryLabel}
              class="settings-trigger {permissionMode === 'bypassPermissions' ? 'is-bypass' : ''}"
              size="sm"
              variant="ghost"
            >
              <IconSettings class="settings-gear" />
              <span class="settings-label">{summary}</span>
              <IconUnfold class="settings-chev" />
            </Button>
          {/snippet}
        </Drawer.Trigger>
        <Drawer.Content
          class="max-h-[85vh] pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <Drawer.Header class="p-0 pb-3 text-left">
            <Drawer.Title class="text-left">Session settings</Drawer.Title>
          </Drawer.Header>
          <div class="min-h-0 overflow-y-auto">
            {@render folded()}
            {@render settings()}
          </div>
        </Drawer.Content>
      </Drawer.Root>
    {:else}
      <Popover.Root bind:open>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              aria-label={summaryLabel}
              class="settings-trigger {permissionMode === 'bypassPermissions' ? 'is-bypass' : ''}"
              size="sm"
              variant="ghost"
            >
              <IconSettings class="settings-gear" />
              <span class="settings-label">{summary}</span>
              <IconUnfold class="settings-chev" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content align="end" class="w-[min(20rem,calc(100vw-2rem))]">
          {@render settings()}
        </Popover.Content>
      </Popover.Root>
    {/if}
  </div>

  <div class="meta">
    <span>{harness}</span>
    {#if turns !== null}
      <span><b>{turns}</b> turns</span>
    {/if}
    {#if totalTokens !== null && maxTokens}
      <span><b>{k(totalTokens)}</b>/{k(maxTokens)}</span>
    {/if}
    {#if cost !== null}
      <span><b>${cost.toFixed(2)}</b></span>
    {/if}
  </div>
</header>

<style>
  .shead {
    /* One row, one height for everything interactive in it: the pill, the view
       switch and the disclosure all sit on --shead-ctl, so the bar has one
       baseline rather than three stacked optical centres. */
    --shead-ctl: 28px;
    height: 57px; /* the mock's fixed identity-bar height; a magic layout value */
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-6) 0 var(--space-7);
    flex-shrink: 0;
  }

  /* What a narrowing group gives up, in the order it can afford to.
     The path goes first — the machine and folder are recoverable from the
     tab and the settings panel. The stats go next; they are a reading, not
     an identity. The title and the state pill are the last things standing,
     because between them they answer "which conversation is this, and does
     it need me" — which is the whole job of this bar. */
  @container leaf (max-width: 620px) {
    .shead {
      padding: 0 var(--space-4);
    }
    .path {
      display: none;
    }
    /* The disclosure keeps its gear and loses its summary: the settings are
       still one press away, and the words naming them are the panel's job
       once there is no room to read them here. */
    .shead :global(.settings-label) {
      display: none;
    }
  }
  @container leaf (max-width: 470px) {
    /* The view switch falls back to its glyphs. Chat and Flow are two
       icons the reader already knows by this point. */
    .shead :global(.view-item span) {
      display: none;
    }
    .shead :global(.meta) {
      display: none;
    }
  }

  /* Identity mark — inlined from the retired whiffle ItemMark so this header
     carries no $lib/whiffle dependency; same tokens, same top-light overlay.
     The glyph is the session's own duotone sprite, so two runs in one repo
     wear the same hue and different faces. */
  .mark {
    width: 17px;
    height: 17px;
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .mark :global(svg) {
    width: 12px;
    height: 12px;
    display: block;
    /* Duotone fills from currentColor and carries its own second tone as
       opacity, so one colour is the whole glyph. */
    color: var(--mark-glyph);
  }
  .mark.m2 {
    background-color: var(--mark-2);
  }
  .mark.m3 {
    background-color: var(--mark-3);
  }
  .mark.m4 {
    background-color: var(--mark-4);
  }
  .mark.m5 {
    background-color: var(--mark-5);
  }
  .mark.m6 {
    background-color: var(--mark-6);
  }
  .mark.m7 {
    background-color: var(--mark-7);
  }
  .mark.m8 {
    background-color: var(--mark-8);
  }

  /* Title and path are siblings on the bar's own baseline rather than a nested
     block, so nothing in the identity can drift off the row's centre line. */
  h1 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    line-height: var(--shead-ctl);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 34ch;
    flex: 0 1 auto;
    min-width: 4ch;
    color: var(--ink-strong);
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--shead-ctl);
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
    min-width: 0;
  }

  /* Status pill — inlined from the retired whiffle StatusPill; idle carries no
     fill, which is the idle state (per DESIGN.md ## Status). */
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--shead-ctl);
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .pill.live {
    background: var(--status-live-bg);
    color: var(--status-live-ink);
  }
  .pill.attn {
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .pill.idle {
    background: var(--status-idle-bg);
    color: var(--status-idle-ink);
    padding: 0 var(--space-1);
    font-weight: var(--weight-medium);
  }

  .mid {
    margin-left: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }

  /* The shadcn toggle-group is a rounded segmented control; these token rules
     seat it in the Quiet Ledger surface ladder (inset field, raised active).
     Global (not scoped under .mid): the view switch appears both inline on the
     desktop bar and inside the sheet, and both must look the same. */
  :global(.view-toggle) {
    height: 28px;
    border: 1px solid var(--border-control);
    background: var(--surface-field);
    /* Concentric: outer radius = inner radius + the 2px inset that seats it. */
    border-radius: var(--radius-control);
    padding: 2px;
    gap: 2px;
  }
  :global(.view-toggle .view-item) {
    height: 100%;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border-radius: calc(var(--radius-control) - 2px);
    color: var(--ink-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  :global(.view-toggle .view-item[data-state="on"]) {
    background: var(--surface-raised);
    color: var(--ink-strong);
    box-shadow: var(--shadow-tile);
    font-weight: var(--weight-strong);
  }
  :global(.view-toggle .view-item:active) {
    transform: scale(0.96);
  }
  :global(.view-toggle .view-item svg) {
    width: 14px;
    height: 14px;
  }
  /* The sheet's view switch stretches full-width in the panel. */
  :global(.compact-toggle) {
    width: 100%;
  }
  :global(.compact-toggle .view-item) {
    flex: 1 1 0;
    justify-content: center;
  }

  /* Quiet inline meta, not a plastered-on outline button: muted ink, no border
     or fill at rest, a hairline surface only on hover — the same register as
     the harness/turns/context meta on the right, and the same height as the
     pill and the switch beside it. */
  .mid :global(.settings-trigger) {
    height: var(--shead-ctl);
    max-width: 100%;
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    box-shadow: none;
    border-radius: var(--radius-control);
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--ink-muted);
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  @media (hover: hover) and (pointer: fine) {
    .mid :global(.settings-trigger:hover) {
      background: var(--surface-hover);
      color: var(--ink-body);
    }
  }
  .mid :global(.settings-trigger:active) {
    transform: scale(0.96);
  }
  .mid :global(.settings-trigger.is-bypass) {
    color: var(--status-attn-ink);
  }
  /* Two icon sizes in this bar, not five: 14px for anything set inline with
     text (this chevron, the view switch's marks) and 17px for an icon standing
     alone (the gear, once the label folds away). The identity mark is a MARK,
     not an icon — its tile and duotone glyph are exempt.

     Optical, not geometric: the chevron's arrowheads leave visual air on the
     right that the box does not, so it is nudged back a hair to sit the same
     distance from the label as the gear does on the other side. */
  .mid :global(.settings-chev) {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.6;
    margin-right: -1px;
  }
  /* The gear stands in for the model·permission label once the label is folded
     away on a phone, so the disclosure is still legible as "session settings". */
  .mid :global(.settings-gear) {
    display: none;
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .settings-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The sheet's head: the glance meta and the view switch the narrow bar folds
     away. Never rendered on desktop, where both are on the bar itself. */
  .sh-folded {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border-hairline);
  }
  .sh-meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .sh-meta-row b {
    font-weight: var(--weight-strong);
    color: var(--ink-body);
    font-variant-numeric: tabular-nums;
  }

  /* One anatomy for all three rows: the row's own label, the control, and
     whatever the row has to say about its last attempt. */
  .ctl {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    transition: opacity var(--c-100) var(--e-in);
  }
  .ctl + .ctl {
    margin-top: var(--space-3);
  }
  /* A change that is still out: the row recedes rather than locking, because
     the value on screen is still the value in force until the machine says
     otherwise. */
  .ctl.is-pending {
    opacity: 0.55;
  }
  .ctl-label {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .ctl-note {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .ctl-fail {
    font-size: var(--text-xs);
    color: var(--status-fail-ink);
  }
  .ctl-foot {
    margin-top: var(--space-3);
  }
  .ctl-link {
    display: block;
    text-decoration: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .ctl-link:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }

  .meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    flex: 0 0 auto;
  }
  .meta b {
    font-weight: var(--weight-strong);
    color: var(--ink-body);
    font-variant-numeric: tabular-nums;
  }

  /* Narrow: still ONE line. Identity shrinks (basis 0, min-width 0) so the title
     ellipsizes; machine:path is desktop chrome the tab strip already implies, so
     it is dropped, and the view switch, the glance meta and the three session
     controls all fold into the one disclosure (JOURNEY §Narrow width:
     "collapses to a single summary line with the rest behind a disclosure"). */
  @media (max-width: 900px) {
    .shead {
      height: 52px;
      padding: 0 var(--space-4);
    }
    h1 {
      max-width: none;
      flex: 1 1 0;
    }
    .path {
      display: none;
    }
    .mid {
      margin-left: 0;
      flex: 0 0 auto;
    }
    .mid :global(.inline-toggle) {
      display: none;
    }
    .mid :global(.settings-trigger) {
      padding: 0 var(--space-1);
    }
    .mid :global(.settings-gear) {
      display: block;
    }
    .settings-label,
    .mid :global(.settings-chev) {
      display: none;
    }
    .meta {
      display: none;
    }
  }

  /* Coarse pointers get the platform's 44px floor on every affordance. */
  /* Coarse pointers get the platform's 44px floor — and they get it on the ROW,
     not on one control inside it, so the bar keeps its one height. Raising only
     the toggle's items would have overflowed the 28px group holding them. */
  @media (pointer: coarse) {
    .shead {
      --shead-ctl: 44px;
      height: 64px;
    }
    .mid :global(.view-toggle) {
      height: var(--shead-ctl);
    }
    .mid :global(.settings-trigger) {
      min-width: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mid :global(.settings-trigger),
    :global(.view-toggle .view-item) {
      transition: none;
    }
    .mid :global(.settings-trigger:active),
    :global(.view-toggle .view-item:active) {
      transform: none;
    }
  }
</style>

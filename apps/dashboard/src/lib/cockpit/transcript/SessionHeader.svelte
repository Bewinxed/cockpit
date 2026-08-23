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
  import type { EffortLevel, PermissionMode } from '@cockpit/core';
  import { markHue } from '../mark';
  import HarnessGlyph from '../HarnessGlyph.svelte';
  import type { Activity } from '../activity';
  import { modelLabel } from '../models.svelte';
  import { permissionModeLabel, type PermissionModeOption } from '../permission-modes';
  import type { EffortStop } from '../effort-levels';
  import ModelCombobox from '../ModelCombobox.svelte';
  import EffortSlider from '../EffortSlider.svelte';
  import { IconChat, IconFlow, IconSettings, IconUnfold } from '$lib/icons';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import * as Popover from '$lib/components/ui/popover';
  import * as Drawer from '$lib/components/ui/drawer';
  import * as Select from '$lib/components/ui/select';

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
  }: {
    title: string;
    /** What the identity HUE is keyed to — the project, so a repo reads as one. */
    seed: string;
    /** What the SPRITE is keyed to — the session, so two runs in a repo differ. */
    spriteSeed: string;
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
    view: 'chat' | 'flow';
    onview: (v: 'chat' | 'flow') => void;
    /** Permission modes this session's harness can honour. */
    offeredModes: PermissionModeOption[];
    /** Every effort stop, each carrying whether this model reaches it. */
    effortStops: EffortStop[];
    /** Whether this harness + model pair has an effort scale worth drawing. */
    showEffort: boolean;
    /** Whether the harness runs at an effort at all — the row is named either way. */
    harnessEffort: boolean;
    onmodel: (model: string) => void | Promise<void>;
    onpermission: (mode: PermissionMode) => void | Promise<void>;
    oneffort: (level: EffortLevel) => void | Promise<void>;
  } = $props();

  const k = (n: number): string => `${Math.round(n / 1000)}k`;


  const pill = $derived(
    activity === 'blocked'
      ? { status: 'attn' as const, label: 'needs you' }
      : activity === 'working'
        ? { status: 'live' as const, label: 'working' }
        : { status: 'idle' as const, label: 'idle' }
  );

  // A single-select toggle can hand back `undefined` when the active item is
  // pressed again; the view always has to be one of the two, so an empty
  // change is dropped rather than applied.
  function pickView(next: string | undefined) {
    if (next === 'chat' || next === 'flow') onview(next);
  }

  const modelText = $derived(model ? modelLabel(model) : 'Model');
  const permissionText = $derived(permissionMode ? permissionModeLabel(permissionMode) : 'Permissions');

  // The disclosure is one panel with two containers. A phone gets the sheet,
  // because a popover anchored to a 34px trigger on a 390px bar is a popover
  // with nowhere to go; the breakpoint is the same one the bar reshapes at.
  const narrow = new IsMobile(900);
  let open = $state(false);
</script>

{#snippet settings()}
  <div class="ctl">
    <span class="ctl-label" id="sh-model-label">Model</span>
    <ModelCombobox value={model ?? ''} onchoose={onmodel} size="sm" class="w-full text-foreground" />
  </div>

  {#if offeredModes.length > 0}
    <div class="ctl">
      <span class="ctl-label" id="sh-perm-label">Permissions</span>
      <Select.Root
        type="single"
        value={permissionMode ?? undefined}
        onValueChange={(v) => onpermission(v as PermissionMode)}
      >
        <Select.Trigger
          aria-labelledby="sh-perm-label"
          size="sm"
          class="w-full {permissionMode === 'bypassPermissions' ? 'text-warning' : 'text-foreground'}"
        >
          {permissionText}
        </Select.Trigger>
        <Select.Content>
          {#each offeredModes as mode (mode.value)}
            <Select.Item value={mode.value} label={mode.label}>
              <span class="flex flex-col">
                <span class={mode.value === 'bypassPermissions' ? 'text-warning' : ''}>
                  {mode.label}
                </span>
                <span class="text-micro text-muted-foreground">{mode.description}</span>
              </span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/if}

  {#if showEffort}
    <div class="ctl">
      <EffortSlider
        stops={effortStops}
        value={effort}
        modelName={model ? modelLabel(model) : undefined}
        onchange={oneffort}
      />
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

  {#if mcpCount}
    <p class="ctl-note ctl-foot">{mcpCount} MCP {mcpCount === 1 ? 'server' : 'servers'} connected</p>
  {/if}
{/snippet}

<!-- The glance meta and the view switch the narrow bar folds away, shown at the
     top of the sheet so the phone's disclosure is the whole of what the desktop
     bar carries (JOURNEY §Narrow width). -->
{#snippet folded()}
  <div class="sh-folded">
    <div class="sh-meta-row">
      <span>{harness}</span>
      {#if turns !== null}<span><b>{turns}</b> turns</span>{/if}
      {#if totalTokens !== null && maxTokens}<span><b>{k(totalTokens)}</b>/{k(maxTokens)} ctx</span>{/if}
      {#if cost !== null}<span><b>${cost.toFixed(2)}</b></span>{/if}
    </div>
    <ToggleGroup.Root
      type="single"
      value={view}
      onValueChange={pickView}
      aria-label="Transcript view"
      class="view-toggle compact-toggle"
    >
      <ToggleGroup.Item value="chat" aria-label="Chat view" class="view-item">
        <IconChat />
        <span>Chat</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="flow" aria-label="Flow view" class="view-item">
        <IconFlow />
        <span>Flow</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>
{/snippet}

<header class="shead">
  <span class="mark m{markHue(seed)}" aria-hidden="true"><HarnessGlyph {harness} /></span>
  <h1>{title}</h1>
  <span class="path">{machineName} : {cwd}</span>
  <span class="pill {pill.status}">{pill.label}</span>

  <div class="mid">
    <ToggleGroup.Root
      type="single"
      value={view}
      onValueChange={pickView}
      aria-label="Transcript view"
      class="view-toggle inline-toggle"
    >
      <ToggleGroup.Item value="chat" aria-label="Chat view" class="view-item">
        <IconChat />
        <span>Chat</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="flow" aria-label="Flow view" class="view-item">
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
              variant="ghost"
              size="sm"
              class="settings-trigger {permissionMode === 'bypassPermissions' ? 'is-bypass' : ''}"
              aria-label="Session settings — model {modelText}, permission {permissionText}"
            >
              <IconSettings class="settings-gear" />
              <span class="settings-label">{modelText} · {permissionText}</span>
              <IconUnfold class="settings-chev" />
            </Button>
          {/snippet}
        </Drawer.Trigger>
        <Drawer.Content class="max-h-[85vh] pb-[calc(1rem+env(safe-area-inset-bottom))]">
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
              variant="ghost"
              size="sm"
              class="settings-trigger {permissionMode === 'bypassPermissions' ? 'is-bypass' : ''}"
              aria-label="Session settings — model {modelText}, permission {permissionText}"
            >
              <IconSettings class="settings-gear" />
              <span class="settings-label">{modelText} · {permissionText}</span>
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
    {#if turns !== null}<span><b>{turns}</b> turns</span>{/if}
    {#if totalTokens !== null && maxTokens}<span><b>{k(totalTokens)}</b>/{k(maxTokens)}</span>{/if}
    {#if cost !== null}<span><b>${cost.toFixed(2)}</b></span>{/if}
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

  /* Identity mark — inlined from the retired outpost ItemMark so this header
     carries no $lib/outpost dependency; same tokens, same top-light overlay.
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
  .mark.m2 { background-color: var(--mark-2); }
  .mark.m3 { background-color: var(--mark-3); }
  .mark.m4 { background-color: var(--mark-4); }
  .mark.m5 { background-color: var(--mark-5); }
  .mark.m6 { background-color: var(--mark-6); }
  .mark.m7 { background-color: var(--mark-7); }
  .mark.m8 { background-color: var(--mark-8); }

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

  /* Status pill — inlined from the retired outpost StatusPill; idle carries no
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
  .pill.live { background: var(--status-live-bg); color: var(--status-live-ink); }
  .pill.attn { background: var(--status-attn-bg); color: var(--status-attn-ink); }
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
  :global(.view-toggle .view-item[data-state='on']) {
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
  /* Optical, not geometric: the chevron's arrowheads leave visual air on the
     right that the box does not, so it is nudged back a hair to sit the same
     distance from the label as the gear does on the other side. */
  .mid :global(.settings-chev) {
    width: 13px;
    height: 13px;
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

  .ctl {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .ctl + .ctl {
    margin-top: var(--space-3);
  }
  .ctl-label {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .ctl-note {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .ctl-foot {
    margin-top: var(--space-3);
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

<script lang="ts">
  /**
   * The run's fixed identity bar: back + mark + title + `machine : path` and a
   * state pill on the left; the Chat / Flow toggle and the session controls
   * (model · permission mode · effort) in the middle; harness · turns · context%
   * on the right. Ported from the mock's `.shead`.
   *
   * The controls are reachable on a phone: the Chat/Flow switch is a shadcn
   * toggle-group, and model / permission / effort live behind one "Session
   * settings" popover so a 390px header never has to fit three inline pickers.
   * Every switch calls the same store setters the spawn form uses, so a change
   * made here is the session's new word on all three.
   */
  import type { EffortLevel, PermissionMode } from '@cockpit/core';
  import { harnessGlyphPath, markHue } from '../mark';
  import type { Activity } from '../activity';
  import { modelLabel } from '../models.svelte';
  import { permissionModeLabel, type PermissionModeOption } from '../permission-modes';
  import type { EffortStop } from '../effort-levels';
  import ModelCombobox from '../ModelCombobox.svelte';
  import EffortSlider from '../EffortSlider.svelte';
  import { IconChevronRight, IconChat, IconFlow, IconSettings, IconUnfold } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';

  let {
    title,
    harness,
    seed,
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
    onmodel,
    onpermission,
    oneffort,
  }: {
    title: string;
    harness: string;
    seed: string;
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
</script>

<header class="shead">
  <a class="back" href="/session" aria-label="Back to fleet board"><IconChevronRight /></a>
  <span class="mark m{markHue(seed)}" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d={harnessGlyphPath(harness)} />
    </svg>
  </span>
  <div class="id">
    <h1>{title}</h1>
    <span class="path">{machineName} : {cwd}</span>
  </div>

  {#if pill.status !== 'idle'}
    <span class="pill {pill.status}">{pill.label}</span>
  {:else}
    <span class="pill idle">idle</span>
  {/if}

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

    <Popover.Root>
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
      <Popover.Content align="end" class="w-[min(20rem,calc(100vw-2rem))] settings-panel">
        <!-- The rows the collapsed mobile line folds away: what the run reads
             at a glance (harness · turns · context · cost) and the view switch.
             Desktop keeps these inline in the bar, so this block is mobile-only. -->
        <div class="sh-compact">
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
        <div class="ctl">
          <span class="ctl-label" id="sh-model-label">Model</span>
          <ModelCombobox
            value={model ?? ''}
            onchoose={onmodel}
            size="sm"
            class="w-full text-foreground"
          />
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
        {/if}

        {#if mcpCount}
          <p class="ctl-note">{mcpCount} MCP {mcpCount === 1 ? 'server' : 'servers'} connected</p>
        {/if}
      </Popover.Content>
    </Popover.Root>
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
    height: 57px; /* the mock's fixed identity-bar height; a magic layout value */
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-6) 0 var(--space-7);
    flex-shrink: 0;
  }
  .back {
    width: 34px;
    height: 34px;
    border: 1px solid var(--border-control);
    background: var(--surface-raised);
    border-radius: var(--radius-control);
    display: grid;
    place-items: center;
    color: var(--ink-body);
    flex: 0 0 auto;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
    transform: rotate(180deg);
  }
  @media (hover: hover) and (pointer: fine) {
    .back:hover {
      background: var(--surface-hover);
    }
  }
  .back:active {
    background: var(--surface-active);
  }
  .back:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* Identity mark — inlined from the retired outpost ItemMark so this header
     carries no $lib/outpost dependency; same tokens, same top-light overlay. */
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
    width: 10px;
    height: 10px;
    display: block;
    stroke: var(--mark-glyph);
    stroke-width: 1.6;
  }
  .mark.m2 { background-color: var(--mark-2); }
  .mark.m3 { background-color: var(--mark-3); }
  .mark.m4 { background-color: var(--mark-4); }
  .mark.m5 { background-color: var(--mark-5); }
  .mark.m6 { background-color: var(--mark-6); }
  .mark.m7 { background-color: var(--mark-7); }
  .mark.m8 { background-color: var(--mark-8); }

  /* Title + path as one identity block: inline on desktop, stacked on mobile
     so the whole identity claims a single row instead of three. */
  .id {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    flex: 0 1 auto;
  }
  h1 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 30ch;
    color: var(--ink-strong);
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Status pill — inlined from the retired outpost StatusPill; idle carries no
     fill, which is the idle state (per DESIGN.md ## Status). */
  .pill {
    display: inline-flex;
    align-items: center;
    height: 22px;
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
    padding: 0;
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
     seat it in the Quiet Ledger surface ladder (inset field, raised active). */
  /* Global (not scoped under .mid): the view switch appears both inline on the
     desktop bar and inside the mobile disclosure, and both must look the same. */
  :global(.view-toggle) {
    border: 1px solid var(--border-control);
    background: var(--surface-field);
    border-radius: var(--radius-control);
    padding: 2px;
    gap: 2px;
  }
  :global(.view-toggle .view-item) {
    height: 26px;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border-radius: calc(var(--radius-control) - 2px);
    color: var(--ink-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  :global(.view-toggle .view-item[data-state='on']) {
    background: var(--surface-raised);
    color: var(--ink-strong);
    box-shadow: var(--shadow-tile);
    font-weight: var(--weight-strong);
  }
  :global(.view-toggle .view-item svg) {
    width: 14px;
    height: 14px;
  }
  /* The mobile disclosure's view switch stretches full-width in the panel. */
  :global(.compact-toggle) {
    width: 100%;
  }
  :global(.compact-toggle .view-item) {
    flex: 1 1 0;
    justify-content: center;
  }
  /* Quiet inline meta, not a plastered-on outline button: muted ink, no border
     or fill at rest, a hairline surface only on hover — the same register as
     the harness/turns/context meta on the right. */
  .mid :global(.settings-trigger) {
    height: auto;
    max-width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: transparent;
    box-shadow: none;
    border-radius: var(--radius-control);
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--ink-muted);
  }
  @media (hover: hover) and (pointer: fine) {
    .mid :global(.settings-trigger:hover) {
      background: var(--surface-hover);
      color: var(--ink-body);
    }
  }
  .mid :global(.settings-trigger.is-bypass) {
    color: var(--status-attn-ink);
  }
  .mid :global(.settings-chev) {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    opacity: 0.6;
  }
  /* The gear stands in for the model·permission label once the label is folded
     away on mobile, so the disclosure is still legible as "session settings". */
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

  /* The disclosure's mobile-only head: the glance meta and the view switch that
     the collapsed summary line folds away (JOURNEY §Narrow width). */
  .sh-compact {
    display: none;
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
    margin-top: var(--space-3);
    font-size: var(--text-xs);
    color: var(--ink-muted);
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

  /* Mobile: the bar wraps to its own rows, hugs the edges, and sheds the
     turns/context/cost meta — the same reshape as the mock's narrow header.
     The Chat/Flow toggle and the settings popover stay on the second row, so
     model / permission / effort are all one tap away on a phone. */
  @media (max-width: 900px) {
    .shead {
      height: auto;
      flex-wrap: wrap;
      padding: var(--space-2) var(--space-4);
      row-gap: var(--space-2);
    }
    /* One summary line: back · mark · title · state · disclosure. Identity
       shrinks (basis 0, min-width 0) so the title ellipsizes and everything
       stays on a single row; machine:path is desktop chrome the tab strip
       already implies, so it's dropped here. The view switch, the glance meta,
       and the model/permission/effort controls all fold into the one
       disclosure (JOURNEY §Narrow width: "collapses to a single summary line
       with the rest behind a disclosure"). */
    .id {
      flex: 1 1 0;
      min-width: 0;
    }
    h1 {
      max-width: 100%;
      min-width: 0;
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
      padding: var(--space-1);
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
    .sh-compact {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
      padding-bottom: var(--space-3);
      border-bottom: 1px solid var(--border-hairline);
    }
  }

  /* Coarse pointers get the platform's 44px floor on every affordance. */
  @media (pointer: coarse) {
    .back {
      min-width: 44px;
      min-height: 44px;
    }
    .mid :global(.view-item) {
      min-height: 44px;
    }
    .mid :global(.settings-trigger) {
      min-height: 44px;
    }
  }
</style>

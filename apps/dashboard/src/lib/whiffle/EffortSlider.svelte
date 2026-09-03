<script lang="ts">
  /**
   * The effort scale as one control: five ordered stops, the chosen one named,
   * and the level's own description under it so the choice is made from what
   * the level is *for* rather than from a word on a track.
   *
   * Built rather than wrapped. `ui/slider` is bits-ui's numeric one, and a
   * number line cannot say "this stop exists but this model does not reach it"
   * — it can only be given a shorter range, which is the silent clamp this
   * control exists to avoid. So the scale is always all five: a stop the model
   * cannot reach stays on screen, struck through and out of the thumb's travel,
   * and the track past the last reachable stop is hatched. Moving from a deep
   * model to a shallow one should show `max` leaving the board, not quietly
   * hand back `high`.
   */
  import type { EffortLevel } from "@whiffle/core";
  import type { EffortStop } from "./effort-levels";

  interface EffortSliderProps {
    disabled?: boolean;
    /**
     * Names the control for a reader who arrives at it by keyboard. The VISIBLE
     * label belongs to the parent row (`.ctl-label`), so this control has the
     * same anatomy as the model and permission rows beside it — one label
     * vocabulary for the panel, not one per control.
     */
    label?: string;
    /** Named in the out-of-range line, so a reader knows what to change to reach the rest. */
    modelName?: string;
    onchange: (level: EffortLevel) => void;
    /** Every stop of the scale, each carrying whether this model reaches it. */
    stops: EffortStop[];
    /** The level in force, or `null` when nothing has chosen one yet. */
    value: EffortLevel | null;
  }

  let {
    stops,
    value,
    onchange,
    modelName,
    disabled = false,
    label = "Reasoning effort",
  }: EffortSliderProps = $props();

  let track = $state<HTMLDivElement | null>(null);

  const index = $derived(stops.findIndex((stop) => stop.value === value));
  const reachable = $derived(stops.filter((stop) => stop.reachable));
  const unreachable = $derived(stops.filter((stop) => !stop.reachable));
  /** Where the hatching starts: the first stop the model cannot be run at. */
  const ceiling = $derived(stops.findIndex((stop) => !stop.reachable));

  const at = (position: number) =>
    stops.length < 2 ? 0 : (position / (stops.length - 1)) * 100;
  /** A scale nothing has chosen on yet is drawn empty rather than filled to a guess. */
  const fill = $derived(index < 0 ? 0 : at(index));

  const selected = $derived(index < 0 ? null : stops[index]);

  /** `low, medium and max` — a list a sentence can hold. */
  const listed = (names: string[]): string =>
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

  function choose(stop: EffortStop | undefined) {
    if (disabled || !stop?.reachable || stop.value === value) {
      return;
    }
    onchange(stop.value);
  }

  /** The reachable stop nearest a fraction of the track, so a drag lands somewhere real. */
  function nearest(fraction: number): EffortStop | undefined {
    const wanted = fraction * (stops.length - 1);
    let closest: EffortStop | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const [position, stop] of stops.entries()) {
      if (!stop.reachable) {
        continue;
      }
      const gap = Math.abs(position - wanted);
      if (gap < distance) {
        distance = gap;
        closest = stop;
      }
    }
    return closest;
  }

  function point(event: PointerEvent) {
    const box = track?.getBoundingClientRect();
    if (!box || box.width === 0) {
      return;
    }
    choose(
      nearest(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)))
    );
  }

  function grab(event: PointerEvent) {
    if (disabled) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    point(event);
  }

  function drag(event: PointerEvent) {
    // `buttons` rather than a flag of our own: a pointer released outside the
    // window never sends the up event, and a stale flag would keep dragging.
    if (event.buttons === 0) {
      return;
    }
    point(event);
  }

  /** Steps over what the model cannot reach, so the keyboard never lands out of range. */
  function step(direction: 1 | -1) {
    let from: number;
    if (index < 0) {
      from = direction === 1 ? -1 : stops.length;
    } else {
      from = index;
    }
    for (
      let next = from + direction;
      next >= 0 && next < stops.length;
      next += direction
    ) {
      if (stops[next].reachable) {
        return choose(stops[next]);
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) {
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowUp: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowDown: () => step(-1),
      Home: () => choose(reachable[0]),
      End: () => choose(reachable.at(-1)),
    };
    const move = keys[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    move();
  }

  /** Past the chosen stop, ahead of it, or off the reachable scale entirely. */
  function stopClass(stop: EffortStop, position: number): string {
    if (!stop.reachable) {
      return "is-blocked";
    }
    return position <= index ? "is-past" : "is-ahead";
  }

  /** Off the reachable scale, the chosen stop, or neither. */
  function markClass(stop: EffortStop): string {
    if (!stop.reachable) {
      return "is-blocked";
    }
    return stop.value === value ? "is-on" : "";
  }
</script>

<div class="effort">
  <span class="effort-value">
    {selected?.label ?? '—'}
    {#if selected?.apiDefault}
      <span class="effort-default">default</span>
    {/if}
  </span>

  <!-- The rail is the hit area, the track is the drawing. On a coarse pointer
       the rail grows to the platform's 44px floor while the track stays 6px, so
       a thumb has something to land on without the control getting fatter. -->
  <div
    aria-disabled={disabled}
    aria-label={label}
    aria-valuemax={stops.length - 1}
    aria-valuemin={0}
    aria-valuenow={index < 0 ? undefined : index}
    aria-valuetext={selected ? `${selected.label} — ${selected.description}` : 'not chosen'}
    class="effort-rail"
    onkeydown={handleKeydown}
    onpointerdown={grab}
    onpointermove={drag}
    role="slider"
    tabindex={disabled ? -1 : 0}
    class:is-disabled={disabled}
  >
    <div class="effort-track" bind:this={track}>
      {#if ceiling >= 0}
        <!-- Everything past the last reachable stop, hatched: the scale is still
             there, this model just cannot be run on it. -->
        <div class="effort-hatch" style="left: {at(ceiling)}%;"></div>
      {/if}

      <div class="effort-fill" style="width: {fill}%;"></div>

      {#each stops as stop, position (stop.value)}
        <span
          class="effort-stop {stopClass(stop, position)}"
          style="left: {at(position)}%;"
        ></span>
      {/each}

      {#if index >= 0}
        <span class="effort-thumb" style="left: {fill}%;"></span>
      {/if}
    </div>
  </div>

  <div class="effort-marks">
    {#each stops as stop (stop.value)}
      <button
        class="effort-mark {markClass(stop)}"
        disabled={disabled || !stop.reachable}
        onclick={() => choose(stop)}
        title={stop.reachable ? stop.description : `${stop.label} is not offered by this model`}
        type="button"
      >
        {stop.label}
      </button>
    {/each}
  </div>

  {#if selected}
    <p class="effort-note">{selected.description}</p>
  {/if}

  {#if unreachable.length > 0}
    <p class="effort-note">
      {listed(unreachable.map((stop) => stop.label))}
      {unreachable.length === 1 ? 'is' : 'are'}
      out of range on {modelName ?? 'this model'}.
    </p>
  {/if}
</div>

<style>
  /* One token vocabulary with the panel this sits in: the SessionHeader rows
     speak the --ink, --text and --surface tokens, so this control does too
     rather than carrying a second, shadcn-shaped palette into the same
     popover. */
  .effort {
    /* Everything on the percent scale is centred on a point, so a mark at 0% or
       100% hangs half its own width outside the track. The scale therefore has
       to be inset by half of the WIDEST thing riding it, which is the thumb —
       inset by half a dot instead and the thumb still overhangs by 4px, which is
       exactly the sheet's phantom 4px of horizontal scroll. */
    --effort-dot: 8px;
    --effort-thumb: 16px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The level in force, read as the control's value under the row's label —
     the same slot the Select trigger's text occupies in the rows beside it. */
  .effort-value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    letter-spacing: var(--track-caps);
    color: var(--ink-strong);
  }
  .effort-default {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    letter-spacing: var(--track-caps);
    color: var(--ink-muted);
  }

  .effort-rail {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 24px;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    border-radius: var(--radius-control);
    outline: none;
  }
  .effort-rail:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .effort-rail.is-disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  /* The whole percent scale is inset by half a dot, not just the dots: the
     fill's endpoints, the thumb and the hatched out-of-range region all
     position against this box, so insetting the box keeps them on ONE scale.
     Insetting the dots alone would have slid them off the fill that is supposed
     to end on them. `flex` rather than `width: 100%` so the margins come out of
     the rail's width instead of overflowing it. */
  .effort-track {
    position: relative;
    flex: 1 1 auto;
    margin-inline: calc(var(--effort-thumb) / 2);
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-active);
  }
  .effort-hatch {
    position: absolute;
    inset-block: 0;
    right: 0;
    border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
    background-image: repeating-linear-gradient(
      -45deg,
      var(--ink-muted) 0 1px,
      transparent 1px 5px
    );
    opacity: 0.35;
  }
  .effort-fill {
    position: absolute;
    inset-block: 0;
    left: 0;
    border-radius: var(--radius-pill);
    background: var(--brand-solid);
    /* Spatial movement keeps its own beat; only colour rides --c-100. */
    transition: width 240ms var(--e-in);
  }

  .effort-stop {
    position: absolute;
    top: 50%;
    width: var(--effort-dot);
    height: var(--effort-dot);
    translate: -50% -50%;
    border-radius: var(--radius-pill);
    border: 1px solid transparent;
  }
  .effort-stop.is-past {
    border-color: var(--brand-solid);
    background: var(--brand-solid);
  }
  .effort-stop.is-ahead {
    background: var(--border-control);
  }
  .effort-stop.is-blocked {
    border-style: dashed;
    border-color: color-mix(in oklab, var(--ink-muted) 60%, transparent);
    background: var(--surface-raised);
  }

  .effort-thumb {
    position: absolute;
    top: 50%;
    width: var(--effort-thumb);
    height: var(--effort-thumb);
    translate: -50% -50%;
    border-radius: var(--radius-pill);
    border: 1px solid var(--brand-solid);
    background: var(--surface-raised);
    box-shadow: var(--shadow-tile);
    transition: left 240ms var(--e-in);
  }

  .effort-marks {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
  }
  .effort-mark {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    letter-spacing: var(--track-caps);
    color: var(--ink-muted);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    transition: color var(--c-100) var(--e-in);
  }
  .effort-mark.is-on {
    color: var(--ink-strong);
  }
  .effort-mark.is-blocked {
    cursor: default;
    color: color-mix(in oklab, var(--ink-muted) 40%, transparent);
    text-decoration: line-through;
  }
  @media (hover: hover) and (pointer: fine) {
    .effort-mark:not(.is-blocked):hover {
      color: var(--ink-body);
    }
  }

  .effort-note {
    font-size: var(--text-xs);
    line-height: var(--leading-body);
    color: var(--ink-muted);
  }

  /* Coarse pointers get the 44px floor on both ways of setting a level. The
     rail grows by padding around a track that keeps its 6px; the stop labels
     grow by min-height and pull the extra back with a negative block margin, so
     the row reads as dense as it draws while every target is thumb-sized. */
  @media (pointer: coarse) {
    .effort-rail {
      min-height: 44px;
      padding-block: var(--space-3);
    }
    .effort-marks {
      gap: var(--space-2);
    }
    .effort-mark {
      min-height: 44px;
      padding-inline: var(--space-1);
      margin-inline: calc(var(--space-1) * -1);
      margin-block: calc(var(--space-2) * -1);
    }
    /* The end labels grow inward only. Reaching outward would put their hit
       boxes past the row and hand the sheet a horizontal scrollbar, and it
       would pull the first and last label off the track ends they name. */
    .effort-mark:first-child {
      padding-left: 0;
      margin-left: 0;
    }
    .effort-mark:last-child {
      padding-right: 0;
      margin-right: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .effort-fill,
    .effort-thumb,
    .effort-mark {
      transition: none;
    }
  }
</style>

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
  import type { EffortLevel } from '@cockpit/core';
  import type { EffortStop } from './effort-levels';

  interface EffortSliderProps {
    /** Every stop of the scale, each carrying whether this model reaches it. */
    stops: EffortStop[];
    /** The level in force, or `null` when nothing has chosen one yet. */
    value: EffortLevel | null;
    onchange: (level: EffortLevel) => void;
    /** Named in the out-of-range line, so a reader knows what to change to reach the rest. */
    modelName?: string;
    disabled?: boolean;
    /** Labels the control for a reader who arrives at it by keyboard. */
    label?: string;
  }

  let {
    stops,
    value,
    onchange,
    modelName,
    disabled = false,
    label = 'Reasoning effort',
  }: EffortSliderProps = $props();

  let track = $state<HTMLDivElement | null>(null);

  const index = $derived(stops.findIndex((stop) => stop.value === value));
  const reachable = $derived(stops.filter((stop) => stop.reachable));
  const unreachable = $derived(stops.filter((stop) => !stop.reachable));
  /** Where the hatching starts: the first stop the model cannot be run at. */
  const ceiling = $derived(stops.findIndex((stop) => !stop.reachable));

  const at = (position: number) => (stops.length < 2 ? 0 : (position / (stops.length - 1)) * 100);
  /** A scale nothing has chosen on yet is drawn empty rather than filled to a guess. */
  const fill = $derived(index < 0 ? 0 : at(index));

  const selected = $derived(index < 0 ? null : stops[index]);

  /** `low, medium and max` — a list a sentence can hold. */
  const listed = (names: string[]): string =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  function choose(stop: EffortStop | undefined) {
    if (disabled || !stop?.reachable || stop.value === value) return;
    onchange(stop.value);
  }

  /** The reachable stop nearest a fraction of the track, so a drag lands somewhere real. */
  function nearest(fraction: number): EffortStop | undefined {
    const wanted = fraction * (stops.length - 1);
    let closest: EffortStop | undefined;
    let distance = Infinity;
    for (const [position, stop] of stops.entries()) {
      if (!stop.reachable) continue;
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
    if (!box || box.width === 0) return;
    choose(nearest(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))));
  }

  function grab(event: PointerEvent) {
    if (disabled) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    point(event);
  }

  function drag(event: PointerEvent) {
    // `buttons` rather than a flag of our own: a pointer released outside the
    // window never sends the up event, and a stale flag would keep dragging.
    if (event.buttons === 0) return;
    point(event);
  }

  /** Steps over what the model cannot reach, so the keyboard never lands out of range. */
  function step(direction: 1 | -1) {
    const from = index < 0 ? (direction === 1 ? -1 : stops.length) : index;
    for (let next = from + direction; next >= 0 && next < stops.length; next += direction) {
      if (stops[next].reachable) return choose(stops[next]);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;
    const keys: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowUp: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowDown: () => step(-1),
      Home: () => choose(reachable[0]),
      End: () => choose(reachable[reachable.length - 1]),
    };
    const move = keys[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-baseline justify-between gap-2">
    <span class="text-micro text-muted-foreground">{label}</span>
    <span class="font-mono text-caption text-foreground">
      {selected?.label ?? '—'}
      {#if selected?.apiDefault}
        <span class="font-sans text-micro text-muted-foreground">default</span>
      {/if}
    </span>
  </div>

  <div
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={stops.length - 1}
    aria-valuenow={index < 0 ? undefined : index}
    aria-valuetext={selected ? `${selected.label} — ${selected.description}` : 'not chosen'}
    aria-disabled={disabled}
    class="relative flex h-6 w-full cursor-pointer touch-none items-center rounded-[var(--radius-control)] outline-none select-none
      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring
      {disabled ? 'pointer-events-none opacity-50' : ''}"
    onkeydown={handleKeydown}
    onpointerdown={grab}
    onpointermove={drag}
  >
    <div bind:this={track} class="relative h-1.5 w-full rounded-full bg-muted">
      {#if ceiling >= 0}
        <!-- Everything past the last reachable stop, hatched: the scale is still
             there, this model just cannot be run on it. -->
        <div
          class="absolute inset-y-0 right-0 rounded-r-full"
          style="left: {at(ceiling)}%; background-image: repeating-linear-gradient(-45deg, var(--color-muted-foreground) 0 1px, transparent 1px 5px); opacity: 0.35;"
        ></div>
      {/if}

      <div
        class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-[240ms] ease-[var(--e-in)] motion-reduce:transition-none"
        style="width: {fill}%;"
      ></div>

      {#each stops as stop, position (stop.value)}
        <span
          class="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border
            {stop.reachable
            ? position <= index
              ? 'border-primary bg-primary'
              : 'border-transparent bg-border'
            : 'border-dashed border-muted-foreground/60 bg-background'}"
          style="left: {at(position)}%;"
        ></span>
      {/each}

      {#if index >= 0}
        <span
          class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-background shadow-sm transition-[left] duration-[240ms] ease-[var(--e-in)] motion-reduce:transition-none"
          style="left: {fill}%;"
        ></span>
      {/if}
    </div>
  </div>

  <div class="flex justify-between gap-1">
    {#each stops as stop (stop.value)}
      <button
        type="button"
        disabled={disabled || !stop.reachable}
        title={stop.reachable ? stop.description : `${stop.label} is not offered by this model`}
        class="font-mono text-micro transition-colors duration-[240ms] ease-[var(--e-in)]
          {!stop.reachable
          ? 'cursor-default text-muted-foreground/40 line-through'
          : stop.value === value
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => choose(stop)}
      >
        {stop.label}
      </button>
    {/each}
  </div>

  {#if selected}
    <p class="text-micro text-muted-foreground">{selected.description}</p>
  {/if}

  {#if unreachable.length > 0}
    <p class="text-micro text-faint">
      {listed(unreachable.map((stop) => stop.label))}
      {unreachable.length === 1 ? 'is' : 'are'} out of range on {modelName ?? 'this model'}.
    </p>
  {/if}
</div>

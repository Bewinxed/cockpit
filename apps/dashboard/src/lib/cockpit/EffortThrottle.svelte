<script lang="ts">
  /**
   * The effort scale as it fits on the composer's baseline: a five-rung ramp
   * read the way signal strength is read, with the level named beside it.
   *
   * This is the same scale {@link EffortSlider} draws and the same vocabulary
   * from `effort-levels`; what differs is the room. The slider lives in a 320px
   * panel where five stops, their names and a paragraph all fit at once. Here
   * the control shares a 40px bar with the field, the dictation button and
   * send, and the composer's standing rule for that strip is that ambient state
   * is a glyph on the baseline and never a widget — so the ramp is what shows
   * until someone opens it.
   *
   * The wall is the point in both. A model that cannot reach `max` shows the
   * rung struck out behind a hairline rather than quietly running `high` under
   * the name that was picked.
   */
  import { slide, fade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { EffortLevel } from '@cockpit/core';
  import type { EffortStop } from './effort-levels';

  let {
    /** Every stop of the scale, each carrying whether this model reaches it. */
    stops,
    /** The level in force, or `null` when nothing has asked for one. */
    value,
    onchange,
    disabled = false,
  }: {
    stops: EffortStop[];
    value: EffortLevel | null;
    onchange: (level: EffortLevel) => void;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let dragging = $state(false);
  let trackEl = $state<HTMLElement | null>(null);

  const index = $derived(stops.findIndex((stop) => stop.value === value));
  const current = $derived(index < 0 ? null : stops[index]);
  /* The last rung this model stands on; the wall is drawn just past it. */
  const ceiling = $derived(stops.reduce((last, stop, i) => (stop.reachable ? i : last), 0));
  const capped = $derived(stops.some((stop) => !stop.reachable));

  /* A ramp, not five equal ticks: the rung heights are the whole reason the
     glyph is legible before the label is read. */
  const heightOf = (i: number): number => 4 + i * 2;

  function pick(i: number): void {
    const stop = stops[Math.min(Math.max(i, 0), stops.length - 1)];
    if (!stop || !stop.reachable || stop.value === value) return;
    onchange(stop.value);
  }

  /* Scrubbing resolves to a rung, never between two: the value is one of five
     words, and letting go halfway would misstate what the next turn will run. */
  function scrubTo(clientX: number): void {
    if (!trackEl) return;
    const box = trackEl.getBoundingClientRect();
    pick(Math.round(((clientX - box.left) / box.width) * (stops.length - 1)));
  }

  function onPointerDown(event: PointerEvent): void {
    if (disabled) return;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    scrubTo(event.clientX);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      /* From nothing chosen, a first press starts at the shallowest rung rather
         than jumping to wherever an index of -1 would land. */
      pick(index < 0 ? 0 : index + step);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      pick(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      pick(ceiling);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      open = false;
    }
  }
</script>

<!--
  The panel rides above the field, where the command palette and the attachment
  chips already appear, so disclosure has one direction in this composer rather
  than one per control. The shared `view-transition-name` morphs the collapsed
  ramp into the expanded track where the browser supports it; where it does not,
  the slide is the whole animation and nothing depends on the morph.
-->
{#if open}
  <div
    class="border-b border-border px-3 py-2.5"
    in:slide={{ duration: 250, easing: quintOut }}
    out:slide={{ duration: 180, easing: quintOut }}
  >
    <div class="flex items-baseline gap-2">
      <span class="text-micro text-muted-foreground">Effort</span>
      <span class="text-xs font-medium">{current?.label ?? 'the model’s own'}</span>
      {#if capped}
        <span class="ml-auto text-micro text-faint">
          {stops[ceiling]?.label} is this model’s ceiling
        </span>
      {/if}
    </div>

    <div
      bind:this={trackEl}
      class="track mt-2 flex h-9 cursor-pointer items-end gap-1 rounded-lg
             focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      class:dragging
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label="Reasoning effort"
      aria-valuemin={0}
      aria-valuemax={stops.length - 1}
      aria-valuenow={index < 0 ? 0 : index}
      aria-valuetext={current
        ? `${current.label} — ${current.description}`
        : 'No level asked for; running at the model’s own'}
      aria-disabled={disabled}
      onpointerdown={onPointerDown}
      onpointermove={(event) => dragging && scrubTo(event.clientX)}
      onpointerup={() => (dragging = false)}
      onpointercancel={() => (dragging = false)}
      onkeydown={onKeyDown}
    >
      {#each stops as stop, i (stop.value)}
        <!-- The wall sits between the last reachable rung and the first one
             past it, so the reader sees where the model stops rather than
             finding out when a choice quietly does nothing. -->
        {#if capped && i === ceiling + 1}
          <span class="ceiling self-stretch" aria-hidden="true"></span>
        {/if}
        <span
          class="rung flex-1 rounded-sm"
          class:lit={stop.reachable && index >= 0 && i <= index}
          class:beyond={!stop.reachable}
          style:--h="{heightOf(i)}px"
          style:--i={i}
          title={stop.reachable ? stop.description : `${stop.label} — not on this model`}
        ></span>
      {/each}
    </div>

    <div class="mt-2 flex min-h-8 items-start">
      {#key current?.value ?? 'none'}
        <p class="text-micro leading-snug text-muted-foreground" in:fade={{ duration: 160 }}>
          {current?.description ??
            'Nothing has asked for a level, so the session runs at whatever its model does by default.'}
        </p>
      {/key}
    </div>
  </div>
{/if}

<button
  type="button"
  {disabled}
  class="throttle pressable flex items-center gap-1.5 rounded-md px-1.5 py-1
         text-micro text-muted-foreground transition-colors duration-150 ease-expo
         hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring
         focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
  aria-expanded={open}
  aria-label="Reasoning effort: {current?.label ?? 'the model’s own'}"
  title={current
    ? `Reasoning effort — ${current.label}`
    : 'No effort level has been asked for — this session runs at its model’s own'}
  onclick={() => (open = !open)}
>
  <span class="glyph flex h-3.5 items-end gap-px" aria-hidden="true">
    {#each stops as stop, i (stop.value)}
      <span
        class="rung w-0.5 rounded-[1px]"
        class:lit={stop.reachable && index >= 0 && i <= index}
        class:beyond={!stop.reachable}
        style:--h="{heightOf(i)}px"
        style:--i={i}
      ></span>
    {/each}
  </span>
  <span>{current?.label ?? '—'}</span>
</button>

<style>
  /* One name shared by the glyph and the track: where View Transitions are
     supported the ramp travels into the panel instead of one thing fading out
     while another fades in somewhere else. */
  .glyph,
  .track {
    view-transition-name: effort-ramp;
  }

  .rung {
    height: var(--h);
    background: var(--color-muted-foreground);
    opacity: 0.25;
    /* Staggered off the rung's own index, so raising the throttle reads as a
       ramp filling rather than five lights flipping at once. */
    transition:
      opacity 220ms var(--ease-out-expo),
      background-color 220ms var(--ease-out-expo);
    transition-delay: calc(var(--i) * 22ms);
  }

  .rung.lit {
    background: var(--color-primary);
    opacity: 1;
  }

  /* Past the model's reach: present, dimmed and hatched, so the reader can see
     the level exists and that this model will not run it. */
  .rung.beyond {
    opacity: 0.12;
    background: repeating-linear-gradient(
      135deg,
      var(--color-muted-foreground) 0 2px,
      transparent 2px 4px
    );
  }

  .ceiling {
    width: 1px;
    background: var(--color-border);
    margin-inline: 2px;
  }

  .track {
    touch-action: none;
  }

  .track.dragging .rung {
    /* Scrubbing is direct manipulation; the stagger that makes a click feel
       physical makes a drag feel laggy, so it is dropped for the drag alone. */
    transition-duration: 90ms;
    transition-delay: 0ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .glyph,
    .track {
      view-transition-name: none;
    }
    .rung {
      transition: none;
      transition-delay: 0ms;
    }
  }
</style>

<script lang="ts" module>
  /** Which slice of the board is on screen. `all` is the absence of a filter. */
  export type FleetFilterValue = "all" | "working" | "needs-you" | "idle";
</script>

<script lang="ts">
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import ActivityDot from "./ActivityDot.svelte";
  /**
   * What the fleet board is showing, as a row of counted chips. It is a way of
   * looking at the fleet rather than a setting: nothing is persisted, so a
   * reload is always the whole board back.
   */
  import type { Activity } from "./activity";

  interface Props {
    /** How many rows each chip stands for, counted live off the board. */
    counts: Record<FleetFilterValue, number>;
    onchange: (next: FleetFilterValue) => void;
    value: FleetFilterValue;
  }

  let { counts, value, onchange }: Props = $props();

  /** `all` carries no dot: it is not a session state, so it has no hue to wear. */
  const CHIPS: {
    value: FleetFilterValue;
    label: string;
    activity?: Activity;
  }[] = [
    { value: "all", label: "All" },
    { value: "working", label: "Working", activity: "working" },
    { value: "needs-you", label: "Needs you", activity: "blocked" },
    { value: "idle", label: "Idle", activity: "idle" },
  ];

  /**
   * The group's own copy of the answer. It blanks itself when the chip already
   * chosen is clicked again and only says so afterwards, so the answer is
   * written back here as well as reported: the prop it came from has not moved,
   * and nothing else would put the chip's fill back.
   */
  let chosen = $state("all");
  $effect(() => {
    chosen = value;
  });

  /** `''` is that same re-click — the reader asking for the whole board back. */
  function choose(next: string): void {
    const chip = CHIPS.find((candidate) => candidate.value === next);
    const picked = chip ? chip.value : "all";
    chosen = picked;
    onchange(picked);
  }
</script>

<ToggleGroup.Root
  aria-label="Show only sessions in one state"
  class="self-start"
  onValueChange={choose}
  size="sm"
  type="single"
  variant="outline"
  bind:value={chosen}
>
  {#each CHIPS as chip (chip.value)}
    <ToggleGroup.Item
      class="font-normal text-muted-foreground data-[state=on]:font-medium
        data-[state=on]:text-foreground"
      disabled={chip.value !== 'all' && counts[chip.value] === 0}
      value={chip.value}
    >
      {#if chip.activity}
        <ActivityDot activity={chip.activity} size={1.5} />
      {/if}
      <!-- The label carries its own size: `text-micro` next to a text colour in
           the same `cn()` call is merged away as if it were one, and the chip
           silently comes back at the kit's 14px. -->
      <span class="text-micro">{chip.label}</span>
      <span class="text-micro text-muted-foreground tabular-nums" data-tabular>
        {counts[chip.value]}
      </span>
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

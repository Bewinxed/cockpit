<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  /**
   * The env-vars and headers editor: a key and a value per line, with a blank
   * line always waiting at the bottom so adding one is typing, not clicking.
   */
  import { IconClose } from "$lib/icons";

  let {
    rows = $bindable(),
    legend,
    keyPlaceholder,
    valuePlaceholder,
  }: {
    rows: { key: string; value: string }[];
    legend: string;
    keyPlaceholder: string;
    valuePlaceholder: string;
  } = $props();

  /** Keeps exactly one empty line at the end, however the lines were edited. */
  function settle() {
    const last = rows[rows.length - 1];
    if (!last || last.key.trim() || last.value.trim()) {
      rows.push({ key: "", value: "" });
    }
  }
</script>

<fieldset class="flex flex-col gap-1.5">
  <legend class="mb-1 text-[13px] text-muted-foreground">{legend}</legend>
  {#each rows as row, index (index)}
    <div class="flex items-center gap-1.5">
      <Input
        aria-label="{legend} name"
        autocomplete="off"
        class="h-8 flex-1 font-mono text-xs md:text-xs"
        oninput={settle}
        placeholder={keyPlaceholder}
        spellcheck="false"
        bind:value={row.key}
      />
      <Input
        aria-label="{legend} value"
        autocomplete="off"
        class="h-8 flex-[2] font-mono text-xs md:text-xs"
        oninput={settle}
        placeholder={valuePlaceholder}
        spellcheck="false"
        bind:value={row.value}
      />
      <Button
        aria-label="Remove {row.key || 'this line'}"
        class="text-muted-foreground"
        disabled={index === rows.length - 1}
        onclick={() => rows.splice(index, 1)}
        size="icon-sm"
        variant="ghost"
      >
        <IconClose />
      </Button>
    </div>
  {/each}
</fieldset>

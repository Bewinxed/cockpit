<script lang="ts">
  /**
   * The env-vars and headers editor: a key and a value per line, with a blank
   * line always waiting at the bottom so adding one is typing, not clicking.
   */
  import { IconClose } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';

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
    if (!last || last.key.trim() || last.value.trim()) rows.push({ key: '', value: '' });
  }
</script>

<fieldset class="flex flex-col gap-1.5">
  <legend class="mb-1 text-[13px] text-muted-foreground">{legend}</legend>
  {#each rows as row, index (index)}
    <div class="flex items-center gap-1.5">
      <Input
        bind:value={row.key}
        oninput={settle}
        autocomplete="off"
        spellcheck="false"
        placeholder={keyPlaceholder}
        aria-label="{legend} name"
        class="h-8 flex-1 font-mono text-xs md:text-xs"
      />
      <Input
        bind:value={row.value}
        oninput={settle}
        autocomplete="off"
        spellcheck="false"
        placeholder={valuePlaceholder}
        aria-label="{legend} value"
        class="h-8 flex-[2] font-mono text-xs md:text-xs"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground"
        disabled={index === rows.length - 1}
        aria-label="Remove {row.key || 'this line'}"
        onclick={() => rows.splice(index, 1)}
      >
        <IconClose />
      </Button>
    </div>
  {/each}
</fieldset>

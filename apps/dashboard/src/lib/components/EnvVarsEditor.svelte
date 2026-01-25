<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Plus, Trash2, Eye, EyeOff } from 'lucide-svelte';

  interface Props {
    value?: Record<string, string>;
    onchange?: (value: Record<string, string>) => void;
    disabled?: boolean;
  }

  let { value = $bindable({}), onchange, disabled = false }: Props = $props();

  // Internal state: array of key-value entries for easier manipulation
  let entries = $state<Array<{ key: string; value: string; showValue: boolean }>>(
    Object.entries(value || {}).map(([key, val]) => ({ key, value: val, showValue: false }))
  );

  // Initialize with one empty row if empty
  $effect(() => {
    if (entries.length === 0) {
      entries = [{ key: '', value: '', showValue: false }];
    }
  });

  function addRow() {
    entries = [...entries, { key: '', value: '', showValue: false }];
  }

  function removeRow(index: number) {
    entries = entries.filter((_, i) => i !== index);
    syncValue();
  }

  function toggleShowValue(index: number) {
    entries[index].showValue = !entries[index].showValue;
  }

  function syncValue() {
    const newValue: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.key.trim()) {
        newValue[entry.key.trim()] = entry.value;
      }
    }
    value = newValue;
    onchange?.(newValue);
  }

  function handleKeyChange(index: number, newKey: string) {
    entries[index].key = newKey;
    syncValue();
  }

  function handleValueChange(index: number, newValue: string) {
    entries[index].value = newValue;
    syncValue();
  }
</script>

<div class="space-y-2">
  {#each entries as entry, index (index)}
    <div class="flex items-center gap-2">
      <Input
        type="text"
        placeholder="KEY"
        class="flex-1 font-mono text-sm"
        value={entry.key}
        oninput={(e) => handleKeyChange(index, e.currentTarget.value)}
        {disabled}
      />
      <span class="text-muted-foreground">=</span>
      <div class="relative flex-1">
        <Input
          type={entry.showValue ? 'text' : 'password'}
          placeholder="value"
          class="flex-1 font-mono text-sm pr-10"
          value={entry.value}
          oninput={(e) => handleValueChange(index, e.currentTarget.value)}
          {disabled}
        />
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onclick={() => toggleShowValue(index)}
          disabled={disabled}
          title={entry.showValue ? 'Hide value' : 'Show value'}
        >
          {#if entry.showValue}
            <EyeOff class="size-4" />
          {:else}
            <Eye class="size-4" />
          {/if}
        </button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="text-muted-foreground hover:text-destructive shrink-0"
        onclick={() => removeRow(index)}
        {disabled}
        title="Remove variable"
      >
        <Trash2 class="size-4" />
      </Button>
    </div>
  {/each}

  <Button
    type="button"
    variant="outline"
    size="sm"
    class="w-full"
    onclick={addRow}
    {disabled}
  >
    <Plus class="size-4 mr-2" />
    Add Variable
  </Button>
</div>

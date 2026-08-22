<script lang="ts">
  /**
   * Card / panel — the white-raised-on-grey inset-well signature.
   * A raised card; pass `well` to wrap children in the sunken hairline field.
   * Ported from mocks/v5-components.html (.panel / .well).
   */
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    well = false,
    class: klass = '',
    children,
    ...rest
  }: {
    /** wrap children in the sunken inset field */
    well?: boolean;
    class?: string;
    children?: Snippet;
  } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class="panel {klass}" {...rest}>
  {#if well}
    <div class="well">{@render children?.()}</div>
  {:else}
    {@render children?.()}
  {/if}
</div>

<style>
  .panel {
    background: var(--surface-raised);
    border-radius: var(--radius-panel);
    padding: var(--c-card-pad);
    box-shadow: var(--shadow-lifted);
    display: flex;
    flex-direction: column;
  }
  .well {
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-well);
    padding: var(--c-card-pad);
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    flex: 1 1 auto;
    min-height: 0;
    justify-content: center;
  }
</style>

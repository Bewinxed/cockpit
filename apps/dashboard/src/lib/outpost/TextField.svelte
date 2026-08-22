<script lang="ts">
  /**
   * Input — label + control + hint. Optional lead icon and password eye.
   * Ported from mocks/v5-components.html (.field/.inp/.hint).
   */
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    value = $bindable(''),
    label = undefined,
    hint = undefined,
    hintKind = 'muted',
    error = false,
    lead,
    id = undefined,
    class: klass = '',
    ...rest
  }: {
    value?: string;
    label?: string;
    hint?: string;
    hintKind?: 'muted' | 'ok' | 'err';
    error?: boolean;
    lead?: Snippet;
    id?: string;
    class?: string;
  } & Omit<HTMLInputAttributes, 'value'> = $props();
</script>

<div class="field {klass}">
  {#if label}<label for={id}>{label}</label>{/if}
  <div class="inp {error ? 'has-err' : ''}">
    {#if lead}<span class="lead">{@render lead()}</span>{/if}
    <input {id} bind:value {...rest} />
  </div>
  {#if hint}<span class="hint {hintKind === 'ok' ? 'ok' : ''} {hintKind === 'err' || error ? 'err' : ''}">{hint}</span>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--ink-body);
  }
  .inp {
    display: flex;
    align-items: center;
    gap: var(--c-input-gap);
    height: var(--c-input-h);
    padding: 0 var(--c-input-pad);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
  }
  .inp input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--ink-strong);
    font-family: var(--font-body);
    font-size: var(--c-input-fs);
    line-height: var(--leading-ui);
  }
  .inp input::placeholder {
    color: var(--ink-muted);
    opacity: 1;
  }
  .inp input:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .lead {
    color: var(--ink-muted);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
  }
  .lead :global(svg) {
    width: 16px;
    height: 16px;
  }
  .inp:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .inp.has-err {
    border-color: var(--error-9);
  }
  .hint {
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .hint.ok {
    color: var(--success-11);
  }
  .hint.err {
    color: var(--error-11);
  }
</style>

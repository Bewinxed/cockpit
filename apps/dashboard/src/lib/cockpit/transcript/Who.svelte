<script lang="ts">
  /**
   * The role label leading every turn — a 14px mark (sunken for the reader,
   * `--brand-lo` for the agent) and the speaker's name. Ported from the mock's
   * `.who` / `.dot` / `.role`.
   */
  import { IconUser, IconAgent } from '$lib/icons';

  let { you = false, name }: { you?: boolean; name: string } = $props();
</script>

<h2 class="who">
  <span class="dot {you ? 'u' : 'a'}">
    {#if you}<IconUser />{:else}<IconAgent />{/if}
  </span>
  <span class="role">{name}</span>
</h2>

<style>
  .who {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--text-sm);
    color: var(--ink-muted);
    font-weight: var(--weight-medium);
    margin-bottom: 4px;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-mark);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .dot.u {
    background: var(--surface-sunken);
    color: var(--ink-body);
  }
  .dot.a {
    background: var(--brand-lo);
    color: var(--on-brand);
  }
  .dot :global(svg) {
    width: 9px;
    height: 9px;
  }
  .role {
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
</style>

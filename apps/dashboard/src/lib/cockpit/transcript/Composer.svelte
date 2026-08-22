<script lang="ts">
  /**
   * The floating composer — a lifted shell holding the text input, a context-%
   * readout, and any inline permission / question prompts stacked above it. Home,
   * this input, and Stop are the surface's fixed anchors; the button is a single
   * box that sends when idle and interrupts while a turn is in flight. Ported
   * from the mock's `.composer` / `.cin`.
   */
  import type { Snippet } from 'svelte';
  import { IconSend, IconStop } from '$lib/icons';

  let {
    value = $bindable(''),
    busy = false,
    onsubmit,
    onstop,
    prompts,
  }: {
    value?: string;
    busy?: boolean;
    onsubmit: (text: string) => void;
    onstop: () => void;
    prompts?: Snippet;
  } = $props();

  const canSend = $derived(value.trim().length > 0);

  function submit(): void {
    const text = value.trim();
    if (!text) return;
    value = '';
    onsubmit(text);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function onaction(): void {
    if (busy) onstop();
    else submit();
  }
</script>

<div class="fade"></div>
<div class="composer">
  {#if prompts}
    <div class="prompts">{@render prompts()}</div>
  {/if}
  <form class="cin" onsubmit={(e) => e.preventDefault()} aria-label="Message the agent">
    <textarea
      bind:value
      {onkeydown}
      placeholder="Message the agent…"
      aria-label="Message the agent"
    ></textarea>
    <div class="aff-row">
      <div class="inner">
        <span>/ commands</span><span>@ mention</span><span>＋ attach</span>
        <span class="hint">Enter sends · Shift+Enter for a new line</span>
      </div>
    </div>
    <button
      class="stop"
      type="button"
      onclick={onaction}
      disabled={!busy && !canSend}
      aria-label={busy ? 'Stop the agent' : 'Send message'}
    >
      {#if busy}<IconStop />{:else}<IconSend />{/if}
    </button>
  </form>
</div>

<style>
  .fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 96px;
    pointer-events: none;
    z-index: 19;
    background: linear-gradient(
      to top,
      var(--surface-field) 22%,
      oklch(from var(--surface-field) l c h / 0)
    );
  }
  .composer {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    bottom: calc(16px + env(safe-area-inset-bottom));
    width: min(720px, calc(100% - 50px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  }
  .composer > :global(*) {
    pointer-events: auto;
  }
  .prompts {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cin {
    position: relative;
    border: 1px solid var(--border-control);
    background: oklch(from var(--surface-raised) l c h / 0.82);
    -webkit-backdrop-filter: blur(16px) saturate(1.6);
    backdrop-filter: blur(16px) saturate(1.6);
    border-radius: var(--radius-shell);
    padding: 5px 5px 5px 15px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: var(--shadow-lifted);
  }
  /* Focused: the pill unfolds into a panel — textarea grows, affordances
     reveal, and the send button drops to the bottom-right. */
  .composer:focus-within .cin {
    border-radius: var(--radius-panel);
    flex-direction: column;
    align-items: stretch;
    padding: 12px 12px 9px;
  }
  textarea {
    flex: 1 1 auto;
    border: 0;
    outline: 0;
    background: transparent;
    resize: none;
    font-family: var(--font-body);
    font-size: var(--a-input-fs, 16px);
    line-height: var(--leading-ui);
    color: var(--ink-strong);
    height: 34px;
    padding: 7px 0 0;
    min-width: 0;
  }
  .composer:focus-within textarea {
    height: auto;
    min-height: 66px;
    max-height: 200px;
    padding-top: 0;
    field-sizing: content;
  }
  textarea::placeholder {
    color: var(--ink-muted);
  }
  /* Collapsed, the affordance row is taken OUT OF FLOW (absolute) so it claims
     zero width — otherwise it squeezes the resting textarea to a sliver at
     mobile widths. On focus it returns to flow and unfolds below the input. */
  .aff-row {
    position: absolute;
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition:
      opacity var(--c-300) var(--e-in),
      transform var(--c-300) var(--e-in);
  }
  .composer:focus-within .aff-row {
    position: static;
    grid-template-rows: 1fr;
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  .aff-row > .inner {
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--text-sm);
    color: var(--ink-muted);
    padding-top: 8px;
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .aff-row .hint {
    margin-left: auto;
  }
  .stop {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    border-radius: var(--radius-pill);
    flex: 0 0 auto;
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .composer:focus-within .stop {
    align-self: flex-end;
    margin-top: -26px;
  }
  .stop :global(svg) {
    width: 16px;
    height: 16px;
  }
  .stop:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
    background-image: none;
  }
  /* Mobile: the composer goes full-width, edge to edge. It stays absolute
     (docked at the bottom of the transcript pane) rather than viewport-fixed,
     so it sits ABOVE the thumb bar instead of overlapping it — the thumb bar
     owns the safe-area inset. */
  @media (max-width: 900px) {
    .composer {
      left: 12px;
      right: 12px;
      width: auto;
      transform: none;
      bottom: 10px;
    }
  }
</style>

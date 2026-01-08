<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    agentName?: string;
    error?: string;
  }

  let { open = $bindable(), onClose, agentName = 'the agent', error }: Props = $props();
</script>

<Modal {open} title="Authentication Required" onClose={onClose}>
  {#snippet children()}
    <div class="space-y-5">
      <div class="p-4 rounded-lg bg-warning-light border border-warning/20">
        <div class="flex items-start gap-3">
          <span class="text-2xl mt-0.5">🔐</span>
          <div>
            <h3 class="font-semibold text-text mb-1">Claude Authentication Required</h3>
            <p class="text-sm text-text-secondary leading-relaxed">
              <span class="font-medium text-text">{agentName}</span> requires authentication to run Claude Code instances.
            </p>
          </div>
        </div>
      </div>

      {#if error}
        <div class="p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
          {error}
        </div>
      {/if}

      <div class="space-y-3">
        <h4 class="font-medium text-text text-sm uppercase tracking-wide">Next Steps</h4>
        <ol class="list-decimal list-inside text-sm text-text-secondary space-y-2.5">
          <li class="pl-1">
            Open a terminal on <span class="font-medium text-text">{agentName}</span>
          </li>
          <li class="pl-1">
            Run: <code class="bg-surface-hover px-2 py-0.5 rounded text-text font-mono text-xs">cockpit login</code>
          </li>
          <li class="pl-1">
            Complete the authentication in your browser
          </li>
          <li class="pl-1">
            Return here and start your instance
          </li>
        </ol>
      </div>

      <div class="p-4 rounded-lg bg-bg-subtle border border-border text-xs text-text-muted leading-relaxed">
        This login uses Anthropic OAuth and is stored securely on the agent machine. 
        It is required for Claude Code to function properly.
      </div>

      <div class="flex pt-2">
        <button
          type="button"
          onclick={onClose}
          class="btn btn-primary w-full"
        >
          Close
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

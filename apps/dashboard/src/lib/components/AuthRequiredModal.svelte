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
    <div class="space-y-4">
      <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <div class="flex items-start gap-3">
          <span class="text-2xl">🔐</span>
          <div>
            <h3 class="font-medium text-tx-1 mb-1">Claude MAX Login Required</h3>
            <p class="text-sm text-tx-2">
              {agentName} needs authentication to spawn Claude Code instances.
            </p>
          </div>
        </div>
      </div>

      {#if error}
        <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600">
          {error}
        </div>
      {/if}

      <div class="space-y-3">
        <h4 class="font-medium text-tx-1 text-sm">To authenticate:</h4>
        <ol class="list-decimal list-inside text-sm text-tx-2 space-y-2">
          <li>
            Open a terminal on <span class="font-medium text-tx-1">{agentName}</span>
          </li>
          <li>
            Run: <code class="bg-bg-3 px-2 py-0.5 rounded text-tx-1 font-mono">cockpit login</code>
          </li>
          <li>
            Follow the prompts to log in with your Claude account
          </li>
          <li>
            Return here and try again
          </li>
        </ol>
      </div>

      <div class="p-3 rounded-lg bg-bg-3 text-sm">
        <p class="text-tx-3">
          This login uses Claude Pro/Max OAuth and is stored securely on the agent machine.
          Credentials are used to authenticate Claude Code instances.
        </p>
      </div>

      <div class="flex gap-3 pt-2">
        <button
          type="button"
          onclick={onClose}
          class="flex-1 px-4 py-2.5 rounded-xl bg-primary text-white font-medium
                 hover:bg-primary/90 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

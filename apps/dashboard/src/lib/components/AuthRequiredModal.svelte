<script lang="ts">
  import Modal from './Modal.svelte';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    open: boolean;
    onClose: () => void;
    agentName?: string;
    error?: string;
  }

  let { open = $bindable(), onClose, agentName = 'the agent', error }: Props = $props();
</script>

<Modal {open} title="Authentication Required" onClose={onClose}>
  <div class="space-y-5">
      <div class="p-4 rounded-lg bg-warning/10 border border-warning/20">
        <div class="flex items-start gap-3">
          <span class="text-2xl mt-0.5">🔐</span>
          <div>
            <h3 class="font-semibold text-foreground mb-1">Claude Authentication Required</h3>
            <p class="text-sm text-muted-foreground leading-relaxed">
              <span class="font-medium text-foreground">{agentName}</span> requires authentication to run Claude Code instances.
            </p>
          </div>
        </div>
      </div>

      {#if error}
        <div class="p-3 rounded-lg bg-error/10 border border-error/20 text-sm text-error">
          {error}
        </div>
      {/if}

      <div class="space-y-3">
        <h4 class="font-medium text-foreground text-sm uppercase tracking-wide">Next Steps</h4>
        <ol class="list-decimal list-inside text-sm text-muted-foreground space-y-2.5">
          <li class="pl-1">
            Open a terminal on <span class="font-medium text-foreground">{agentName}</span>
          </li>
          <li class="pl-1">
            Run: <code class="bg-accent px-2 py-0.5 rounded text-foreground font-mono text-xs">cockpit login</code>
          </li>
          <li class="pl-1">
            Complete the authentication in your browser
          </li>
          <li class="pl-1">
            Return here and start your instance
          </li>
        </ol>
      </div>

      <div class="p-4 rounded-lg bg-muted border border-border text-xs text-muted-foreground leading-relaxed">
        This login uses Anthropic OAuth and is stored securely on the agent machine. 
        It is required for Claude Code to function properly.
      </div>

      <div class="flex pt-2">
        <Button onclick={onClose} class="w-full">
          Close
        </Button>
      </div>
  </div>
</Modal>

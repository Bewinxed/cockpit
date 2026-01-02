<script lang="ts">
  import { page } from '$app/state';
  import { Streamdown } from 'svelte-streamdown';
  import { instances, messages, agents } from '$lib/stores/realtime';
  import { sendMessage, stopInstance } from '$lib/actions';

  let messageInput = $state('');
  let sending = $state(false);
  let chatContainer = $state<HTMLDivElement | null>(null);

  // Get instance ID from params
  let instanceId = $derived(page.params.id ?? '');

  // Get instance from store
  let instance = $derived($instances.get(instanceId));

  // Get agent info
  let agent = $derived(instance?.agentId ? $agents.get(instance.agentId) : undefined);

  // Filter messages for this instance
  let instanceMessages = $derived(
    $messages.filter(m => m.instanceId === instanceId)
  );

  // Auto-scroll on new messages
  $effect(() => {
    if (instanceMessages.length > 0 && chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });

  async function handleSendMessage(e: SubmitEvent) {
    e.preventDefault();
    if (!messageInput.trim() || sending || !instanceId) return;

    sending = true;
    const msg = messageInput;
    messageInput = '';

    const result = await sendMessage(instanceId, msg);
    if (!result.success) {
      console.error('Failed to send message:', result.error);
      messageInput = msg; // Restore on failure
    }

    sending = false;
  }

  async function handleStopInstance() {
    if (!instance || !instanceId) return;
    await stopInstance(instanceId);
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'running': return 'bg-flexoki-green';
      case 'starting': return 'bg-flexoki-yellow animate-pulse';
      case 'stopping': return 'bg-flexoki-orange animate-pulse';
      case 'stopped': return 'bg-tx-3';
      case 'error': return 'bg-flexoki-red';
      default: return 'bg-tx-3';
    }
  }
</script>

<svelte:head>
  <title>{instance?.name || 'Instance'} | Cockpit</title>
</svelte:head>

{#if instance}
  <div class="flex flex-col h-[calc(100vh-4rem)]">
    <!-- Header -->
    <header class="shrink-0 pb-4 border-b border-ui-1 mb-4">
      <div class="flex items-center gap-4 mb-2">
        <a href="/instances" class="text-tx-3 hover:text-tx-1 transition-colors">
          &larr; Instances
        </a>
      </div>

      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <h1 class="text-xl font-semibold text-tx-1">{instance.name}</h1>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium
              {instance.status === 'running' ? 'bg-flexoki-green/10 text-flexoki-green' :
               instance.status === 'error' ? 'bg-flexoki-red/10 text-flexoki-red' :
               'bg-tx-3/10 text-tx-3'}">
              <span class="w-1.5 h-1.5 rounded-full {getStatusColor(instance.status)}"></span>
              {instance.status}
            </span>
          </div>
          <p class="text-sm text-tx-3">
            {agent?.name || 'Unknown agent'} &middot; <code class="text-xs bg-bg-2 px-1.5 py-0.5 rounded">{instance.cwd}</code>
          </p>
        </div>

        <div class="flex gap-2">
          {#if instance.status === 'running'}
            <button
              onclick={handleStopInstance}
              class="px-4 py-2 rounded-xl bg-flexoki-red/10 text-flexoki-red text-sm font-medium
                     hover:bg-flexoki-red/20 transition-colors"
            >
              Stop Instance
            </button>
          {/if}
        </div>
      </div>
    </header>

    <!-- Chat Area -->
    <div
      bind:this={chatContainer}
      class="flex-1 overflow-y-auto min-h-0 space-y-4 pr-2"
    >
      {#if instanceMessages.length === 0}
        <div class="flex items-center justify-center h-full text-tx-3">
          <div class="text-center">
            <div class="text-4xl mb-4">
              {instance.status === 'running' ? '...' : ''}
            </div>
            <p class="text-sm">
              {instance.status === 'running'
                ? 'Waiting for messages...'
                : 'Instance is not running'}
            </p>
          </div>
        </div>
      {:else}
        {#each instanceMessages as message}
          <div class="flex gap-3 {message.type === 'user' ? 'flex-row-reverse' : ''}">
            <div class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm
              {message.type === 'user' ? 'bg-primary text-white' :
               message.type === 'assistant' ? 'bg-flexoki-cyan/20 text-flexoki-cyan' :
               message.type === 'error' ? 'bg-flexoki-red/20 text-flexoki-red' :
               'bg-bg-3 text-tx-2'}">
              {message.type === 'user' ? 'U' :
               message.type === 'assistant' ? 'C' :
               message.type === 'tool_use' ? 'T' :
               message.type === 'tool_result' ? 'R' :
               'S'}
            </div>
            <div class="flex-1 max-w-[80%] {message.type === 'user' ? 'text-right' : ''}">
              <div class="inline-block rounded-2xl px-4 py-2.5 text-sm
                {message.type === 'user' ? 'bg-primary text-white rounded-tr-sm' :
                 message.type === 'assistant' ? 'bg-bg-2 text-tx-1 rounded-tl-sm' :
                 message.type === 'error' ? 'bg-flexoki-red/10 text-flexoki-red rounded-tl-sm' :
                 'bg-bg-3 text-tx-2 rounded-tl-sm'}">
                {#if message.type === 'assistant'}
                  <div class="prose prose-sm prose-invert max-w-none">
                    <Streamdown content={message.content} animation={{ enabled: true, type: 'fade', duration: 150 }} />
                  </div>
                {:else}
                  <p class="whitespace-pre-wrap">{message.content}</p>
                {/if}
              </div>
              <p class="text-xs text-tx-3 mt-1 {message.type === 'user' ? 'text-right' : ''}">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Input Area -->
    {#if instance.status === 'running'}
      <form onsubmit={handleSendMessage} class="shrink-0 pt-4 border-t border-ui-1 mt-4">
        <div class="flex gap-3">
          <input
            type="text"
            bind:value={messageInput}
            placeholder="Type a message..."
            disabled={sending}
            class="flex-1 px-4 py-3 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
                   placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          />
          <button
            type="submit"
            disabled={sending || !messageInput.trim()}
            class="px-6 py-3 rounded-xl bg-primary text-white font-medium
                   hover:bg-primary/90 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    {:else}
      <div class="shrink-0 pt-4 border-t border-ui-1 mt-4">
        <p class="text-center text-sm text-tx-3">
          {instance.status === 'stopped' ? 'Instance is stopped' :
           instance.status === 'error' ? 'Instance encountered an error' :
           'Instance is not available'}
        </p>
      </div>
    {/if}
  </div>
{:else}
  <div class="text-center py-12">
    <h1 class="text-xl font-semibold text-tx-1 mb-2">Instance Not Found</h1>
    <p class="text-tx-3 mb-4">This instance may have been removed or doesn't exist.</p>
    <a href="/instances" class="btn btn-primary">Back to Instances</a>
  </div>
{/if}

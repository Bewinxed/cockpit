<script lang="ts">
  import { User, Bot, Wrench, FileText, AlertCircle, ChevronDown, ChevronRight, Copy, Check, Loader2, CheckCircle2, XCircle, Settings, Terminal, Scissors, ExternalLink, ArrowRight, KeyRound, Cpu, BookOpen, Info, FileCode } from 'lucide-svelte';
  import Markdown from '@humanspeak/svelte-markdown';
  import { formatTimestamp } from '$lib/utils/time';
  import type { Message } from '$lib/stores/realtime';

  interface ModelInfo {
    value: string;
    displayName: string;
    description: string;
  }

  interface Props {
    message: Message;
    showTimestamp?: boolean;
    onLoginSubmit?: (code: string) => Promise<void>;
    onLoginCancel?: () => void;
    onModelSelect?: (model: string) => Promise<void>;
    onModelCancel?: () => void;
    onDismissMessage?: () => void;
    /** Whether this login prompt is currently active (pending) */
    isLoginActive?: boolean;
    /** Whether this model picker is currently active */
    isModelPickerActive?: boolean;
  }

  let { message, showTimestamp = false, onLoginSubmit, onLoginCancel, onModelSelect, onModelCancel, onDismissMessage, isLoginActive = false, isModelPickerActive = false }: Props = $props();

  // Login prompt state
  let loginCode = $state('');
  let loginLoading = $state(false);
  let loginError = $state<string | null>(null);

  async function handleLoginSubmit() {
    if (!loginCode.trim() || !onLoginSubmit) return;
    loginLoading = true;
    loginError = null;
    try {
      await onLoginSubmit(loginCode.trim());
    } catch (err) {
      loginError = err instanceof Error ? err.message : 'Login failed';
    } finally {
      loginLoading = false;
    }
  }

  function handleLoginKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleLoginSubmit();
    } else if (e.key === 'Escape') {
      onLoginCancel?.();
    }
  }

  let isExpanded = $state(false);
  let copied = $state(false);

  // Get tool info from metadata or parse from content (backwards compatibility)
  const toolInfo = $derived(() => {
    if (message.type !== 'tool_use' && message.type !== 'tool_result') return null;

    // Use metadata if available (new format)
    if (message.metadata?.toolName) {
      return {
        name: message.metadata.toolName,
        id: message.metadata.toolId,
        input: message.metadata.toolInput,
        result: message.metadata.toolResult,
        status: message.metadata.toolStatus || 'pending',
      };
    }

    // Fallback: parse from content (old format)
    try {
      const parsed = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
      return {
        name: parsed?.name || 'Tool',
        id: parsed?.id,
        input: parsed?.input || parsed,
        result: null,
        status: 'success' as const,
      };
    } catch {
      return { name: 'Tool', input: message.content, result: null, status: 'success' as const };
    }
  });

  // Get hook info from metadata
  const hookInfo = $derived(() => {
    if (message.type !== 'hook_response') return null;
    return {
      name: message.metadata?.hookName || 'Hook',
      exitCode: message.metadata?.exitCode ?? 0,
      stdout: message.metadata?.stdout,
      stderr: message.metadata?.stderr,
    };
  });

  // Check if this is a compact_boundary system message
  const isCompactBoundary = $derived(
    message.type === 'system' && message.metadata?.subtype === 'compact_boundary'
  );

  // Check if this is a login_prompt system message
  const isLoginPrompt = $derived(
    message.type === 'system' && message.metadata?.subtype === 'login_prompt'
  );

  // Check if this is a model_picker system message
  const isModelPicker = $derived(
    message.type === 'system' && message.metadata?.subtype === 'model_picker'
  );

  // Check if this is a memory_info system message
  const isMemoryInfo = $derived(
    message.type === 'system' && message.metadata?.subtype === 'memory_info'
  );

  // Check if this is a vim_info system message
  const isVimInfo = $derived(
    message.type === 'system' && message.metadata?.subtype === 'vim_info'
  );

  // Check if this is a terminal_setup_info system message
  const isTerminalSetupInfo = $derived(
    message.type === 'system' && message.metadata?.subtype === 'terminal_setup_info'
  );

  // Model picker state
  let models = $derived<ModelInfo[]>((message.metadata?.models as ModelInfo[]) || []);
  let currentModel = $derived<string | undefined>(message.metadata?.currentModel as string | undefined);
  let selectedModel = $state<string | undefined>(undefined);
  let modelLoading = $state(false);
  let modelError = $state<string | null>(null);

  // Initialize selected model when models change
  $effect(() => {
    if (isModelPicker && models.length > 0 && !selectedModel) {
      selectedModel = currentModel || models[0]?.value;
    }
  });

  async function handleModelSubmit() {
    if (!selectedModel || !onModelSelect) return;
    modelLoading = true;
    modelError = null;
    try {
      await onModelSelect(selectedModel);
    } catch (err) {
      modelError = err instanceof Error ? err.message : 'Failed to set model';
    } finally {
      modelLoading = false;
    }
  }

  function handleModelKeydown(e: KeyboardEvent) {
    if (!isModelPickerActive) return;
    const currentIndex = models.findIndex(m => m.value === selectedModel);

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = currentIndex > 0 ? currentIndex - 1 : models.length - 1;
      selectedModel = models[newIndex]?.value;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = currentIndex < models.length - 1 ? currentIndex + 1 : 0;
      selectedModel = models[newIndex]?.value;
    } else if (e.key === 'Enter' && !modelLoading) {
      e.preventDefault();
      handleModelSubmit();
    } else if (e.key === 'Escape') {
      onModelCancel?.();
    }
  }

  async function copyContent() {
    await navigator.clipboard.writeText(message.content);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  const messageConfig = {
    user: {
      align: 'justify-end',
      bubble: 'chat-bubble chat-bubble-user',
      icon: User,
      iconBg: 'bg-primary',
    },
    assistant: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-assistant',
      icon: Bot,
      iconBg: 'bg-secondary',
    },
    tool_use: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-tool',
      icon: Wrench,
      iconBg: 'bg-warning-light',
    },
    tool_result: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-tool',
      icon: FileText,
      iconBg: 'bg-success-light',
    },
    error: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-error',
      icon: AlertCircle,
      iconBg: 'bg-error-light',
    },
    system: {
      align: 'justify-center',
      bubble: 'text-xs text-text-muted py-2 px-4 bg-surface-hover/50 rounded-full inline-flex items-center gap-2',
      icon: Settings,
      iconBg: 'bg-surface-hover',
    },
    hook_response: {
      align: 'justify-start',
      bubble: 'chat-bubble chat-bubble-tool',
      icon: Terminal,
      iconBg: 'bg-info-light',
    },
  };

  const config = $derived(messageConfig[message.type] || messageConfig.assistant);
</script>

<svelte:window onkeydown={handleModelKeydown} />

<div class="flex {config.align} gap-3 group animate-fade-in-up">
  {#if message.type !== 'user' && message.type !== 'system' && !isCompactBoundary && !isLoginPrompt && !isModelPicker && !isMemoryInfo && !isVimInfo && !isTerminalSetupInfo}
    <!-- Avatar -->
    <div class="flex-shrink-0 w-8 h-8 rounded-lg {config.iconBg} flex items-center justify-center">
      <config.icon class="w-4 h-4 {message.type === 'error' ? 'text-error' : 'text-text-secondary'}" />
    </div>
  {/if}

  <!-- Message Content -->
  <div class="flex flex-col gap-1 {message.type === 'user' ? 'items-end' : 'items-start'} {isCompactBoundary || isLoginPrompt || isModelPicker || isMemoryInfo || isVimInfo || isTerminalSetupInfo ? 'w-full' : 'max-w-[85%]'}">
    {#if message.type === 'tool_use' || message.type === 'tool_result'}
      <!-- Tool message - collapsible -->
      <button
        class="{config.bubble} w-full text-left cursor-pointer hover:bg-surface-active transition-colors"
        onclick={() => isExpanded = !isExpanded}
      >
        <div class="flex items-center gap-2">
          {#if isExpanded}
            <ChevronDown class="w-4 h-4 text-text-muted flex-shrink-0" />
          {:else}
            <ChevronRight class="w-4 h-4 text-text-muted flex-shrink-0" />
          {/if}
          <span class="font-medium text-text">
            {toolInfo()?.name || 'Tool'}
          </span>
          <!-- Status indicator -->
          {#if toolInfo()?.status === 'pending'}
            <Loader2 class="w-4 h-4 text-warning animate-spin" />
          {:else if toolInfo()?.status === 'error'}
            <XCircle class="w-4 h-4 text-error" />
          {:else}
            <CheckCircle2 class="w-4 h-4 text-success" />
          {/if}
        </div>
      </button>

      {#if isExpanded}
        {@const tool = toolInfo()}
        <div class="w-full space-y-2 mt-1">
          <!-- Input -->
          <div class="bg-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto border border-border">
            <div class="text-text-muted text-[10px] uppercase tracking-wide mb-1">Input</div>
            <pre class="whitespace-pre-wrap break-all text-text-secondary">{JSON.stringify(tool?.input, null, 2)}</pre>
          </div>

          <!-- Result (if available) -->
          {#if tool?.result !== undefined && tool?.result !== null}
            <div class="bg-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto border border-border {tool?.status === 'error' ? 'border-error/30 bg-error/5' : 'border-success/30 bg-success/5'}">
              <div class="text-text-muted text-[10px] uppercase tracking-wide mb-1">
                {tool?.status === 'error' ? 'Error' : 'Result'}
              </div>
              <pre class="whitespace-pre-wrap break-all text-text-secondary">{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
            </div>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'hook_response'}
      <!-- Hook response - collapsible like tool results -->
      <button
        class="{config.bubble} w-full text-left cursor-pointer hover:bg-surface-active transition-colors"
        onclick={() => isExpanded = !isExpanded}
      >
        <div class="flex items-center gap-2">
          {#if isExpanded}
            <ChevronDown class="w-4 h-4 text-text-muted flex-shrink-0" />
          {:else}
            <ChevronRight class="w-4 h-4 text-text-muted flex-shrink-0" />
          {/if}
          <span class="font-medium text-text">
            {hookInfo()?.name || 'Hook'}
          </span>
          <!-- Exit code indicator -->
          {#if hookInfo()?.exitCode === 0}
            <CheckCircle2 class="w-4 h-4 text-success" />
          {:else}
            <XCircle class="w-4 h-4 text-error" />
          {/if}
          <span class="text-xs text-text-muted">
            exit {hookInfo()?.exitCode}
          </span>
        </div>
      </button>

      {#if isExpanded}
        {@const hook = hookInfo()}
        <div class="w-full space-y-2 mt-1">
          <!-- stdout -->
          {#if hook?.stdout}
            <div class="bg-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto border border-border border-success/30 bg-success/5">
              <div class="text-text-muted text-[10px] uppercase tracking-wide mb-1">stdout</div>
              <pre class="whitespace-pre-wrap break-all text-text-secondary">{hook.stdout}</pre>
            </div>
          {/if}

          <!-- stderr -->
          {#if hook?.stderr}
            <div class="bg-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto border border-border border-error/30 bg-error/5">
              <div class="text-text-muted text-[10px] uppercase tracking-wide mb-1">stderr</div>
              <pre class="whitespace-pre-wrap break-all text-text-secondary">{hook.stderr}</pre>
            </div>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'system' && isCompactBoundary}
      <!-- Compact boundary - horizontal divider -->
      <div class="w-full flex items-center gap-3 py-2">
        <div class="flex-1 h-px bg-border"></div>
        <div class="flex items-center gap-2 text-xs text-text-muted">
          <Scissors class="w-3 h-3" />
          <span>Context compacted</span>
          {#if message.metadata?.preTokens}
            <span class="text-text-secondary">({message.metadata.preTokens.toLocaleString()} tokens)</span>
          {/if}
        </div>
        <div class="flex-1 h-px bg-border"></div>
      </div>
    {:else if message.type === 'system' && isLoginPrompt}
      <!-- Login prompt - two states: active (form) or inactive (compact) -->
      {#if isLoginActive}
        <!-- Active: Show full login form -->
        <div class="w-full max-w-md">
          <div class="border border-dotted border-border rounded-lg p-5 bg-surface space-y-4">
            <!-- Header -->
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <KeyRound class="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 class="font-serif font-semibold text-text text-lg leading-tight">Login to Claude</h3>
                <p class="text-sm text-text-secondary mt-0.5">Authenticate with your Claude MAX subscription</p>
              </div>
            </div>

            <!-- Step 1: Open auth page -->
            {#if message.metadata?.authUrl}
              <div class="space-y-2">
                <div class="flex items-center gap-2 text-xs text-text-muted uppercase tracking-wide">
                  <span class="w-5 h-5 rounded-full bg-text-muted/10 flex items-center justify-center text-[10px] font-medium">1</span>
                  <span>Open login page</span>
                </div>
                <a
                  href={message.metadata.authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors text-sm font-medium group w-fit"
                >
                  <span>Open Anthropic Login</span>
                  <ExternalLink class="w-4 h-4 opacity-70 group-hover:opacity-100 transition-opacity" />
                </a>
              </div>
            {/if}

            <!-- Step 2: Paste code -->
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-xs text-text-muted uppercase tracking-wide">
                <span class="w-5 h-5 rounded-full bg-text-muted/10 flex items-center justify-center text-[10px] font-medium">2</span>
                <span>Paste the code</span>
              </div>
              <div class="relative">
                <input
                  type="text"
                  bind:value={loginCode}
                  onkeydown={handleLoginKeydown}
                  placeholder="Paste code here..."
                  disabled={loginLoading}
                  class="w-full px-4 py-2.5 bg-bg border border-border rounded-md text-sm font-mono
                         placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                />
              </div>
              <p class="text-xs text-text-muted">
                After authorizing, you'll see a code like <code class="px-1 py-0.5 bg-bg-subtle rounded text-[11px]">abc123#xyz789</code>
              </p>
            </div>

            <!-- Error -->
            {#if loginError}
              <div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
                <AlertCircle class="w-4 h-4 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            {/if}

            <!-- Actions -->
            <div class="flex items-center gap-3 pt-1">
              <button
                onclick={handleLoginSubmit}
                disabled={!loginCode.trim() || loginLoading}
                class="flex items-center gap-2 px-4 py-2 bg-[#37352f] text-white rounded-md text-sm font-medium
                       hover:bg-[#2f2d29] disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
              >
                {#if loginLoading}
                  <Loader2 class="w-4 h-4 animate-spin" />
                  <span>Logging in...</span>
                {:else}
                  <span>Complete Login</span>
                  <ArrowRight class="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform" />
                {/if}
              </button>
              <button
                onclick={onLoginCancel}
                disabled={loginLoading}
                class="px-4 py-2 text-sm text-text-secondary hover:text-text hover:underline underline-offset-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Inactive: Show compact dismissible version -->
        <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-hover/50 border border-dotted border-border rounded-lg text-sm group">
          <KeyRound class="w-3.5 h-3.5 text-text-muted" />
          <span class="text-text-muted">Login attempted</span>
          <span class="text-text-secondary font-mono text-xs">•••••••#•••</span>
          {#if onDismissMessage}
            <button
              onclick={onDismissMessage}
              class="ml-1 p-0.5 rounded hover:bg-surface-active transition-colors opacity-0 group-hover:opacity-100"
              title="Dismiss"
            >
              <XCircle class="w-3.5 h-3.5 text-text-muted hover:text-text-secondary" />
            </button>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'system' && isModelPicker}
      <!-- Model Picker - inline form like login -->
      {#if isModelPickerActive}
        <!-- Active: Show model picker form -->
        <div class="w-full max-w-md">
          <div class="border border-dotted border-border rounded-lg p-5 bg-surface space-y-4">
            <!-- Header -->
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center flex-shrink-0">
                <Cpu class="w-5 h-5 text-secondary" />
              </div>
              <div>
                <h3 class="font-serif font-semibold text-text text-lg leading-tight">Switch Model</h3>
                <p class="text-sm text-text-secondary mt-0.5">Select a model for this session</p>
              </div>
            </div>

            <!-- Model list -->
            {#if message.metadata?.loading}
              <div class="flex items-center justify-center py-6">
                <Loader2 class="w-5 h-5 animate-spin text-text-muted" />
                <span class="ml-2 text-sm text-text-muted">Loading models...</span>
              </div>
            {:else if message.metadata?.error}
              <div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
                <AlertCircle class="w-4 h-4 flex-shrink-0" />
                <span>{message.metadata.error}</span>
              </div>
            {:else if models.length === 0}
              <div class="text-center py-6 text-sm text-text-muted">
                No models available
              </div>
            {:else}
              <div class="space-y-1 max-h-64 overflow-y-auto">
                {#each models as model (model.value)}
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-3
                      {selectedModel === model.value
                        ? 'bg-secondary/10 border border-secondary/30'
                        : 'hover:bg-surface-hover border border-transparent'}"
                    onclick={() => selectedModel = model.value}
                  >
                    <div class="flex-shrink-0 w-5 h-5 mt-0.5">
                      {#if selectedModel === model.value}
                        <Check class="w-5 h-5 text-secondary" />
                      {/if}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-text text-sm">{model.displayName}</span>
                        {#if currentModel === model.value}
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary uppercase tracking-wide">current</span>
                        {/if}
                      </div>
                      <p class="text-xs text-text-muted mt-0.5 line-clamp-2">{model.description}</p>
                    </div>
                  </button>
                {/each}
              </div>
              <p class="text-xs text-text-muted text-center">
                Use ↑↓ to navigate, Enter to select
              </p>
            {/if}

            <!-- Error -->
            {#if modelError}
              <div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
                <AlertCircle class="w-4 h-4 flex-shrink-0" />
                <span>{modelError}</span>
              </div>
            {/if}

            <!-- Actions -->
            <div class="flex items-center gap-3 pt-1">
              <button
                onclick={handleModelSubmit}
                disabled={!selectedModel || selectedModel === currentModel || modelLoading}
                class="flex items-center gap-2 px-4 py-2 bg-[#37352f] text-white rounded-md text-sm font-medium
                       hover:bg-[#2f2d29] disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
              >
                {#if modelLoading}
                  <Loader2 class="w-4 h-4 animate-spin" />
                  <span>Applying...</span>
                {:else}
                  <span>Apply</span>
                  <ArrowRight class="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform" />
                {/if}
              </button>
              <button
                onclick={onModelCancel}
                disabled={modelLoading}
                class="px-4 py-2 text-sm text-text-secondary hover:text-text hover:underline underline-offset-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Inactive: Show compact version -->
        <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-hover/50 border border-dotted border-border rounded-lg text-sm group">
          <Cpu class="w-3.5 h-3.5 text-text-muted" />
          <span class="text-text-muted">Model selection</span>
          {#if message.metadata?.selectedModel}
            <span class="text-text-secondary text-xs">{message.metadata.selectedModel}</span>
          {/if}
          {#if onDismissMessage}
            <button
              onclick={onDismissMessage}
              class="ml-1 p-0.5 rounded hover:bg-surface-active transition-colors opacity-0 group-hover:opacity-100"
              title="Dismiss"
            >
              <XCircle class="w-3.5 h-3.5 text-text-muted hover:text-text-secondary" />
            </button>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'system' && isMemoryInfo}
      <!-- Memory Info - explain that /memory requires a local editor -->
      <div class="w-full max-w-md">
        <div class="border border-info/30 rounded-lg p-4 bg-info/5 space-y-3">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-lg bg-info/10 flex items-center justify-center flex-shrink-0">
              <BookOpen class="w-4 h-4 text-info" />
            </div>
            <div>
              <h3 class="font-semibold text-text text-sm">Memory Editor (CLI Only)</h3>
              <p class="text-xs text-text-secondary mt-1 leading-relaxed">
                The <code class="px-1.5 py-0.5 bg-bg-subtle rounded text-[11px] font-mono">/memory</code> command opens your local text editor to edit CLAUDE.md files.
              </p>
            </div>
          </div>
          <div class="ml-12 space-y-2">
            <p class="text-xs text-text-muted">
              In the web dashboard, you can manage memory files by:
            </p>
            <ul class="text-xs text-text-secondary space-y-1.5 list-disc list-inside">
              <li>Asking Claude to read or update CLAUDE.md directly</li>
              <li>Using <code class="px-1 py-0.5 bg-bg-subtle rounded text-[10px] font-mono">/init</code> to create a new memory file</li>
              <li>Using the Claude Code CLI locally for full editor access</li>
            </ul>
          </div>
        </div>
      </div>
    {:else if message.type === 'system' && isVimInfo}
      <!-- Vim Info - explain that vim mode is CLI only -->
      <div class="w-full max-w-md">
        <div class="border border-warning/30 rounded-lg p-4 bg-warning/5 space-y-3">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
              <FileCode class="w-4 h-4 text-warning" />
            </div>
            <div>
              <h3 class="font-semibold text-text text-sm">Vim Mode (CLI Only)</h3>
              <p class="text-xs text-text-secondary mt-1 leading-relaxed">
                Vim keybindings are not available in the web dashboard. The <code class="px-1.5 py-0.5 bg-bg-subtle rounded text-[11px] font-mono">/vim</code> command enables vim-style editing in the Claude Code CLI.
              </p>
            </div>
          </div>
          <div class="ml-12">
            <p class="text-xs text-text-muted">
              Use the Claude Code CLI to toggle vim mode: <code class="px-1.5 py-0.5 bg-bg-subtle rounded text-[10px] font-mono">claude</code>
            </p>
          </div>
        </div>
      </div>
    {:else if message.type === 'system' && isTerminalSetupInfo}
      <!-- Terminal Setup Info - explain that this is for CLI installation -->
      <div class="w-full max-w-md">
        <div class="border border-secondary/30 rounded-lg p-4 bg-secondary/5 space-y-3">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center flex-shrink-0">
              <Terminal class="w-4 h-4 text-secondary" />
            </div>
            <div>
              <h3 class="font-semibold text-text text-sm">Terminal Setup (CLI Only)</h3>
              <p class="text-xs text-text-secondary mt-1 leading-relaxed">
                The <code class="px-1.5 py-0.5 bg-bg-subtle rounded text-[11px] font-mono">/terminal-setup</code> command installs shell integration scripts for the Claude Code CLI.
              </p>
            </div>
          </div>
          <div class="ml-12 space-y-2">
            <p class="text-xs text-text-muted">
              Shell integration enables features like:
            </p>
            <ul class="text-xs text-text-secondary space-y-1 list-disc list-inside">
              <li>Automatic context from recent terminal output</li>
              <li>Command history integration</li>
              <li>Enhanced terminal awareness</li>
            </ul>
            <p class="text-xs text-text-muted mt-2">
              Run this in your terminal: <code class="px-1.5 py-0.5 bg-bg-subtle rounded text-[10px] font-mono">claude /terminal-setup</code>
            </p>
          </div>
        </div>
      </div>
    {:else if message.type === 'system'}
      <!-- System message - subtle banner -->
      <div class="{config.bubble}">
        <Settings class="w-3 h-3" />
        <span>{message.content}</span>
      </div>
    {:else}
      <!-- Regular message with markdown support -->
      <div class="{config.bubble} relative">
        <div class="prose prose-sm max-w-none {message.type === 'user' ? 'prose-invert' : ''} [&_pre]:bg-bg-subtle [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_code]:text-xs [&_code]:bg-bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
          <Markdown source={message.content} />
        </div>

        <!-- Copy button -->
        <button
          class="absolute -right-2 -top-2 p-1.5 rounded-md bg-surface border border-border shadow-sm
                 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-hover"
          onclick={copyContent}
          title="Copy message"
        >
          {#if copied}
            <Check class="w-3.5 h-3.5 text-success" />
          {:else}
            <Copy class="w-3.5 h-3.5 text-text-muted" />
          {/if}
        </button>
      </div>
    {/if}

    <!-- Timestamp -->
    {#if showTimestamp && message.timestamp}
      <span class="text-[10px] text-text-muted mt-0.5">
        {formatTimestamp(new Date(message.timestamp))}
      </span>
    {/if}
  </div>

  {#if message.type === 'user'}
    <!-- User Avatar -->
    <div class="flex-shrink-0 w-8 h-8 rounded-lg {config.iconBg} flex items-center justify-center">
      <config.icon class="w-4 h-4 text-white" />
    </div>
  {/if}
</div>

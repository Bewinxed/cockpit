<script lang="ts">
  import { User, Bot, Wrench, FileText, AlertCircle, ChevronDown, ChevronRight, ChevronUp, Loader2, CheckCircle2, XCircle, Settings, Terminal, Scissors, ExternalLink, ArrowRight, KeyRound, Cpu, HelpCircle, BookOpen, FolderOpen, Home, Edit3, Check } from 'lucide-svelte';
  import Markdown from '@humanspeak/svelte-markdown';
  import { formatTimestamp } from '$lib/utils/time';
  import type { Message } from '$lib/stores/realtime.svelte';
  import HelpMenu from './HelpMenu.svelte';
  import DiffView from './DiffView.svelte';
  import { CopyButton } from '$lib/components/ui/copy-button';

  interface ModelInfo {
    value: string;
    displayName: string;
    description: string;
  }

  interface MemoryOption {
    type: 'project' | 'user';
    label: string;
    path: string;
  }

  interface Props {
    message: Message;
    showTimestamp?: boolean;
    onLoginSubmit?: (code: string) => Promise<void>;
    onLoginCancel?: () => void;
    onModelSelect?: (model: string) => Promise<void>;
    onModelCancel?: () => void;
    onMemorySelect?: (memoryType: 'project' | 'user') => void;
    onMemorySave?: (content: string) => Promise<void>;
    onMemoryCancel?: () => void;
    onDismissMessage?: () => void;
    /** Callback when user wants to edit this message and continue from here */
    onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
    /** Whether this login prompt is currently active (pending) */
    isLoginActive?: boolean;
    /** Whether this model picker is currently active */
    isModelPickerActive?: boolean;
    /** Whether this memory picker is currently active */
    isMemoryPickerActive?: boolean;
    /** Whether editing is supported for this message */
    canEdit?: boolean;
  }

  let { message, showTimestamp = false, onLoginSubmit, onLoginCancel, onModelSelect, onModelCancel, onMemorySelect, onMemorySave, onMemoryCancel, onDismissMessage, onEditMessage, isLoginActive = false, isModelPickerActive = false, isMemoryPickerActive = false, canEdit = false }: Props = $props();

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
    if (!isLoginActive) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleLoginSubmit();
    } else if (e.key === 'Escape') {
      onLoginCancel?.();
    }
  }

  // Auto-expand for diff tools, collapsed for others
  const hasDiff = $derived(() => {
    if (message.type !== 'tool_use' && message.type !== 'tool_result') return false;
    const toolName = message.metadata?.toolName;
    if (!toolName) return false;
    const diffTools = ['Edit', 'edit', 'str_replace_editor', 'str_replace', 'file_edit', 'Write', 'write', 'create_file', 'write_file'];
    return diffTools.includes(toolName);
  });

  let isExpanded = $state(false);
  let diffFullyExpanded = $state(false);

  // Auto-expand diff tools on mount
  $effect(() => {
    if (hasDiff()) {
      isExpanded = true;
    }
  });

  // Message editing state
  let isEditing = $state(false);
  let editContent = $state('');
  let editLoading = $state(false);

  function startEditing() {
    editContent = message.content;
    isEditing = true;
  }

  function cancelEditing() {
    isEditing = false;
    editContent = '';
  }

  async function submitEdit() {
    if (!onEditMessage || !message.id || !editContent.trim()) return;

    // Close edit mode immediately for better UX
    const content = editContent.trim();
    const id = message.id;
    isEditing = false;
    editLoading = true;

    try {
      await onEditMessage(id, content);
    } catch (err) {
      console.error('[Edit] onEditMessage error:', err);
      // Re-open edit mode on error so user can retry
      isEditing = true;
      editContent = content;
    } finally {
      editLoading = false;
    }
  }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEditing();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      submitEdit();
    }
  }

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

  // Check if a tool is a file modification tool that should show a diff
  function isFileDiffTool(toolName: string | undefined): boolean {
    if (!toolName) return false;
    const diffTools = [
      // Edit tools (partial file modification)
      'Edit', 'edit', 'str_replace_editor', 'str_replace', 'file_edit',
      // Write tools (full file write)
      'Write', 'write', 'create_file', 'write_file',
    ];
    return diffTools.includes(toolName);
  }

  // Check if this is a write (full file) vs edit (partial) tool
  function isWriteTool(toolName: string | undefined): boolean {
    if (!toolName) return false;
    const writeTools = ['Write', 'write', 'create_file', 'write_file'];
    return writeTools.includes(toolName);
  }

  // Extract diff info from tool input for file modification tools
  function getDiffInfo(input: Record<string, unknown> | undefined, toolName: string | undefined): { filePath: string; oldContent: string; newContent: string } | null {
    if (!input) return null;

    // Handle different tool input formats
    const filePath = (input.file_path || input.path || input.filename) as string | undefined;

    if (!filePath) return null;

    // For write tools, old content is empty (new file or full overwrite)
    if (isWriteTool(toolName)) {
      const newContent = (input.content || '') as string;
      return { filePath, oldContent: '', newContent };
    }

    // For edit tools, get old and new strings
    const oldContent = (input.old_string || input.old_str || '') as string;
    const newContent = (input.new_string || input.new_str || input.content || '') as string;

    return { filePath, oldContent, newContent };
  }

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

  // Check if this is a memory_picker system message
  const isMemoryPicker = $derived(
    message.type === 'system' && message.metadata?.subtype === 'memory_picker'
  );


  // Model picker state
  let models = $derived<ModelInfo[]>((message.metadata?.models as ModelInfo[]) || []);
  let currentModel = $derived<string | undefined>(message.metadata?.currentModel as string | undefined);
  let selectedModel = $state<string | undefined>(undefined);
  let modelLoading = $state(false);
  let modelError = $state<string | null>(null);

  // Memory picker state
  let memoryContent = $state('');
  let memorySaving = $state(false);
  let selectedMemoryOption = $state<'project' | 'user' | null>(null);

  // Initialize memory content when it changes in metadata
  $effect(() => {
    if (isMemoryPicker) {
      memoryContent = (message.metadata?.memoryContent as string) || '';
    }
  });

  // Action to autofocus elements when they mount
  function autofocus(node: HTMLElement) {
    node.focus();
  }

  async function handleMemorySave() {
    if (!onMemorySave || memorySaving) return;
    memorySaving = true;
    try {
      await onMemorySave(memoryContent);
    } finally {
      memorySaving = false;
    }
  }

  // Derived state for memory phase to ensure reactivity
  const isMemoryEditing = $derived(message.metadata?.memoryPhase === 'editing');
  const isMemorySelecting = $derived(isMemoryPickerActive && !isMemoryEditing);

  // Handle keyboard in memory selection phase (not editing)
  function handleMemorySelectionKeydown(e: KeyboardEvent) {
    if (!isMemorySelecting) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!selectedMemoryOption) {
        selectedMemoryOption = 'project';
      } else {
        selectedMemoryOption = selectedMemoryOption === 'project' ? 'user' : 'project';
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedMemoryOption) {
        onMemorySelect?.(selectedMemoryOption);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onMemoryCancel?.();
    } else if (e.key === '1') {
      e.preventDefault();
      onMemorySelect?.('project');
    } else if (e.key === '2') {
      e.preventDefault();
      onMemorySelect?.('user');
    }
  }

  // Handle keyboard in memory editor (textarea) - Escape cancels, Ctrl+Enter saves
  // Plain Enter must work for newlines, so we stop propagation to prevent window handlers
  function handleMemoryEditorKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onMemoryCancel?.();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleMemorySave();
    } else if (e.key === 'Enter') {
      // Stop propagation so window handlers don't intercept plain Enter
      e.stopPropagation();
    }
  }

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

  function handleWindowKeydown(e: KeyboardEvent) {
    // Don't intercept keys when typing in textarea/input
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    handleModelKeydown(e);
    handleMemorySelectionKeydown(e);
    handleLoginKeydown(e);
  }

  const messageConfig = {
    user: {
      align: 'justify-end',
      bubble: 'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-br-sm bg-primary text-primary-foreground shadow-sm',
      icon: User,
      iconBg: 'bg-primary',
      iconColor: 'text-primary-foreground',
    },
    assistant: {
      align: 'justify-start',
      bubble: 'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-card text-card-foreground border border-border shadow-sm',
      icon: Bot,
      iconBg: 'bg-secondary border border-border',
      iconColor: 'text-muted-foreground',
    },
    tool_use: {
      align: 'justify-start',
      bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
      icon: Wrench,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-600 dark:text-amber-400',
    },
    tool_result: {
      align: 'justify-start',
      bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
      icon: FileText,
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
    },
    error: {
      align: 'justify-start',
      bubble: 'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-destructive/10 text-destructive border border-destructive/30 shadow-sm',
      icon: AlertCircle,
      iconBg: 'bg-destructive/10',
      iconColor: 'text-destructive',
    },
    system: {
      align: 'justify-center',
      bubble: 'inline-flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 rounded-full border border-border',
      icon: Settings,
      iconBg: 'bg-accent',
      iconColor: 'text-muted-foreground',
    },
    hook_response: {
      align: 'justify-start',
      bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
      icon: Terminal,
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    command_output: {
      align: 'justify-start',
      bubble: 'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-card text-card-foreground border border-border shadow-sm',
      icon: Terminal,
      iconBg: 'bg-accent',
      iconColor: 'text-muted-foreground',
    },
    help_menu: {
      align: 'justify-start',
      bubble: '',
      icon: HelpCircle,
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
    },
  };

  const config = $derived(messageConfig[message.type] || messageConfig.assistant);
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="flex {config.align} gap-3 group">
  {#if message.type !== 'user' && message.type !== 'system' && message.type !== 'help_menu' && !isCompactBoundary && !isLoginPrompt && !isModelPicker && !isMemoryPicker}
    <!-- Avatar -->
    <div class="flex-shrink-0 w-9 h-9 rounded-xl {config.iconBg} flex items-center justify-center mt-0.5">
      <config.icon class="w-4.5 h-4.5 {config.iconColor}" />
    </div>
  {/if}

  <!-- Message Content -->
  <div class="flex flex-col gap-1 {message.type === 'user' ? 'items-end' : 'items-start'} {isCompactBoundary || isLoginPrompt || isModelPicker || isMemoryPicker || message.type === 'help_menu' ? 'w-full' : 'max-w-[85%]'}">
    {#if message.type === 'tool_use' || message.type === 'tool_result'}
      <!-- Tool message - collapsible card -->
      <div class="w-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <button
          class="w-full px-3 py-2.5 text-left cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-2"
          onclick={() => isExpanded = !isExpanded}
        >
          {#if isExpanded}
            <ChevronDown class="w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform" />
          {:else}
            <ChevronRight class="w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform" />
          {/if}
          <span class="font-medium text-foreground text-sm">
            {toolInfo()?.name || 'Tool'}
          </span>
          <!-- Status indicator -->
          {#if toolInfo()?.status === 'pending'}
            <Loader2 class="w-4 h-4 text-amber-500 animate-spin ml-auto" />
          {:else if toolInfo()?.status === 'error'}
            <XCircle class="w-4 h-4 text-destructive ml-auto" />
          {:else}
            <CheckCircle2 class="w-4 h-4 text-emerald-500 ml-auto" />
          {/if}
        </button>

        {#if isExpanded}
          {@const tool = toolInfo()}
          {@const diffInfo = getDiffInfo(tool?.input as Record<string, unknown> | undefined, tool?.name)}
          <div class="p-3 pt-0 space-y-3 border-t border-border">
            <!-- Input: Show diff for file modification tools, JSON for others -->
            {#if isFileDiffTool(tool?.name) && diffInfo}
              {@const totalLines = (diffInfo.oldContent.split('\n').length + diffInfo.newContent.split('\n').length)}
              {@const needsExpansion = totalLines > 8}
              <div class="relative overflow-hidden rounded-lg mt-3" class:max-h-[150px]={needsExpansion && !diffFullyExpanded}>
                <DiffView
                  id={tool?.id || message.id}
                  filePath={diffInfo.filePath}
                  oldContent={diffInfo.oldContent}
                  newContent={diffInfo.newContent}
                />
                {#if needsExpansion && !diffFullyExpanded}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="absolute bottom-0 left-0 right-0 h-[60px] flex items-center justify-center cursor-pointer z-10 bg-gradient-to-b from-transparent via-card/85 to-card/95"
                    onclick={() => diffFullyExpanded = true}
                  >
                    <ChevronDown class="w-6 h-6 p-1 text-muted-foreground bg-muted border border-border rounded-full shadow-sm hover:text-foreground hover:translate-y-0.5 transition-all" />
                  </div>
                {/if}
              </div>
              {#if needsExpansion && diffFullyExpanded}
                <button
                  class="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onclick={() => diffFullyExpanded = false}
                >
                  <ChevronUp class="w-3.5 h-3.5" />
                  <span>Collapse</span>
                </button>
              {/if}
            {:else}
              <div class="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto mt-3">
                <div class="text-muted-foreground text-[10px] uppercase tracking-wide mb-1.5 font-medium">Input</div>
                <pre class="whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(tool?.input, null, 2)}</pre>
              </div>
            {/if}

            <!-- Result (if available) -->
            {#if tool?.result !== undefined && tool?.result !== null}
              <div class="rounded-lg p-3 font-mono text-xs overflow-x-auto {tool?.status === 'error' ? 'bg-destructive/5 border border-destructive/20' : 'bg-emerald-500/5 border border-emerald-500/20'}">
                <div class="text-[10px] uppercase tracking-wide mb-1.5 font-medium {tool?.status === 'error' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}">
                  {tool?.status === 'error' ? 'Error' : 'Result'}
                </div>
                <pre class="whitespace-pre-wrap break-all text-muted-foreground">{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {:else if message.type === 'hook_response'}
      <!-- Hook response - collapsible card -->
      <div class="w-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <button
          class="w-full px-3 py-2.5 text-left cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-2"
          onclick={() => isExpanded = !isExpanded}
        >
          {#if isExpanded}
            <ChevronDown class="w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform" />
          {:else}
            <ChevronRight class="w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform" />
          {/if}
          <span class="font-medium text-foreground text-sm">
            {hookInfo()?.name || 'Hook'}
          </span>
          <!-- Exit code indicator -->
          {#if hookInfo()?.exitCode === 0}
            <CheckCircle2 class="w-4 h-4 text-emerald-500 ml-auto" />
          {:else}
            <XCircle class="w-4 h-4 text-destructive ml-auto" />
          {/if}
          <span class="text-xs text-muted-foreground font-mono">
            exit {hookInfo()?.exitCode}
          </span>
        </button>

        {#if isExpanded}
          {@const hook = hookInfo()}
          <div class="p-3 pt-0 space-y-3 border-t border-border">
            <!-- stdout -->
            {#if hook?.stdout}
              <div class="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 font-mono text-xs overflow-x-auto mt-3">
                <div class="text-emerald-600 dark:text-emerald-400 text-[10px] uppercase tracking-wide mb-1.5 font-medium">stdout</div>
                <pre class="whitespace-pre-wrap break-all text-muted-foreground">{hook.stdout}</pre>
              </div>
            {/if}

            <!-- stderr -->
            {#if hook?.stderr}
              <div class="bg-destructive/5 border border-destructive/20 rounded-lg p-3 font-mono text-xs overflow-x-auto">
                <div class="text-destructive text-[10px] uppercase tracking-wide mb-1.5 font-medium">stderr</div>
                <pre class="whitespace-pre-wrap break-all text-muted-foreground">{hook.stderr}</pre>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {:else if message.type === 'system' && isCompactBoundary}
      <!-- Compact boundary - horizontal divider -->
      <div class="w-full flex items-center gap-3 py-2">
        <div class="flex-1 h-px bg-border"></div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Scissors class="w-3 h-3" />
          <span>Context compacted</span>
          {#if message.metadata?.preTokens}
            <span class="text-muted-foreground">({message.metadata.preTokens.toLocaleString()} tokens)</span>
          {/if}
        </div>
        <div class="flex-1 h-px bg-border"></div>
      </div>
    {:else if message.type === 'system' && isLoginPrompt}
      <!-- Login prompt - two states: active (form) or inactive (compact) -->
      {#if isLoginActive}
        <!-- Active: Show full login form -->
        <div class="w-full max-w-md">
          <div class="border border-dotted border-border rounded-lg p-5 bg-card space-y-4">
            <!-- Header -->
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <KeyRound class="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 class="font-sans font-semibold text-foreground text-lg leading-tight">Login to Claude</h3>
                <p class="text-sm text-muted-foreground mt-0.5">Authenticate with your Claude MAX subscription</p>
              </div>
            </div>

            <!-- Step 1: Open auth page -->
            {#if message.metadata?.authUrl}
              <div class="space-y-2">
                <div class="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
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
              <div class="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
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
                  class="w-full px-4 py-2.5 bg-background border border-border rounded-md text-sm font-mono
                         placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                />
              </div>
              <p class="text-xs text-muted-foreground">
                After authorizing, you'll see a code like <code class="px-1 py-0.5 bg-muted rounded text-[11px]">abc123#xyz789</code>
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
                class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Inactive: Show compact dismissible version -->
        <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-dotted border-border rounded-lg text-sm group">
          <KeyRound class="w-3.5 h-3.5 text-muted-foreground" />
          <span class="text-muted-foreground">Login attempted</span>
          <span class="text-muted-foreground font-mono text-xs">•••••••#•••</span>
          {#if onDismissMessage}
            <button
              onclick={onDismissMessage}
              class="ml-1 p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
              title="Dismiss"
            >
              <XCircle class="w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground" />
            </button>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'system' && isModelPicker}
      <!-- Model Picker - inline form like login -->
      {#if isModelPickerActive}
        <!-- Active: Show model picker form -->
        <div class="w-full max-w-md">
          <div class="border border-dotted border-border rounded-lg p-5 bg-card space-y-4">
            <!-- Header -->
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center flex-shrink-0">
                <Cpu class="w-5 h-5 text-secondary" />
              </div>
              <div>
                <h3 class="font-sans font-semibold text-foreground text-lg leading-tight">Switch Model</h3>
                <p class="text-sm text-muted-foreground mt-0.5">Select a model for this session</p>
              </div>
            </div>

            <!-- Model list -->
            {#if message.metadata?.loading}
              <div class="flex items-center justify-center py-6">
                <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
                <span class="ml-2 text-sm text-muted-foreground">Loading models...</span>
              </div>
            {:else if message.metadata?.error}
              <div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
                <AlertCircle class="w-4 h-4 flex-shrink-0" />
                <span>{message.metadata.error}</span>
              </div>
            {:else if models.length === 0}
              <div class="text-center py-6 text-sm text-muted-foreground">
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
                        : 'hover:bg-accent border border-transparent'}"
                    onclick={() => selectedModel = model.value}
                  >
                    <div class="flex-shrink-0 w-5 h-5 mt-0.5">
                      {#if selectedModel === model.value}
                        <Check class="w-5 h-5 text-secondary" />
                      {/if}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-foreground text-sm">{model.displayName}</span>
                        {#if currentModel === model.value}
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary uppercase tracking-wide">current</span>
                        {/if}
                      </div>
                      <p class="text-xs text-muted-foreground mt-0.5 line-clamp-2">{model.description}</p>
                    </div>
                  </button>
                {/each}
              </div>
              <p class="text-xs text-muted-foreground text-center">
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
                class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Inactive: Show compact version -->
        <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-dotted border-border rounded-lg text-sm group">
          <Cpu class="w-3.5 h-3.5 text-muted-foreground" />
          <span class="text-muted-foreground">Model selection</span>
          {#if message.metadata?.selectedModel}
            <span class="text-muted-foreground text-xs">{message.metadata.selectedModel}</span>
          {/if}
          {#if onDismissMessage}
            <button
              onclick={onDismissMessage}
              class="ml-1 p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
              title="Dismiss"
            >
              <XCircle class="w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground" />
            </button>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'system' && isMemoryPicker}
      <!-- Memory Picker - selection then inline editor -->
      {#if isMemoryPickerActive}
        <!-- Active: Show memory picker or editor -->
        <div class="w-full max-w-lg">
          <div class="border border-dotted border-border rounded-lg p-5 bg-card space-y-4">
            <!-- Header -->
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <BookOpen class="w-5 h-5 text-amber-600" />
              </div>
              <div class="flex-1">
                <h3 class="font-sans font-semibold text-foreground text-lg leading-tight">Edit Memory</h3>
                <p class="text-sm text-muted-foreground mt-0.5">
                  {#if message.metadata?.memoryPhase === 'editing'}
                    Editing {message.metadata?.selectedMemoryType === 'project' ? 'project' : 'user'} memory
                  {:else}
                    Select memory to edit
                  {/if}
                </p>
              </div>
            </div>

            {#if message.metadata?.loading}
              <!-- Loading state -->
              <div class="flex items-center justify-center py-6">
                <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
                <span class="ml-2 text-sm text-muted-foreground">Loading memory...</span>
              </div>
            {:else if message.metadata?.error}
              <!-- Error state -->
              <div class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2">
                <AlertCircle class="w-4 h-4 flex-shrink-0" />
                <span>{message.metadata.error}</span>
              </div>
            {:else if message.metadata?.memoryPhase === 'editing'}
              <!-- Editor phase -->
              <div
                class="space-y-3"
                role="group"
                aria-label="Memory editor"
              >
                <div class="flex items-center gap-2 text-xs text-muted-foreground">
                  {#if message.metadata?.selectedMemoryType === 'project'}
                    <FolderOpen class="w-3.5 h-3.5" />
                    <code class="font-mono bg-muted px-1.5 py-0.5 rounded">{message.metadata?.memoryPath || './CLAUDE.md'}</code>
                  {:else}
                    <Home class="w-3.5 h-3.5" />
                    <code class="font-mono bg-muted px-1.5 py-0.5 rounded">~/.claude/CLAUDE.md</code>
                  {/if}
                </div>
                <textarea
                  use:autofocus
                  class="w-full h-64 px-3 py-2 bg-background border border-border rounded-lg font-mono text-sm
                         placeholder:text-muted-foreground focus:outline-none focus:border-border focus:ring-0
                         resize-y transition-colors"
                  placeholder="# Memory instructions for Claude..."
                  value={message.metadata?.memoryContent || ''}
                  oninput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    if (target) memoryContent = target.value;
                  }}
                  onkeydown={handleMemoryEditorKeydown}
                ></textarea>
                <p class="text-xs text-muted-foreground">
                  Markdown format. Changes will be saved to the file on the agent.
                </p>
              </div>

              <!-- Editor Actions -->
              <div class="flex items-center gap-3 pt-1">
                <button
                  onclick={handleMemorySave}
                  disabled={memorySaving}
                  class="flex items-center gap-2 px-4 py-2 bg-[#37352f] text-white rounded-md text-sm font-medium
                         hover:bg-[#2f2d29] disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
                >
                  {#if memorySaving}
                    <Loader2 class="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  {:else}
                    <Check class="w-4 h-4" />
                    <span>Save</span>
                  {/if}
                </button>
                <button
                  onclick={onMemoryCancel}
                  disabled={memorySaving}
                  class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            {:else}
              <!-- Selection phase -->
              <div
                class="space-y-2 outline-none"
                tabindex="-1"
                use:autofocus
                onkeydown={handleMemorySelectionKeydown}
                role="listbox"
                aria-label="Memory location selection"
              >
                <button
                  type="button"
                  class="w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-start gap-3 group
                    {selectedMemoryOption === 'project'
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-border hover:border-amber-500/50 hover:bg-amber-500/5'}"
                  onclick={() => onMemorySelect?.('project')}
                  onmouseenter={() => selectedMemoryOption = 'project'}
                >
                  <div class="flex-shrink-0 w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center mt-0.5">
                    <FolderOpen class="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-foreground text-sm">Project memory</span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">1</span>
                    </div>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      Checked in at <code class="px-1 py-0.5 bg-muted rounded">./CLAUDE.md</code>
                    </p>
                  </div>
                  <ArrowRight class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                </button>

                <button
                  type="button"
                  class="w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-start gap-3 group
                    {selectedMemoryOption === 'user'
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-border hover:border-amber-500/50 hover:bg-amber-500/5'}"
                  onclick={() => onMemorySelect?.('user')}
                  onmouseenter={() => selectedMemoryOption = 'user'}
                >
                  <div class="flex-shrink-0 w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center mt-0.5">
                    <Home class="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-foreground text-sm">User memory</span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">2</span>
                    </div>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      Saved in <code class="px-1 py-0.5 bg-muted rounded">~/.claude/CLAUDE.md</code>
                    </p>
                  </div>
                  <ArrowRight class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                </button>
              </div>

              <!-- Cancel button for selection phase -->
              <div class="flex justify-end pt-1">
                <button
                  onclick={onMemoryCancel}
                  class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- Inactive: Show compact version -->
        <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-dotted border-border rounded-lg text-sm group">
          <BookOpen class="w-3.5 h-3.5 text-muted-foreground" />
          <span class="text-muted-foreground">Memory</span>
          {#if message.metadata?.selectedMemoryType}
            <span class="text-muted-foreground text-xs capitalize">{message.metadata.selectedMemoryType}</span>
          {/if}
          {#if onDismissMessage}
            <button
              onclick={onDismissMessage}
              class="ml-1 p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
              title="Dismiss"
            >
              <XCircle class="w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground" />
            </button>
          {/if}
        </div>
      {/if}
    {:else if message.type === 'command_output'}
      <!-- Command output (like /help) - rendered with markdown and terminal styling -->
      <div class="chat-bubble chat-bubble-assistant relative bg-muted border border-border">
        {#if message.metadata?.command}
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 pb-2 border-b border-border">
            <Terminal class="w-3 h-3" />
            <code class="font-mono">{message.metadata.command}</code>
          </div>
        {/if}
        <div class="prose prose-sm max-w-none [&_pre]:bg-muted [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
          <Markdown source={message.content} options={{ breaks: true }} />
        </div>
      </div>
    {:else if message.type === 'help_menu'}
      <!-- Help menu with tabs (Claude CLI-style) -->
      <div class="w-full max-w-2xl">
        <HelpMenu
          version={message.metadata?.version || 'unknown'}
          commands={message.metadata?.commands || []}
          onClose={onDismissMessage}
        />
      </div>
    {:else if message.type === 'system'}
      <!-- Simple system message - subtle banner -->
      <div class="{config.bubble}">
        <Settings class="w-3 h-3" />
        <span>{message.content}</span>
      </div>
    {:else}
      <!-- Regular message with markdown support -->
      {#if message.type === 'user' && isEditing}
        <!-- User message in edit mode -->
        <div class="w-full max-w-[85%]">
          <div class="bg-card border border-primary/30 rounded-lg p-3 space-y-3">
            <textarea
              class="w-full min-h-[80px] px-3 py-2 bg-background border border-border rounded-lg text-sm
                     placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20
                     resize-y transition-colors"
              placeholder="Edit your message..."
              bind:value={editContent}
              onkeydown={handleEditKeydown}
              disabled={editLoading}
            ></textarea>
            <div class="flex items-center justify-between">
              <p class="text-xs text-muted-foreground">
                This will restart the conversation from this point
              </p>
              <div class="flex items-center gap-2">
                <button
                  onclick={cancelEditing}
                  disabled={editLoading}
                  class="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onclick={submitEdit}
                  disabled={!editContent.trim() || editLoading}
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-medium
                         hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {#if editLoading}
                    <Loader2 class="w-3.5 h-3.5 animate-spin" />
                  {:else}
                    <Check class="w-3.5 h-3.5" />
                  {/if}
                  <span>Submit</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="{config.bubble} relative">
          <div class="prose prose-sm max-w-none {message.type === 'user' ? 'prose-invert' : ''} [&_pre]:bg-muted [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
            <Markdown source={message.content} />
          </div>

          <!-- Action buttons -->
          <div class="absolute -right-2 -top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {#if message.type === 'user' && canEdit && onEditMessage}
              <!-- Edit button for user messages -->
              <button
                class="p-1.5 rounded-md bg-card border border-border shadow-sm hover:bg-accent"
                onclick={startEditing}
                title="Edit message and restart from here"
              >
                <Edit3 class="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            {/if}
            <!-- Copy button -->
            <CopyButton
              text={message.content}
              variant="ghost"
              size="icon-sm"
              class="p-1.5 h-auto w-auto rounded-md bg-card border border-border shadow-sm hover:bg-accent [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:text-muted-foreground"
            />
          </div>
        </div>
      {/if}
    {/if}

    <!-- Timestamp (shown on hover) -->
    {#if message.timestamp}
      <span class="text-[10px] text-muted-foreground mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {formatTimestamp(new Date(message.timestamp))}
      </span>
    {/if}
  </div>

  {#if message.type === 'user'}
    <!-- User Avatar -->
    <div class="flex-shrink-0 w-9 h-9 rounded-xl {config.iconBg} flex items-center justify-center mt-0.5">
      <config.icon class="w-4.5 h-4.5 {config.iconColor}" />
    </div>
  {/if}
</div>

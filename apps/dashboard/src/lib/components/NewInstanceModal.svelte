<script lang="ts">
  import Modal from "./Modal.svelte";
  import AuthRequiredModal from "./AuthRequiredModal.svelte";
  import FileBrowser from "./FileBrowser.svelte";
  import EnvVarsEditor from "./EnvVarsEditor.svelte";
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { Input } from '$lib/components/ui/input';
  import { Folder, ChevronDown } from 'lucide-svelte';
  import { agents, projects } from "$lib/stores";
  import { spawnInstance } from "$lib/actions";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open = $bindable(), onClose }: Props = $props();

  // Basic fields
  let machineId = $state("");
  let cwd = $state("");
  let projectId = $state("");
  let prompt = $state("");
  let loading = $state(false);
  let error = $state("");
  let showAuthModal = $state(false);
  let authError = $state("");
  let showFileBrowser = $state(false);

  // Permission mode options
  let showAdvanced = $state(false);
  let bypassPermissions = $state(false);
  let planMode = $state(false);
  let acceptEdits = $state(false);
  let enableThinking = $state(true);

  // Session limits
  let maxTurns = $state<number | undefined>(undefined);
  let maxBudgetUsd = $state<number | undefined>(undefined);

  // System prompt
  let systemPrompt = $state("");

  // Environment variables
  let envVars = $state<Record<string, string>>({});

  // Tool restrictions
  let allowedToolsInput = $state("");
  let disallowedToolsInput = $state("");

  // Get selected agent and pre-fill defaultCwd if available
  let selectedAgent = $derived(agents.get(machineId));

  // When agent changes, pre-fill cwd from agent's defaultCwd
  $effect(() => {
    if (selectedAgent?.defaultCwd && !cwd) {
      cwd = selectedAgent.defaultCwd;
    }
  });

  // Get online agents
  $effect(() => {
    const onlineAgents = agents.online;
    if (onlineAgents.length > 0 && !machineId) {
      machineId = onlineAgents[0].machineId;
    }
  });

  // Get selected agent name for auth modal
  let selectedAgentName = $derived(selectedAgent?.name || "the agent");

  // Parse tool lists from comma-separated strings
  function parseToolList(input: string): string[] | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    return trimmed.split(',').map(t => t.trim()).filter(Boolean);
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = "";

    if (!machineId) {
      error = "Please select a machine";
      return;
    }

    if (!cwd) {
      error = "Working directory is required";
      return;
    }

    loading = true;

    // Determine permission mode (only one can be active)
    let permissionMode: string | undefined;
    if (bypassPermissions) {
      permissionMode = 'bypassPermissions';
    } else if (planMode) {
      permissionMode = 'plan';
    } else if (acceptEdits) {
      permissionMode = 'acceptEdits';
    }

    // Filter out empty env vars
    const filteredEnvVars = Object.keys(envVars).length > 0
      ? Object.fromEntries(Object.entries(envVars).filter(([k, v]) => k.trim()))
      : undefined;

    const result = await spawnInstance({
      machineId,
      cwd,
      projectId: projectId || undefined,
      prompt: prompt || undefined,
      permissionMode,
      enableThinking,
      maxTurns: maxTurns || undefined,
      maxBudgetUsd: maxBudgetUsd || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      envVars: filteredEnvVars,
      allowedTools: parseToolList(allowedToolsInput),
      disallowedTools: parseToolList(disallowedToolsInput),
    });

    loading = false;

    if (result.success) {
      // Reset form and close
      resetForm();
      onClose();
    } else if (result.authRequired) {
      // Show auth modal instead of error
      authError = result.error || "";
      showAuthModal = true;
    } else {
      error = result.error || "Failed to spawn instance";
    }
  }

  function resetForm() {
    machineId = "";
    cwd = "";
    projectId = "";
    prompt = "";
    showAdvanced = false;
    bypassPermissions = false;
    planMode = false;
    acceptEdits = false;
    enableThinking = true;
    maxTurns = undefined;
    maxBudgetUsd = undefined;
    systemPrompt = "";
    envVars = {};
    allowedToolsInput = "";
    disallowedToolsInput = "";
  }

  function handleClose() {
    error = "";
    showFileBrowser = false;
    onClose();
  }

  function handlePathSelect(path: string) {
    cwd = path;
    showFileBrowser = false;
  }

  function openFileBrowser() {
    if (machineId) {
      showFileBrowser = true;
    }
  }

  // Handle permission mode mutual exclusivity
  function setPermissionMode(mode: 'bypass' | 'plan' | 'acceptEdits' | 'default') {
    bypassPermissions = mode === 'bypass';
    planMode = mode === 'plan';
    acceptEdits = mode === 'acceptEdits';
  }
</script>

<Modal {open} title="New Instance" onClose={handleClose}>
  <form onsubmit={handleSubmit} class="space-y-5 max-h-[70vh] overflow-y-auto pr-2">
      {#if error}
        <div
          class="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm"
        >
          <svg
            class="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{error}</span>
        </div>
      {/if}

      <div class="space-y-1.5">
        <label for="agent" class="block text-sm font-medium text-foreground">
          Machine <span class="text-error">*</span>
        </label>
        <select id="agent" bind:value={machineId} class="input">
          <option value="">Select a machine...</option>
          {#each agents.online as agent (agent.machineId)}
            <option value={agent.machineId}>{agent.name} ({agent.os})</option>
          {/each}
        </select>
        {#if agents.online.length === 0}
          <p class="text-xs text-muted-foreground italic">
            No machines online. Start an agent with <code
              class="px-1 bg-accent rounded text-[10px]">agentdeck agent</code
            >
          </p>
        {/if}
      </div>

      <div class="space-y-1.5">
        <label for="cwd" class="block text-sm font-medium text-foreground">
          Working Directory <span class="text-error">*</span>
          {#if selectedAgent?.defaultCwd && cwd === selectedAgent.defaultCwd}
            <span class="text-xs text-muted-foreground ml-1">(agent default)</span>
          {/if}
        </label>
        {#if showFileBrowser && machineId}
          <div
            class="h-80 rounded-lg border border-border overflow-hidden bg-background"
          >
            <FileBrowser
              {machineId}
              initialPath={cwd || undefined}
              onSelect={handlePathSelect}
            />
          </div>
          <Button
            variant="link"
            size="sm"
            class="mt-2"
            onclick={() => (showFileBrowser = false)}
          >
            Cancel browsing
          </Button>
        {:else}
          <div class="flex gap-2">
            <input
              id="cwd"
              type="text"
              bind:value={cwd}
              placeholder="/path/to/project"
              class="input font-mono"
            />
            <Button
              variant="outline"
              size="icon"
              onclick={openFileBrowser}
              disabled={!machineId}
              title={machineId
                ? "Browse files on machine"
                : "Select a machine first"}
              aria-label="Browse files"
            >
              <Folder class="size-5" />
            </Button>
          </div>
        {/if}
      </div>

      <div class="space-y-1.5">
        <label for="project" class="block text-sm font-medium text-foreground">
          Project <span class="text-muted-foreground font-normal text-xs"
            >(optional)</span
          >
        </label>
        <select id="project" bind:value={projectId} class="input">
          <option value="">No project</option>
          {#each projects.sorted as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="prompt" class="block text-sm font-medium text-foreground">
          Initial Prompt <span class="text-muted-foreground font-normal text-xs"
            >(optional)</span
          >
        </label>
        <textarea
          id="prompt"
          bind:value={prompt}
          placeholder="What would you like Claude to do?"
          rows="3"
          class="input resize-none"
        ></textarea>
      </div>

      <!-- Advanced Options -->
      <div class="border-t border-border pt-4">
        <button
          type="button"
          class="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onclick={() => (showAdvanced = !showAdvanced)}
        >
          <ChevronDown
            class="size-4 transition-transform {showAdvanced ? 'rotate-180' : ''}"
          />
          Advanced Options
        </button>

        {#if showAdvanced}
          <div class="mt-4 space-y-6 pl-2">
            <!-- Permission Modes Section -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-foreground">Permission Mode</h4>

              <!-- Bypass Permissions -->
              <div class="flex items-center justify-between pl-4">
                <div>
                  <label for="bypass-permissions" class="text-sm font-medium text-foreground">
                    Bypass Permissions
                  </label>
                  <p class="text-xs text-muted-foreground">
                    Skip all permission prompts (use with caution)
                  </p>
                </div>
                <Switch
                  id="bypass-permissions"
                  checked={bypassPermissions}
                  onCheckedChange={(checked) => {
                    if (checked) setPermissionMode('bypass');
                    else setPermissionMode('default');
                  }}
                />
              </div>

              <!-- Accept Edits -->
              <div class="flex items-center justify-between pl-4">
                <div>
                  <label for="accept-edits" class="text-sm font-medium text-foreground">
                    Accept Edits
                  </label>
                  <p class="text-xs text-muted-foreground">
                    Auto-accept file edits, prompt for other tools
                  </p>
                </div>
                <Switch
                  id="accept-edits"
                  checked={acceptEdits}
                  disabled={bypassPermissions}
                  onCheckedChange={(checked) => {
                    if (checked) setPermissionMode('acceptEdits');
                    else setPermissionMode('default');
                  }}
                />
              </div>

              <!-- Plan Mode -->
              <div class="flex items-center justify-between pl-4">
                <div>
                  <label for="plan-mode" class="text-sm font-medium text-foreground">
                    Plan Mode
                  </label>
                  <p class="text-xs text-muted-foreground">
                    Claude plans before executing any actions
                  </p>
                </div>
                <Switch
                  id="plan-mode"
                  checked={planMode}
                  disabled={bypassPermissions}
                  onCheckedChange={(checked) => {
                    if (checked) setPermissionMode('plan');
                    else setPermissionMode('default');
                  }}
                />
              </div>
            </div>

            <!-- Thinking Toggle -->
            <div class="flex items-center justify-between">
              <div>
                <label for="thinking" class="text-sm font-medium text-foreground">
                  Extended Thinking
                </label>
                <p class="text-xs text-muted-foreground">
                  Enable Claude's thinking process for complex tasks
                </p>
              </div>
              <Switch
                id="thinking"
                checked={enableThinking}
                onCheckedChange={(checked) => (enableThinking = checked)}
              />
            </div>

            <!-- Session Limits Section -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-foreground">Session Limits</h4>

              <div class="grid grid-cols-2 gap-4 pl-4">
                <!-- Max Turns -->
                <div class="space-y-1.5">
                  <label for="max-turns" class="text-sm text-muted-foreground">
                    Max Turns
                  </label>
                  <Input
                    id="max-turns"
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    value={maxTurns ?? ''}
                    oninput={(e) => {
                      const val = e.currentTarget.valueAsNumber;
                      maxTurns = Number.isNaN(val) ? undefined : val;
                    }}
                  />
                </div>

                <!-- Max Budget -->
                <div class="space-y-1.5">
                  <label for="max-budget" class="text-sm text-muted-foreground">
                    Max Budget (USD)
                  </label>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="max-budget"
                      type="number"
                      min="0"
                      step="0.01"
                      class="pl-7"
                      placeholder="Unlimited"
                      value={maxBudgetUsd ?? ''}
                      oninput={(e) => {
                        const val = e.currentTarget.valueAsNumber;
                        maxBudgetUsd = Number.isNaN(val) ? undefined : val;
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- System Prompt Section -->
            <div class="space-y-2">
              <label for="system-prompt" class="text-sm font-medium text-foreground">
                Custom System Prompt <span class="text-muted-foreground font-normal text-xs">(optional)</span>
              </label>
              <textarea
                id="system-prompt"
                bind:value={systemPrompt}
                placeholder="Additional instructions to add to Claude's system prompt..."
                rows="3"
                class="input resize-none text-sm font-mono"
              ></textarea>
            </div>

            <!-- Tool Restrictions Section -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-foreground">Tool Restrictions</h4>

              <div class="space-y-3 pl-4">
                <div class="space-y-1.5">
                  <label for="allowed-tools" class="text-sm text-muted-foreground">
                    Allowed Tools <span class="text-xs">(comma-separated)</span>
                  </label>
                  <Input
                    id="allowed-tools"
                    type="text"
                    class="font-mono text-sm"
                    placeholder="Read, Glob, Grep..."
                    bind:value={allowedToolsInput}
                  />
                </div>

                <div class="space-y-1.5">
                  <label for="disallowed-tools" class="text-sm text-muted-foreground">
                    Disallowed Tools <span class="text-xs">(comma-separated)</span>
                  </label>
                  <Input
                    id="disallowed-tools"
                    type="text"
                    class="font-mono text-sm"
                    placeholder="Bash, Write..."
                    bind:value={disallowedToolsInput}
                  />
                </div>
              </div>
            </div>

            <!-- Environment Variables Section -->
            <div class="space-y-2">
              <h4 class="text-sm font-medium text-foreground">Environment Variables</h4>
              <div class="pl-4">
                <EnvVarsEditor bind:value={envVars} />
              </div>
            </div>
          </div>
        {/if}
      </div>

      <div class="flex gap-3 pt-2 sticky bottom-0 bg-background pb-1">
        <Button
          type="button"
          variant="secondary"
          onclick={handleClose}
          class="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading || !machineId || !cwd}
          class="flex-1"
        >
          {#if loading}
            <svg class="size-4 animate-spin" viewBox="0 0 24 24"
              ><circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle><path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path></svg
            >
            <span>Starting...</span>
          {:else}
            <span>Start Instance</span>
          {/if}
        </Button>
      </div>
  </form>
</Modal>

<AuthRequiredModal
  bind:open={showAuthModal}
  onClose={() => (showAuthModal = false)}
  agentName={selectedAgentName}
  error={authError}
/>

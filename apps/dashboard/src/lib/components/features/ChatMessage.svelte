<script lang="ts">
	import {
		User,
		Wrench,
		FileText,
		CircleAlert,
		ChevronDown,
		ChevronRight,
		ChevronUp,
		LoaderCircle,
		CircleCheck,
		CircleX,
		Settings,
		Terminal,
		CircleQuestionMark,
		Pencil,
		Check,
		Bot,
		RotateCcw,
		Download,
		AlertTriangle,
	} from '@lucide/svelte';
	import Markdown from '@humanspeak/svelte-markdown';
	import { formatTimestamp } from '$lib/utils/time';
	import type { Message } from '$lib/cockpit/types';
	import HelpMenu from './HelpMenu.svelte';
	import DiffView from './DiffView.svelte';
	import { CopyButton } from '$lib/components/ui/copy-button';
	import { getRenderer, type MessageRendererProps } from './message-renderers';
	import MCPStatus from './message-renderers/MCPStatus.svelte';

	interface Props {
		message: Message;
		instanceId?: string;
		showTimestamp?: boolean;
		onLoginSubmit?: (code: string) => Promise<void>;
		onLoginCancel?: () => void;
		onModelSelect?: (model: string) => Promise<void>;
		onModelCancel?: () => void;
		onMemorySelect?: (memoryType: 'project' | 'user') => void;
		onMemorySave?: (content: string) => Promise<void>;
		onMemoryCancel?: () => void;
		onQuestionSubmit?: (requestId: string, answers: Record<string, string>) => Promise<void>;
		onQuestionCancel?: () => void;
		onDismissMessage?: () => void;
		/** Callback when user wants to edit this message and continue from here */
		onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
		/** Whether this login prompt is currently active (pending) */
		isLoginActive?: boolean;
		/** Whether this model picker is currently active */
		isModelPickerActive?: boolean;
		/** Whether this memory picker is currently active */
		isMemoryPickerActive?: boolean;
		/** Whether the question picker is currently active */
		isQuestionPickerActive?: boolean;
		/** Whether editing is supported for this message */
		canEdit?: boolean;
		/** Callback to reset session and start fresh (for session_error recovery) */
		onResetSession?: () => Promise<void>;
		/** Callback to download chat transcript */
		onDownloadTranscript?: () => void;
	}

	let {
		message,
		instanceId = '',
		showTimestamp = false,
		onLoginSubmit,
		onLoginCancel,
		onModelSelect,
		onModelCancel,
		onMemorySelect,
		onMemorySave,
		onMemoryCancel,
		onQuestionSubmit,
		onQuestionCancel,
		onDismissMessage,
		onEditMessage,
		onResetSession,
		onDownloadTranscript,
		isLoginActive = false,
		isModelPickerActive = false,
		isMemoryPickerActive = false,
		isQuestionPickerActive = false,
		canEdit = false
	}: Props = $props();

	// Check if this message has a specialized renderer
	const renderer = $derived(getRenderer(message));

	// Determine if a specialized renderer is active
	const rendererIsActive = $derived.by(() => {
		if (!renderer) return false;
		if (renderer.name === 'LoginPrompt') return isLoginActive;
		if (renderer.name === 'ModelPicker') return isModelPickerActive;
		if (renderer.name === 'MemoryPicker') return isMemoryPickerActive;
		if (renderer.name === 'AskQuestionPicker') return isQuestionPickerActive;
		return false;
	});

	// Props to pass to specialized renderers
	const rendererProps = $derived<MessageRendererProps>({
		message,
		instanceId,
		isActive: rendererIsActive,
		showTimestamp,
		onLoginSubmit,
		onLoginCancel,
		onModelSelect,
		onModelCancel,
		onMemorySelect,
		onMemorySave,
		onMemoryCancel,
		onQuestionSubmit,
		onQuestionCancel,
		onDismissMessage
	});

	// Auto-expand for diff tools, collapsed for others
	const hasDiff = $derived.by(() => {
		if (message.type !== 'tool.use' && message.type !== 'tool.result') return false;
		const toolName = message.metadata?.toolName;
		if (!toolName) return false;
		const diffTools = [
			'Edit',
			'edit',
			'str_replace_editor',
			'str_replace',
			'file_edit',
			'Write',
			'write',
			'create_file',
			'write_file'
		];
		return diffTools.includes(toolName);
	});

	let diffFullyExpanded = $state(false);
	// Track manual override of expansion state. Null means "auto" (based on hasDiff), otherwise use the boolean value
	let manualExpansion = $state<boolean | null>(null);
	// isExpanded: use manual override if set, otherwise auto-expand for diff tools
	const isExpanded = $derived(manualExpansion ?? hasDiff);

	function toggleExpanded() {
		// When user manually toggles, override the auto-expansion
		manualExpansion = !isExpanded;
	}

	// Message editing state
	let isEditing = $state(false);
	let editContent = $state('');
	let resettingSession = $state(false);
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

	// Get tool info from metadata
	const toolInfo = $derived.by(() => {
		if (message.type !== 'tool.use' && message.type !== 'tool.result') return null;
		if (!message.metadata?.toolName) return null;

		return {
			name: message.metadata.toolName,
			id: message.metadata.toolId,
			input: message.metadata.toolInput,
			result: message.metadata.toolResult,
			status: message.metadata.toolStatus || 'pending'
		};
	});

	// Get hook info from metadata
	const hookInfo = $derived.by(() => {
		if (message.type !== 'system.hook_response') return null;
		return {
			name: message.metadata?.hookName || 'Hook',
			exitCode: message.metadata?.exitCode ?? 0,
			stdout: message.metadata?.stdout,
			stderr: message.metadata?.stderr
		};
	});

	// Check if a tool is a file modification tool that should show a diff
	function isFileDiffTool(toolName: string | undefined): boolean {
		if (!toolName) return false;
		const diffTools = [
			// Edit tools (partial file modification)
			'Edit',
			'edit',
			'str_replace_editor',
			'str_replace',
			'file_edit',
			// Write tools (full file write)
			'Write',
			'write',
			'create_file',
			'write_file'
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
	function getDiffInfo(
		input: Record<string, unknown> | undefined,
		toolName: string | undefined
	): { filePath: string; oldContent: string; newContent: string } | null {
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

	const messageConfig = {
		user: {
			align: 'justify-end',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-br-sm bg-primary text-primary-foreground shadow-sm',
			icon: User,
			iconBg: 'bg-primary',
			iconColor: 'text-primary-foreground'
		},
		assistant: {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-card text-card-foreground border border-border shadow-sm',
			icon: Bot,
			iconBg: 'bg-secondary border border-border',
			iconColor: 'text-muted-foreground'
		},
		'tool.use': {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
			icon: Wrench,
			iconBg: 'bg-warning/10',
			iconColor: 'text-warning'
		},
		'tool.result': {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
			icon: FileText,
			iconBg: 'bg-success/10',
			iconColor: 'text-success'
		},
		'ui.error': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-destructive/10 text-destructive border border-destructive/30 shadow-sm',
			icon: CircleAlert,
			iconBg: 'bg-destructive/10',
			iconColor: 'text-destructive'
		},
		'ui.session_error': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-warning/10 text-warning border border-warning/30 shadow-sm',
			icon: AlertTriangle,
			iconBg: 'bg-warning/10',
			iconColor: 'text-warning'
		},
		system: {
			align: 'justify-center',
			bubble:
				'inline-flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 rounded-full border border-border',
			icon: Settings,
			iconBg: 'bg-accent',
			iconColor: 'text-muted-foreground'
		},
		'system.hook_response': {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
			icon: Terminal,
			iconBg: 'bg-info/10',
			iconColor: 'text-info'
		},
		'ui.command_output': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-card text-card-foreground border border-border shadow-sm',
			icon: Terminal,
			iconBg: 'bg-accent',
			iconColor: 'text-muted-foreground'
		},
		'ui.help_menu': {
			align: 'justify-start',
			bubble: '',
			icon: CircleQuestionMark,
			iconBg: 'bg-primary/10',
			iconColor: 'text-primary'
		},
		thinking: {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-muted/50 border border-border shadow-sm',
			icon: Bot,
			iconBg: 'bg-accent',
			iconColor: 'text-muted-foreground'
		},
		'result.error': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-destructive/10 text-destructive border border-destructive/30 shadow-sm',
			icon: CircleAlert,
			iconBg: 'bg-destructive/10',
			iconColor: 'text-destructive'
		}
	};

	const config = $derived(
		messageConfig[message.type as keyof typeof messageConfig] ||
		(message.type.startsWith('system.') ? messageConfig.system : messageConfig.assistant)
	);
</script>

<!-- If there's a specialized renderer, use it -->
{#if renderer}
	<renderer.component {...rendererProps} />
{:else}
	<!-- Default rendering logic -->
	<div class="flex {config.align} gap-3 group">
		{#if message.type !== 'user' && !message.type.startsWith('system.') && message.type !== 'ui.help_menu'}
			<!-- Avatar -->
			<div
				class="shrink-0 size-9 rounded-xl {config.iconBg} flex items-center justify-center mt-0.5"
			>
				{#if message.type === 'assistant'}
					<Bot size={18} color="var(--muted-foreground)" class="!flex leading-[0]" />
				{:else}
					<config.icon class="size-[18px] {config.iconColor}" />
				{/if}
			</div>
		{/if}

		<!-- Message Content -->
		<div
			class="flex flex-col gap-1 {message.type === 'user'
				? 'items-end'
				: 'items-start'} {message.type === 'ui.help_menu' ? 'w-full' : 'max-w-[85%]'}"
		>
			{#if message.type === 'tool.use' || message.type === 'tool.result'}
				<!-- Tool message - collapsible card -->
				<div class="w-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
					<button
						class="w-full px-3 py-2.5 text-left cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-2"
						onclick={toggleExpanded}
					>
						{#if isExpanded}
							<ChevronDown
								class="w-4 h-4 text-muted-foreground shrink-0 transition-transform"
							/>
						{:else}
							<ChevronRight
								class="w-4 h-4 text-muted-foreground shrink-0 transition-transform"
							/>
						{/if}
						<span class="font-medium text-foreground text-sm">
							{toolInfo?.name || 'Tool'}
						</span>
						<!-- Status indicator -->
						{#if toolInfo?.status === 'pending'}
							<LoaderCircle class="w-4 h-4 text-warning animate-spin ml-auto" />
						{:else if toolInfo?.status === 'error'}
							<CircleX class="w-4 h-4 text-destructive ml-auto" />
						{:else}
							<CircleCheck class="w-4 h-4 text-success ml-auto" />
						{/if}
					</button>

					{#if isExpanded}
						{@const tool = toolInfo}
						{@const diffInfo = getDiffInfo(
							tool?.input as Record<string, unknown> | undefined,
							tool?.name
						)}
						<div class="p-3 pt-0 space-y-3 border-t border-border">
							<!-- Input: Show diff for file modification tools, JSON for others -->
							{#if isFileDiffTool(tool?.name) && diffInfo}
								{@const totalLines =
									diffInfo.oldContent.split('\n').length + diffInfo.newContent.split('\n').length}
								{@const needsExpansion = totalLines > 8}
								<div
									class="relative overflow-hidden rounded-lg mt-3"
									class:max-h-[150px]={needsExpansion && !diffFullyExpanded}
								>
									<DiffView
										filePath={diffInfo.filePath}
										oldContent={diffInfo.oldContent}
										newContent={diffInfo.newContent}
									/>
									{#if needsExpansion && !diffFullyExpanded}
										<button
											type="button"
											aria-label="Show full diff"
											class="absolute bottom-0 left-0 right-0 h-[60px] flex items-center justify-center cursor-pointer z-10 bg-gradient-to-b from-transparent via-card/85 to-card/95"
											onclick={() => (diffFullyExpanded = true)}
										>
											<ChevronDown
												class="w-6 h-6 p-1 text-muted-foreground bg-muted border border-border rounded-full shadow-sm hover:text-foreground hover:translate-y-0.5 transition-all"
											/>
										</button>
									{/if}
								</div>
								{#if needsExpansion && diffFullyExpanded}
									<button
										class="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
										onclick={() => (diffFullyExpanded = false)}
									>
										<ChevronUp class="w-3.5 h-3.5" />
										<span>Collapse</span>
									</button>
								{/if}
							{:else}
								<div class="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto mt-3">
									<div class="text-muted-foreground text-[10px] uppercase tracking-wide mb-1.5 font-medium">
										Input
									</div>
									<pre class="whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(
											tool?.input,
											null,
											2
										)}</pre>
								</div>
							{/if}

							<!-- Result (if available) -->
							{#if tool?.result !== undefined && tool?.result !== null}
								<div
									class="rounded-lg p-3 font-mono text-xs overflow-x-auto {tool?.status === 'error'
										? 'bg-destructive/5 border border-destructive/20'
										: 'bg-success/5 border border-success/20'}"
								>
									<div
										class="text-[10px] uppercase tracking-wide mb-1.5 font-medium {tool?.status ===
										'error'
											? 'text-destructive'
											: 'text-success'}"
									>
										{tool?.status === 'error' ? 'Error' : 'Result'}
									</div>
									<pre class="whitespace-pre-wrap break-all text-muted-foreground">{typeof tool.result ===
									'string'
										? tool.result
										: JSON.stringify(tool.result, null, 2)}</pre>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{:else if message.type === 'system.hook_response'}
				<!-- Hook response - collapsible card -->
				<div class="w-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
					<button
						class="w-full px-3 py-2.5 text-left cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-2"
						onclick={toggleExpanded}
					>
						{#if isExpanded}
							<ChevronDown
								class="w-4 h-4 text-muted-foreground shrink-0 transition-transform"
							/>
						{:else}
							<ChevronRight
								class="w-4 h-4 text-muted-foreground shrink-0 transition-transform"
							/>
						{/if}
						<span class="font-medium text-foreground text-sm">
							{hookInfo?.name || 'Hook'}
						</span>
						<!-- Exit code indicator -->
						{#if hookInfo?.exitCode === 0}
							<CircleCheck class="w-4 h-4 text-success ml-auto" />
						{:else}
							<CircleX class="w-4 h-4 text-destructive ml-auto" />
						{/if}
						<span class="text-xs text-muted-foreground font-mono">
							exit {hookInfo?.exitCode}
						</span>
					</button>

					{#if isExpanded}
						{@const hook = hookInfo}
						<div class="p-3 pt-0 space-y-3 border-t border-border">
							<!-- stdout -->
							{#if hook?.stdout}
								<div
									class="bg-success/5 border border-success/20 rounded-lg p-3 font-mono text-xs overflow-x-auto mt-3"
								>
									<div
										class="text-success text-[10px] uppercase tracking-wide mb-1.5 font-medium"
									>
										stdout
									</div>
									<pre class="whitespace-pre-wrap break-all text-muted-foreground">{hook.stdout}</pre>
								</div>
							{/if}

							<!-- stderr -->
							{#if hook?.stderr}
								<div
									class="bg-destructive/5 border border-destructive/20 rounded-lg p-3 font-mono text-xs overflow-x-auto"
								>
									<div
										class="text-destructive text-[10px] uppercase tracking-wide mb-1.5 font-medium"
									>
										stderr
									</div>
									<pre class="whitespace-pre-wrap break-all text-muted-foreground">{hook.stderr}</pre>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{:else if message.type === 'ui.command_output'}
				<!-- Command output (like /help) - rendered with markdown and terminal styling -->
				<div
					class="relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-muted border border-border shadow-sm"
				>
					{#if message.metadata?.command}
						<div
							class="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 pb-2 border-b border-border"
						>
							<Terminal class="w-3 h-3" />
							<code class="font-mono">{message.metadata.command}</code>
						</div>
					{/if}
					<div
						class="prose prose-sm max-w-none [&_pre]:bg-muted [&_pre]:text-foreground [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_code]:text-xs [&_code]:bg-muted [&_code]:text-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded"
					>
						<Markdown source={message.content} options={{ breaks: true }} />
					</div>
				</div>
			{:else if message.type === 'ui.help_menu'}
				<!-- Help menu with tabs (Claude CLI-style) -->
				<div class="w-full max-w-2xl">
					<HelpMenu
						version={message.metadata?.version || 'unknown'}
						commands={message.metadata?.commands || []}
						onClose={onDismissMessage}
					/>
				</div>
			{:else if message.type === 'ui.session_error'}
				<!-- Session error with recovery actions -->
				<div class="{config.bubble} flex flex-col gap-3">
					<div class="flex items-start gap-2">
						<AlertTriangle class="w-4 h-4 shrink-0 mt-0.5" />
						<div class="flex flex-col gap-1">
							<span class="font-medium">Session not found</span>
							<span class="text-xs opacity-80">{message.content}</span>
						</div>
					</div>
					<div class="flex items-center gap-2 pt-1 border-t border-current/10">
						{#if onResetSession}
							<button
								onclick={async () => { resettingSession = true; try { await onResetSession?.(); } finally { resettingSession = false; } }}
								disabled={resettingSession}
								class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
									bg-primary text-primary-foreground hover:bg-primary/90
									disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
							>
								{#if resettingSession}
									<LoaderCircle class="w-3 h-3 animate-spin" />
								{:else}
									<RotateCcw class="w-3 h-3" />
								{/if}
								Start fresh session
							</button>
						{/if}
						{#if onDownloadTranscript}
							<button
								onclick={onDownloadTranscript}
								class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
									border border-current/20 hover:bg-current/5 transition-colors"
							>
								<Download class="w-3 h-3" />
								Download transcript
							</button>
						{/if}
					</div>
				</div>
			{:else if message.type.startsWith('system.')}
				<!-- Simple system message - subtle banner -->
				<div class="flex flex-col max-w-md">
					<div class="{config.bubble}">
						<Settings class="w-3 h-3" />
						<span>{message.content}</span>
					</div>
					{#if message.metadata?.subtype === 'init' && message.metadata?.mcpServers?.length}
						<MCPStatus servers={message.metadata.mcpServers} />
					{/if}
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
								aria-label="Edited message"
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
										class="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium
                           hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
									>
										{#if editLoading}
											<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
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
						<div
							class="prose prose-sm max-w-none {message.type === 'user'
								? 'prose-invert'
								: ''} [&_pre]:bg-muted [&_pre]:text-foreground [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_code]:text-xs [&_code]:bg-muted [&_code]:text-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded"
						>
							<Markdown source={message.content} />
						</div>

						<!-- Action buttons -->
						<div
							class="absolute -right-2 -top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
						>
							{#if message.type === 'user' && canEdit && onEditMessage}
								<!-- Edit button for user messages -->
								<button
									class="p-1.5 rounded-md bg-card border border-border shadow-sm hover:bg-accent focus-visible:opacity-100"
									onclick={startEditing}
									aria-label="Edit message"
									title="Edit message and restart from here"
								>
									<Pencil class="w-3.5 h-3.5 text-muted-foreground" />
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
				<span
					class="text-[10px] text-muted-foreground mt-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
				>
					{formatTimestamp(new Date(message.timestamp))}
				</span>
			{/if}
		</div>

		{#if message.type === 'user'}
			<!-- User Avatar -->
			<div
				class="shrink-0 size-9 rounded-xl {config.iconBg} flex items-center justify-center mt-0.5"
			>
				<User class="size-[18px] {config.iconColor}" />
			</div>
		{/if}
	</div>
{/if}

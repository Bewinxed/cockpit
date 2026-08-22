<script lang="ts">
	import {
		IconUser,
		IconDocument,
		IconChevronRight,
		IconSpinner,
		IconSuccess,
		IconError,
		IconSettings,
		IconTerminal,
		IconHelp,
		IconPen,
		IconFork,
		IconCheck,
		IconAgent,
		IconReset,
		IconDownload,
		IconGallery,
		IconWarningTriangle,
		IconRules,
		IconSubagentsDuo,
	} from '$lib/icons';
	import { Markdown } from '$lib/components/ui/markdown';
	import { Button } from '$lib/components/ui/button';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { formatTimestamp } from '$lib/utils/time';
	import { askShort, delegateOf, isDelegateReport, matchesSession } from '$lib/cockpit/frames';
	import { resolveInstanceId } from '$lib/cockpit/links';
	import { modelLabel, providerOf } from '$lib/cockpit/models.svelte';
	import ProviderLogo from './ProviderLogo.svelte';
	import { cockpit } from '$lib/cockpit/client.svelte';
	import type { DelegateReportEvent, Message } from '$lib/cockpit/types';
	import HelpMenu from './HelpMenu.svelte';
	import { CopyButton } from '$lib/components/ui/copy-button';
	import { getRenderer, type MessageRendererProps } from './message-renderers';
	import MCPStatus from './message-renderers/MCPStatus.svelte';
	import SourcesStrip from './SourcesStrip.svelte';
	import { sourcesForMessage } from '$lib/cockpit/sources';
	import type { MessageHints } from '$lib/cockpit/message-hints';
	import ToolRow from './tool-cards/ToolRow.svelte';
	import ReportBody from './tool-cards/ReportBody.svelte';
	import { isFileDiffTool, resultText, type ToolStatus } from './tool-cards/descriptors';

	interface Props {
		message: Message;
		instanceId?: string;
		/** Pre-computed reactive hints from SessionPane.  When provided the
		 *  component reads these instead of subscribing to the global store,
		 *  cutting per-message reactive overhead from 6 derivations to 0. */
		hints?: MessageHints;
		showTimestamp?: boolean;
		onQuestionSubmit?: (requestId: string, answers: Record<string, string>) => Promise<void>;
		onQuestionCancel?: () => void;
		onDismissMessage?: () => void;
		/** Rewrite this turn and take the conversation from there, keyed by its SDK uuid */
		onEditMessage?: (sdkUuid: string, newContent: string) => Promise<void>;
		/** Branch a side quest from the point this turn was said at */
		onForkFrom?: (sdkUuid: string) => Promise<void>;
		/** Whether the question picker is currently active */
		isQuestionPickerActive?: boolean;
		/** Whether editing is supported for this message */
		canEdit?: boolean;
		/** Whether this message can be branched from */
		canFork?: boolean;
		/** Callback to reset session and start fresh (for session_error recovery) */
		onResetSession?: () => Promise<void>;
		/** Callback to download chat transcript */
		onDownloadTranscript?: () => void;
	}

	let {
		message,
		instanceId = '',
		hints,
		showTimestamp = false,
		onQuestionSubmit,
		onQuestionCancel,
		onDismissMessage,
		onEditMessage,
		onForkFrom,
		onResetSession,
		onDownloadTranscript,
		isQuestionPickerActive = false,
		canEdit = false,
		canFork = false
	}: Props = $props();

	// Check if this message has a specialized renderer
	const renderer = $derived(getRenderer(message));

	// A delegate's report lives inside its own card (DelegateBranch) — a peer
	// bubble saying the same thing again helps nobody — and a delegate's routed
	// ask folds into that card's Asks section. Both are suppressed only when the
	// card is provably in this transcript: the delegate's spawn result names its
	// id, the same `id: <uuid>` containment DelegateBranch itself parses to find
	// its delegate. Otherwise the bubble stands, because a report (or an ask)
	// must never disappear. A report needs the delegate row to actually be this
	// transcript's child (`isDelegateReport`); an ask carries its own
	// `user.delegate_ask` type, so the containment test alone decides.
	const suppressedAsDelegateTraffic = $derived.by(() => {
		if (hints) return hints.suppressedAsDelegateTraffic;
		if (message.type === 'user.peer') {
			if (!isDelegateReport(message, instanceId, cockpit.instances)) return false;
		} else if (message.type !== 'user.delegate_ask') {
			return false;
		}
		const peerSession = message.metadata?.peerSession;
		if (!peerSession) return false;
		const parent = cockpit.session(instanceId);
		return (parent?.messages ?? []).some(
			(m) =>
				(m.type === 'tool.handoff' || m.type === 'tool.use') &&
				m.metadata?.delegateInstanceId != null &&
				matchesSession(peerSession, m.metadata.delegateInstanceId)
		);
	});

	// A follow-up handed to one's OWN delegate is delegation traffic, not a
	// hand-off to a foreign session: it is named by its label, never its raw
	// uuid, and the result sentence (which only restates the headline) is
	// dropped. Foreign targets keep the plain hand-off receipt.
	const followUpLabel = $derived.by(() => {
		if (hints) return hints.followUpLabel;
		if (message.type !== 'tool.handoff' || message.metadata?.handoffKind === 'delegate')
			return null;
		const row = delegateOf(String(message.content), instanceId, cockpit.instances);
		if (!row) return null;
		const name = row.cwd.split('/').filter(Boolean).pop() ?? row.cwd;
		return `${name}#${row.id.slice(0, 8)}`;
	});

	// The delegate a follow-up names, resolved the same way `followUpLabel` does,
	// so the card can wear that delegate's model mark instead of the anonymous
	// subagents glyph.
	const followUpRow = $derived(
		message.type === 'tool.handoff'
			? delegateOf(String(message.content), instanceId, cockpit.instances)
			: null
	);
	// The full instance row for its `model` — `delegateOf` returns only id + cwd.
	const followUpModel = $derived(
		followUpRow
			? (cockpit.instances.find((row) => row.id === followUpRow.id)?.model ?? null)
			: null
	);

	// A follow-up to one's own delegate names a report the hub already recorded
	// for it. When one arrived after this receipt's timestamp, its first line is
	// the outcome that replaces the bare `delivered`. Read straight off the hub's
	// `delegate_events` store — keyed by the delegate's instanceId, the same
	// table `DelegateBranch` folds (`cockpit.delegateEventsOf`).
	const followUpOutcome = $derived.by((): string | null => {
		if (!followUpLabel || !followUpRow) return null;
		const reports = cockpit
			.delegateEventsOf(followUpRow.id)
			.filter((event): event is DelegateReportEvent => event.kind === 'report');
		const since = message.timestamp.getTime();
		const after = reports.filter((event) => new Date(event.createdAt).getTime() > since);
		if (after.length === 0) return null;
		return (
			after[after.length - 1].payload.body
				.split('\n')
				.map((line) => line.trim())
				.find((line) => line.length > 0) ?? null
		);
	});

	// A delegation brief is the parent's own prompt landing in its delegate's
	// transcript — not a hand-over from some peer session. The card names the
	// parent and wears its model's mark. Matched by the sender id when the
	// origin survived, by the parent's directory name when only the stored
	// marker did.
	const briefParent = $derived.by(() => {
		if (hints) return hints.briefParent;
		if (message.type !== 'user.peer' || message.metadata?.reportKind) return null;
		const row = cockpit.instances.find((r) => r.id === (instanceId || message.instanceId));
		if (!row?.parentInstanceId) return null;
		const parent = cockpit.instances.find((r) => r.id === row.parentInstanceId);
		if (!parent) return null;
		const sender = message.metadata?.peerSession ?? message.metadata?.peerFrom;
		const parentLeaf = parent.cwd.split('/').filter(Boolean).pop() ?? parent.cwd;
		const matched = sender
			? matchesSession(sender, parent.id)
			: message.metadata?.peerName === parentLeaf;
		return matched ? { ...parent, label: `${parentLeaf}#${parent.id.slice(0, 8)}` } : null;
	});

	// The gutter avatar for another session's words wears the SENDER's model
	// mark — a delegation brief shows who delegated, a report shows the
	// delegate that wrote it — never a generic bot glyph.
	const peerSenderModel = $derived.by(() => {
		if (hints) return hints.peerSenderModel;
		if (message.type !== 'user.peer') return null;
		if (briefParent) return briefParent.model ?? null;
		const sender = message.metadata?.peerSession ?? message.metadata?.peerFrom;
		if (!sender) return null;
		const row = cockpit.instances.find((r) => matchesSession(sender, r.id));
		return row?.model ?? null;
	});

	// A session reference — a report's delegate, a hand-off's target — resolves
	// to a clickable `/session/<id>` when the fleet has exactly one matching row.
	const sessionHref = $derived.by(() => {
		if (hints) return hints.sessionHref;
		if (message.type === 'user.peer') {
			const sender = message.metadata?.peerSession ?? message.metadata?.peerFrom;
			const id = resolveInstanceId(sender, cockpit.instances);
			return id ? `/session/${id}` : null;
		}
		if (message.type === 'tool.handoff') {
			const full = message.metadata?.delegateInstanceId;
			if (typeof full === 'string') return `/session/${full}`;
			const short = /#([0-9a-f]{8,})$/.exec(String(message.content ?? '').trim());
			const id = short ? resolveInstanceId(short[1], cockpit.instances) : undefined;
			return id ? `/session/${id}` : null;
		}
		return null;
	});

	// A task notification is the harness's echo of a finished Task call. When
	// that call's branch is in this transcript, the branch already carries the
	// same report — thirty of these echoes stacked up say nothing new.
	const suppressedAsTaskEcho = $derived.by(() => {
		if (hints) return hints.suppressedAsTaskEcho;
		if (message.type !== 'ui.system_note') return false;
		if (message.metadata?.noteKind !== 'Task notification') return false;
		const toolId = message.metadata?.noteTaskToolId;
		if (!toolId) return false;
		return Boolean(cockpit.session(instanceId)?.subagents?.[toolId]);
	});

	// Determine if a specialized renderer is active
	const rendererIsActive = $derived.by(() => {
		if (!renderer) return false;
		if (renderer.name === 'AskQuestionPicker') return isQuestionPickerActive;
		return false;
	});

	// Props to pass to specialized renderers
	const rendererProps = $derived<MessageRendererProps>({
		message,
		instanceId,
		isActive: rendererIsActive,
		showTimestamp,
		onQuestionSubmit,
		onQuestionCancel,
		onDismissMessage
	});

	// Auto-expand for diff tools, collapsed for others
	const hasDiff = $derived(
		(message.type === 'tool.use' || message.type === 'tool.result') &&
			isFileDiffTool(message.metadata?.toolName)
	);

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
	let forkLoading = $state(false);

	function startEditing() {
		editContent = message.content;
		isEditing = true;
	}

	function cancelEditing() {
		isEditing = false;
		editContent = '';
	}

	async function submitEdit() {
		if (!onEditMessage || !message.sdkUuid || !editContent.trim()) return;

		// Close edit mode immediately for better UX
		const content = editContent.trim();
		const uuid = message.sdkUuid;
		isEditing = false;
		editLoading = true;

		try {
			await onEditMessage(uuid, content);
		} catch (err) {
			console.error('[Edit] onEditMessage error:', err);
			// Re-open edit mode on error so user can retry
			isEditing = true;
			editContent = content;
		} finally {
			editLoading = false;
		}
	}

	async function forkFromHere() {
		if (!onForkFrom || !message.sdkUuid) return;
		forkLoading = true;
		try {
			await onForkFrom(message.sdkUuid);
		} finally {
			forkLoading = false;
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

	// Who a turn is attributed to in its label row. `You` for the operator, the
	// harness's product name for the agent — read off the instance the same way
	// the suppression rules above read the fleet.
	const HARNESS_LABELS: Record<string, string> = {
		claude: 'Claude Code',
		opencode: 'OpenCode',
		pi: 'pi'
	};
	const roleName = $derived.by(() => {
		if (message.type === 'user') return 'You';
		// The same harness the header names — the session's own, not a fleet row
		// that a stored transcript may not have.
		const harness = cockpit.session(instanceId || message.instanceId)?.harness ?? 'claude';
		return HARNESS_LABELS[harness] ?? (harness || 'Assistant');
	});

	/** Past this, a single turn crowds out everything the session said after it. */
	const HUGE_MESSAGE_CHARS = 1500;
	const HUGE_MESSAGE_HEAD = 300;

	const isUser = $derived(message.type === 'user');
	const bubbleImages = $derived(isUser ? (message.metadata?.images ?? []) : []);
	const bubbleAttachments = $derived(isUser ? (message.metadata?.attachments ?? []) : []);
	const isHuge = $derived(isUser && message.content.length > HUGE_MESSAGE_CHARS);
	const messageHead = $derived(message.content.slice(0, HUGE_MESSAGE_HEAD));
	const messageRest = $derived(message.content.slice(HUGE_MESSAGE_HEAD));

	let fullMessageOpen = $state(false);

	// What this answer read on the web: the pages the calls between it and the
	// turn before it named. The message alone cannot see those calls, so the
	// list comes from the session the same way the suppression rules above read
	// it — and a turn rendered outside that list (a delegate's own branch) finds
	// itself nowhere in it and cites nothing.
	const sources = $derived.by(() => {
		if (hints) return hints.sources;
		if (message.type !== 'assistant') return [];
		const messages = cockpit.session(instanceId)?.messages ?? [];
		return sourcesForMessage(messages, messages.indexOf(message));
	});
</script>

<!-- If there's a specialized renderer, use it -->
{#if renderer}
	<renderer.component {...rendererProps} />
{:else if message.type === 'user' || message.type === 'assistant'}
	<!-- A turn: a role label row, then plain body text — no bubble, no avatar
	     column. The whole grammar of the transcript is label + prose. -->
	<div class="turn group">
		<h2 class="who">
			<span class="dot {isUser ? 'u' : 'a'}">
				{#if isUser}
					<IconUser />
				{:else}
					<IconAgent />
				{/if}
			</span>
			<span class="role">{roleName}</span>
			{#if message.timestamp}
				<span class="ts">{formatTimestamp(new Date(message.timestamp))}</span>
			{/if}
		</h2>

		{#if isUser && isEditing}
			<!-- User message in edit mode -->
			<div class="edit">
				<textarea
					class="w-full min-h-[80px] px-3 py-2 bg-background border border-border rounded-lg text-base sm:text-sm
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
                           hover:bg-primary/90 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						>
							{#if editLoading}
								<IconSpinner class="w-3.5 h-3.5 animate-spin" />
							{:else}
								<IconCheck class="w-3.5 h-3.5" />
							{/if}
							<span>Submit</span>
						</button>
					</div>
				</div>
			</div>
		{:else}
			<div class="msg">
				{#if bubbleImages.length > 0}
					<div class="flex flex-wrap gap-2 mb-2">
						{#each bubbleImages as image, index (index)}
							{#if image.dataUri}
								<img
									src={image.dataUri}
									alt="Attachment"
									class="max-h-40 rounded-lg outline outline-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
								/>
							{:else}
								<!-- A stored turn that named an image the transcript no longer carries -->
								<span
									class="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground"
								>
									<IconGallery class="size-3.5" />
									{image.mediaType.replace('image/', '')} image
								</span>
							{/if}
						{/each}
					</div>
				{/if}

				{#if bubbleAttachments.length > 0}
					<div class="flex flex-wrap gap-1.5 mb-2">
						{#each bubbleAttachments as attachment, index (index)}
							<span
								class="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
							>
								<IconDocument class="size-3.5" />
								{attachment.name}
								<span class="tabular-nums">{attachment.chars.toLocaleString()} chars</span>
							</span>
						{/each}
					</div>
				{/if}

				{#if isHuge}
					<Collapsible.Root bind:open={fullMessageOpen}>
						<Markdown source={fullMessageOpen ? messageHead : `${messageHead}…`} />
						<Collapsible.Content>
							<Markdown source={messageRest} />
						</Collapsible.Content>
						<Collapsible.Trigger
							class="mt-2 flex items-center gap-1.5 text-xs opacity-70 transition-opacity hover:opacity-100"
						>
							<IconChevronRight
								class="w-3.5 h-3.5 transition-transform duration-200 ease-out {fullMessageOpen
									? 'rotate-90'
									: ''}"
							/>
							{fullMessageOpen
								? 'Show less'
								: `Show full message (${message.content.length.toLocaleString()} chars)`}
						</Collapsible.Trigger>
					</Collapsible.Root>
				{:else}
					<Markdown source={message.content} />
				{/if}

				{#if sources.length > 0}
					<SourcesStrip {sources} />
				{/if}
			</div>

			<!-- Turn controls, revealed on hover — the row has no corner to hide
			     them in, so they sit under the words as a quiet strip. -->
			<div class="acts">
				{#if message.type === 'user' && canEdit && onEditMessage}
					<Button
						variant="outline"
						size="icon-sm"
						class="shadow-sm"
						onclick={startEditing}
						aria-label="Edit message"
						title="Edit message and restart from here"
					>
						<IconPen class="text-muted-foreground" />
					</Button>
				{/if}
				{#if message.type === 'user' && canFork && onForkFrom}
					<Button
						variant="outline"
						size="icon-sm"
						class="shadow-sm"
						disabled={forkLoading}
						onclick={forkFromHere}
						aria-label="Fork from here"
						title="Branch a side quest from this point"
					>
						{#if forkLoading}
							<IconSpinner class="animate-spin text-muted-foreground" />
						{:else}
							<IconFork class="text-muted-foreground" />
						{/if}
					</Button>
				{/if}
				<CopyButton
					text={message.content}
					variant="outline"
					size="icon-sm"
					class="shadow-sm [&_svg]:text-muted-foreground"
				/>
			</div>
		{/if}
	</div>
{:else if message.type === 'tool.use' || message.type === 'tool.result'}
	<!-- One tool call standing on its own: the same compact row a group holds,
	     on its own rail. No card. -->
	<div class="tools">
		<ToolRow
			toolName={toolInfo?.name}
			input={toolInfo?.input as Record<string, unknown> | undefined}
			result={resultText(toolInfo?.result)}
			status={(toolInfo?.status ?? 'pending') as ToolStatus}
			open={isExpanded}
			onToggle={toggleExpanded}
		/>
	</div>
{:else if message.type === 'system.hook_response'}
	<!-- Hook response — a rail-led collapsible row, same grammar as a tool. -->
	<div class="tools">
		<Collapsible.Root open={isExpanded} onOpenChange={toggleExpanded}>
			<Collapsible.Trigger class="w-full text-left">
				<div class="trow {isExpanded ? 'open' : ''} {(hookInfo?.exitCode ?? 0) !== 0 ? 'bad' : ''}">
					<span class="ic">
						<IconChevronRight class="chev {isExpanded ? 'open' : ''}" />
					</span>
					<span class="tk">Hook</span>
					<span class="arg">{hookInfo?.name || 'Hook'}</span>
					{#if hookInfo?.exitCode === 0}
						<IconSuccess class="size-4 shrink-0 text-success" />
					{:else}
						<IconError class="size-4 shrink-0 text-error" />
					{/if}
					<span class="ec">exit {hookInfo?.exitCode}</span>
				</div>
			</Collapsible.Trigger>

			<Collapsible.Content>
				{@const hook = hookInfo}
				<div class="trow-body space-y-3">
					<!-- stdout -->
					{#if hook?.stdout}
						<div
							class="bg-success/5 border border-success/20 rounded-lg p-3 font-mono text-xs overflow-x-auto"
						>
							<div class="text-success text-xs uppercase tracking-wide mb-1.5 font-medium">
								stdout
							</div>
							<pre class="whitespace-pre-wrap break-all text-muted-foreground">{hook.stdout}</pre>
						</div>
					{/if}

					<!-- stderr -->
					{#if hook?.stderr}
						<div
							class="bg-destructive/5 text-destructive border border-destructive/20 rounded-lg p-3 font-mono text-xs overflow-x-auto"
						>
							<div class="text-destructive text-xs uppercase tracking-wide mb-1.5 font-medium">
								stderr
							</div>
							<pre class="whitespace-pre-wrap break-all text-muted-foreground">{hook.stderr}</pre>
						</div>
					{/if}
				</div>
			</Collapsible.Content>
		</Collapsible.Root>
	</div>
{:else if message.type === 'tool.handoff'}
				<!-- The sender's receipt. Firing a hand-off and seeing nothing is
				     indistinguishable from it never happening, which is the whole
				     reason this exists. -->
				{@const done = message.metadata?.toolStatus === 'success'}
				{@const failed = message.metadata?.toolStatus === 'error'}
				<div
					class="w-full overflow-hidden rounded-xl border {failed
						? 'border-destructive/40 bg-destructive/5'
						: 'border-border/60 bg-muted/20'}"
				>
					<div class="flex items-center gap-2 px-3 py-2">
						{#if followUpModel && providerOf(followUpModel)}
							<ProviderLogo model={followUpModel} size={16} />
						{:else}
							<IconSubagentsDuo
								class="size-4 shrink-0 {failed ? 'text-destructive' : 'text-muted-foreground'}"
							/>
						{/if}
						<span class="min-w-0 flex-1 truncate text-sm">
							<span class="font-medium {failed ? 'text-destructive' : 'text-foreground'}">
								{followUpLabel
									? 'Follow-up → '
									: message.metadata?.handoffKind === 'start'
										? 'Started → '
										: 'Handed → '}
							</span>
							<span class="font-mono text-foreground">
							{#if sessionHref}
								<a
									href={sessionHref}
									class="underline-offset-2 hover:text-primary hover:underline"
								>
									{followUpLabel ?? message.content}
								</a>
							{:else}
								{followUpLabel ?? message.content}
							{/if}
						</span>
						</span>
						{#if followUpModel}
							<span class="shrink-0 font-mono text-micro text-faint">
								{modelLabel(followUpModel)}
							</span>
						{/if}
						{#if failed || !followUpOutcome}
							<span class="shrink-0 text-xs {failed ? 'text-destructive' : 'text-muted-foreground'}">
								{failed ? 'failed' : done ? 'delivered' : 'sending…'}
							</span>
						{/if}
					</div>
					{#if message.metadata?.handoffBrief}
						<div class="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
							<div class="max-h-64 overflow-y-auto">
								<Markdown source={message.metadata.handoffBrief} />
							</div>
						</div>
					{/if}
					{#if followUpOutcome && !failed}
						<div class="border-t border-border/40 px-3 py-2">
							<p class="line-clamp-1 text-micro text-muted-foreground">{followUpOutcome}</p>
						</div>
					{/if}
					{#if failed && message.metadata?.toolResult && !followUpLabel}
						<p class="border-t border-border/40 px-3 py-2 text-xs text-destructive/80">
							{String(message.metadata.toolResult).slice(0, 200)}
						</p>
					{/if}
				</div>
			{:else if message.type === 'user.peer'}
				<!-- Another session's hand-off. Deliberately not the user bubble:
				     this is reported speech, and a reader who mistakes it for
				     their own instruction loses track of who asked for what. -->
				{#if !suppressedAsDelegateTraffic}
				<!-- A rule wears the warning hue rather than the peer primary: it is not
				     another session talking, it is a standing instruction the reader
				     themselves set, and the two should never be confused at a glance. -->
				<div
					class="w-full overflow-hidden rounded-xl border {message.metadata?.ruleName
						? 'border-warning/30 bg-warning/5'
						: 'border-primary/30 bg-primary/5'}"
				>
					<div
						class="flex items-center gap-2 border-b px-3 py-2 {message.metadata?.ruleName
							? 'border-warning/20'
							: 'border-primary/20'}"
					>
						<!-- The kind glyph; the sender's model mark is the gutter avatar. -->
						{#if message.metadata?.ruleName}
							<IconRules class="size-4 shrink-0 text-warning" />
						{:else}
							<IconSubagentsDuo class="size-4 shrink-0 text-primary" />
						{/if}
						<span
							class="min-w-0 flex-1 truncate text-xs font-medium {message.metadata?.ruleName
								? 'text-warning'
								: 'text-primary'}"
						>
							{#if message.metadata?.ruleName}
								<a href="/rules" class="underline-offset-2 hover:underline">
									Your rule · {message.metadata.ruleName}
								</a>
							{:else if message.metadata?.reportKind}
								{#if sessionHref}
									<a href={sessionHref} class="underline-offset-2 hover:underline">
										← Report from {message.metadata?.peerName ?? 'a delegate'}{message
											.metadata.reportKind === 'failed'
											? ' — turn failed'
											: ''}
									</a>
								{:else}
									← Report from {message.metadata?.peerName ?? 'a delegate'}{message.metadata
										.reportKind === 'failed'
										? ' — turn failed'
										: ''}
								{/if}
							{:else if briefParent}
								← Delegation brief from <span class="font-mono">{briefParent.label}</span>
							{:else}
								← Handed over by {message.metadata?.peerName ?? 'another session'}
							{/if}
						</span>
						{#if briefParent}
							<a
								href="/session/{briefParent.id}"
								class="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
							>
								Open it
							</a>
						{:else if message.metadata?.peerSession}
							<a
								href="/session/{message.metadata.peerSession}"
								class="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
							>
								Open it
							</a>
						{/if}
					</div>
					<div class="px-3 py-2.5 text-sm">
						{#if message.metadata?.reportKind}
							<ReportBody text={message.content} />
						{:else}
							<Markdown source={message.content} />
						{/if}
					</div>
				</div>
				{/if}
			{:else if message.type === 'user.delegate_ask'}
				<!-- A delegate's routed permission ask. When the delegate's card is
				     in this transcript the ask folds into its Asks section, so
				     nothing is drawn here; otherwise (chunked transcript, or an ask
				     escalated out of a dead parent) a muted fallback row stands in —
				     not a user bubble, and not markdown. -->
				{#if !suppressedAsDelegateTraffic}
					<div
						class="w-full max-w-[min(65ch,100%)] rounded-xl border border-border/50 bg-muted/30 px-3 py-2"
					>
						<div class="flex items-center gap-2">
							<IconHelp class="size-4 shrink-0 text-muted-foreground" />
							<span class="text-xs font-medium text-muted-foreground">
								Ask from {message.metadata?.askLabel ?? 'a delegate'}
							</span>
							<span
								class="min-w-0 flex-1 font-mono text-xs text-muted-foreground line-clamp-2 break-all"
							>
								{askShort(message.content)}
							</span>
						</div>
					</div>
				{/if}
			{:else if message.type === 'ui.system_note'}
				{#if !suppressedAsTaskEcho}
				<!-- Harness-injected note that arrived as a user turn - collapsible card -->
				<div class="w-full border border-border/60 bg-muted/20 rounded-xl overflow-hidden">
					<Collapsible.Root open={isExpanded} onOpenChange={toggleExpanded}>
						<Collapsible.Trigger class="w-full text-left">
							<div
								class="w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors flex items-center gap-2"
							>
								<IconChevronRight
									class="w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ease-out {isExpanded
										? 'rotate-90'
										: ''}"
								/>
								<span class="text-xs font-medium text-muted-foreground">
									{message.metadata?.noteKind}
								</span>
								<span class="truncate text-xs text-faint">
									{message.metadata?.noteTitle}
								</span>
							</div>
						</Collapsible.Trigger>

						<Collapsible.Content>
							<div class="border-t border-border p-3 text-muted-foreground">
								<Markdown source={message.content} />
							</div>
						</Collapsible.Content>
					</Collapsible.Root>
				</div>
				{/if}
			{:else if message.type === 'ui.command_output'}
				<!-- Command output (like /help) - rendered with markdown and terminal styling -->
				<div
					class="relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-muted border border-border shadow-sm"
				>
					{#if message.metadata?.command}
						<div
							class="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 pb-2 border-b border-border"
						>
							<IconTerminal class="w-3 h-3" />
							<code class="font-mono">{message.metadata.command}</code>
						</div>
					{/if}
					<Markdown source={message.content} />
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
				<div
					class="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-warning shadow-sm"
				>
					<div class="flex items-start gap-2">
						<IconWarningTriangle class="w-4 h-4 shrink-0 mt-0.5" />
						<div class="flex flex-col gap-1">
							<span class="font-medium">{message.metadata?.errorTitle ?? 'Session not found'}</span>
							<span class="text-xs opacity-80">{message.content}</span>
						</div>
					</div>
					{#if onResetSession || onDownloadTranscript}
					<div class="flex items-center gap-2 pt-1 border-t border-current/10">
						{#if onResetSession}
							<button
								onclick={async () => { resettingSession = true; try { await onResetSession?.(); } finally { resettingSession = false; } }}
								disabled={resettingSession}
								class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
									bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary
									disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
							>
								{#if resettingSession}
									<IconSpinner class="w-3 h-3 animate-spin" />
								{:else}
									<IconReset class="w-3 h-3" />
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
								<IconDownload class="w-3 h-3" />
								Download transcript
							</button>
						{/if}
					</div>
					{/if}
				</div>
			{:else if message.type.startsWith('system.')}
				<!-- Simple system message - subtle banner -->
				<div class="flex flex-col max-w-md">
					<div
						class="inline-flex items-center gap-2 rounded-full bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground"
					>
						<IconSettings class="w-3 h-3" />
						<span>{message.content}</span>
					</div>
					{#if message.metadata?.subtype === 'init' && message.metadata?.mcpServers?.length}
						<MCPStatus servers={message.metadata.mcpServers} />
					{/if}
				</div>
{:else}
	<!-- Any other turn (ui.error, result.error, or an unmapped type): plain body
	     text in the transcript voice, tinted for the error kinds, never a bubble. -->
	<div class="msg {message.type.includes('error') ? 'err' : ''}">
		<Markdown source={message.content} />
	</div>
{/if}

<style>
	/* The transcript's whole grammar: a role label row, then plain body text.
	   No bubble, no border, no avatar column — the tokens carry every distinction
	   the old chrome used to draw. */
	.turn {
		min-width: 0;
	}

	.who {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 4px;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--ink-muted);
	}
	.who .dot {
		width: 14px;
		height: 14px;
		flex: 0 0 auto;
		border-radius: var(--radius-mark);
		display: grid;
		place-items: center;
	}
	.who .dot.u {
		background: var(--surface-sunken);
		color: var(--ink-body);
	}
	.who .dot.a {
		background: var(--brand-lo);
		color: var(--on-brand);
	}
	.who .dot :global(svg) {
		width: 9px;
		height: 9px;
		display: block;
	}
	.who .role {
		font-size: var(--text-sm);
		font-weight: var(--weight-strong);
		color: var(--ink-strong);
	}
	.who .ts {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.turn:hover .ts,
	.turn:focus-within .ts {
		opacity: 1;
	}

	.msg {
		max-width: 74ch;
		min-width: 0;
		font-size: var(--text-base);
		line-height: var(--leading-body);
		color: var(--ink-strong);
		overflow-wrap: break-word;
	}
	.msg.err {
		color: var(--data-bad);
	}

	.edit {
		max-width: 74ch;
		border: 1px solid var(--border-control);
		border-radius: var(--radius-control);
		background: var(--surface-raised);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* Turn controls sit under the words as a quiet strip, revealed on hover. */
	.acts {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 6px;
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.turn:hover .acts,
	.turn:focus-within .acts {
		opacity: 1;
	}

	/* A tool run — one call or a hook — reads on a rail, never in a card. */
	.tools {
		margin: 6px 0 0 7px;
		padding-left: 12px;
		background: var(--rail) left top / 2px 100% no-repeat;
	}

	/* The hook row shares the compact tool grammar. */
	.trow {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 26px;
		padding: 2px 0;
		font-size: var(--text-sm);
		color: var(--ink-body);
		cursor: pointer;
	}
	.trow.bad {
		color: var(--data-bad);
	}
	.trow .ic {
		width: 15px;
		height: 15px;
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		color: var(--ink-muted);
	}
	.trow .ic :global(svg) {
		width: 15px;
		height: 15px;
		display: block;
	}
	.trow .ic :global(.chev) {
		transition: transform 0.2s ease;
	}
	.trow .ic :global(.chev.open) {
		transform: rotate(90deg);
	}
	.trow .tk {
		flex: 0 0 auto;
		font-weight: var(--weight-strong);
		color: var(--ink-strong);
	}
	.trow .arg {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-muted);
	}
	.trow .ec {
		flex: 0 0 auto;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}
	.trow-body {
		margin-left: 22px;
		padding: 6px 12px 6px 4px;
		border-left: 1px solid var(--border-divider);
	}
</style>

<script lang="ts">
	import {
		IconUser,
		IconTools,
		IconDocument,
		IconAlert,
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

	const messageConfig = {
		user: {
			align: 'justify-end',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-xl bg-primary/8 text-foreground',
			icon: IconUser,
			iconBg: 'bg-primary text-primary-foreground',
			iconColor: 'text-primary-foreground'
		},
		assistant: {
			align: 'justify-start',
			bubble:
				// min(65ch, 100%) in ONE declaration: `max-w-prose max-w-full` looks
				// right but only one max-width survives the cascade, and in this
				// items-start flex column the bubble sizes to fit-content — 65ch won
				// and overflowed a 390px phone (user report, 2026-08-09).
				'relative max-w-[min(65ch,100%)] min-w-0 text-sm leading-relaxed text-foreground break-words',
			icon: IconAgent,
			iconBg: 'bg-secondary border border-border',
			iconColor: 'text-muted-foreground'
		},
		'tool.use': {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
			icon: IconTools,
			iconBg: 'bg-warning/10',
			iconColor: 'text-warning'
		},
		'tool.result': {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
			icon: IconDocument,
			iconBg: 'bg-success/10',
			iconColor: 'text-success'
		},
		'ui.error': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-xl bg-destructive/10 text-destructive border border-destructive/30 shadow-sm',
			icon: IconAlert,
			iconBg: 'bg-destructive/10 text-destructive',
			iconColor: 'text-destructive'
		},
		'ui.session_error': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-xl bg-warning/10 text-warning border border-warning/30 shadow-sm',
			icon: IconWarningTriangle,
			iconBg: 'bg-warning/10',
			iconColor: 'text-warning'
		},
		system: {
			align: 'justify-center',
			bubble:
				'inline-flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 rounded-full',
			icon: IconSettings,
			iconBg: 'bg-accent text-accent-foreground',
			iconColor: 'text-muted-foreground'
		},
		'system.hook_response': {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-card border border-border shadow-sm',
			icon: IconTerminal,
			iconBg: 'bg-info/10',
			iconColor: 'text-info'
		},
		'ui.command_output': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-bl-sm bg-card text-card-foreground border border-border shadow-sm',
			icon: IconTerminal,
			iconBg: 'bg-accent text-accent-foreground',
			iconColor: 'text-muted-foreground'
		},
		'ui.system_note': {
			align: 'justify-start',
			bubble: '',
			icon: IconSettings,
			iconBg: 'bg-muted',
			iconColor: 'text-muted-foreground'
		},
		'ui.help_menu': {
			align: 'justify-start',
			bubble: '',
			icon: IconHelp,
			iconBg: 'bg-primary/10 text-primary',
			iconColor: 'text-primary'
		},
		thinking: {
			align: 'justify-start',
			bubble: 'px-3 py-2.5 text-sm rounded-xl bg-muted/50 border border-border shadow-sm',
			icon: IconAgent,
			iconBg: 'bg-accent text-accent-foreground',
			iconColor: 'text-muted-foreground'
		},
		'result.error': {
			align: 'justify-start',
			bubble:
				'relative px-4 py-3 text-sm leading-relaxed rounded-xl bg-destructive/10 text-destructive border border-destructive/30 shadow-sm',
			icon: IconAlert,
			iconBg: 'bg-destructive/10 text-destructive',
			iconColor: 'text-destructive'
		}
	};

	const config = $derived(
		messageConfig[message.type as keyof typeof messageConfig] ||
		(message.type.startsWith('system.') ? messageConfig.system : messageConfig.assistant)
	);

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
{:else}
	<!-- Default rendering logic -->
	<div class="flex {config.align} gap-3 group">
		<!-- Tool rows carry their own family glyph now; a wrench avatar beside
		     them said the same thing twice. -->
		{#if message.type !== 'user' && message.type !== 'assistant' && message.type !== 'user.delegate_ask' && message.type !== 'tool.use' && message.type !== 'tool.result' && !message.type.startsWith('system.') && message.type !== 'ui.help_menu' && !suppressedAsDelegateTraffic}
			<!-- Avatar: another session's words wear the sender's model mark. -->
			<div
				class="shrink-0 size-9 rounded-xl {config.iconBg} flex items-center justify-center mt-0.5"
			>
				{#if peerSenderModel && providerOf(peerSenderModel)}
					<ProviderLogo model={peerSenderModel} size={18} />
				{:else}
					<config.icon class="size-[18px] {config.iconColor}" />
				{/if}
			</div>
		{/if}

		<!-- Message Content -->
		<div
			class="flex flex-col gap-1 {message.type === 'user'
				? 'items-end'
				: 'items-start'} min-w-0 {message.type === 'ui.help_menu' ? 'w-full' : 'max-w-[85%]'}"
		>
			{#if message.type === 'tool.use' || message.type === 'tool.result'}
				<!-- One tool call standing on its own: the same row a group holds,
				     in a card of its own. -->
				<div class="w-full overflow-hidden rounded-xl bg-card shadow-md">
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
				<!-- Hook response - collapsible card -->
				<div class="w-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
					<Collapsible.Root open={isExpanded} onOpenChange={toggleExpanded}>
						<Collapsible.Trigger class="w-full text-left">
							<div
								class="w-full px-3 py-2.5 text-left cursor-pointer hover:bg-muted/50 transition-colors flex items-center gap-2"
							>
								<IconChevronRight
									class="w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ease-out {isExpanded
										? 'rotate-90'
										: ''}"
								/>
								<span class="font-medium text-foreground text-sm">
									{hookInfo?.name || 'Hook'}
								</span>
								<!-- Exit code indicator -->
								{#if hookInfo?.exitCode === 0}
									<IconSuccess class="w-4 h-4 text-success ml-auto" />
								{:else}
									<IconError class="w-4 h-4 text-destructive ml-auto" />
								{/if}
								<span class="text-xs text-muted-foreground font-mono">
									exit {hookInfo?.exitCode}
								</span>
							</div>
						</Collapsible.Trigger>

						<Collapsible.Content>
							{@const hook = hookInfo}
							<div class="p-3 pt-0 space-y-3 border-t border-border">
								<!-- stdout -->
								{#if hook?.stdout}
									<div
										class="bg-success/5 border border-success/20 rounded-lg p-3 font-mono text-xs overflow-x-auto mt-3"
									>
										<div
											class="text-success text-xs uppercase tracking-wide mb-1.5 font-medium"
										>
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
										<div
											class="text-destructive text-xs uppercase tracking-wide mb-1.5 font-medium"
										>
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
							<span class="shrink-0 font-mono text-micro text-muted-foreground/70">
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
				<div class="w-full overflow-hidden rounded-xl border border-primary/30 bg-primary/5">
					<div class="flex items-center gap-2 border-b border-primary/20 px-3 py-2">
						<!-- The kind glyph; the sender's model mark is the gutter avatar. -->
						<IconSubagentsDuo class="size-4 shrink-0 text-primary" />
						<span class="min-w-0 flex-1 truncate text-xs font-medium text-primary">
							{#if message.metadata?.reportKind}
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
				<div class="w-full bg-muted/30 border border-border rounded-xl overflow-hidden">
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
								<span class="truncate text-xs text-muted-foreground/70">
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
				<div class="{config.bubble} flex flex-col gap-3">
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
					<div class="{config.bubble}">
						<IconSettings class="w-3 h-3" />
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
					</div>
				{:else}
					<div class={config.bubble}>
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
											class="inline-flex items-center gap-1.5 rounded-lg border border-current/20 px-2 py-1 text-xs opacity-80"
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
										class="inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2 py-1 text-xs opacity-80"
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

						<!-- Action buttons. Above the bubble rather than over its corner:
						     a one-line turn has no corner to spare, and a 32px control
						     parked there sits on the words it belongs to. -->
						<div
							class="absolute right-0 bottom-full mb-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
						>
							{#if message.type === 'user' && canEdit && onEditMessage}
								<!-- Edit button for user messages -->
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
								<!-- Branch a side quest from this point in the conversation -->
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
							<!-- Copy button -->
							<CopyButton
								text={message.content}
								variant="outline"
								size="icon-sm"
								class="shadow-sm [&_svg]:text-muted-foreground"
							/>
						</div>
					</div>
				{/if}
			{/if}

			<!-- Timestamp (shown on hover) -->
			{#if message.timestamp}
				<span
					class="text-xs text-muted-foreground mt-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
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
				<IconUser class="size-[18px] {config.iconColor}" />
			</div>
		{/if}
	</div>
{/if}


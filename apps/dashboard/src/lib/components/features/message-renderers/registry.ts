import { TASK_LEDGER_TOOLS } from '$lib/cockpit/tasks.svelte';
import type { Message } from '$lib/cockpit/types';
import type { MessageRenderer, RendererMatch } from './types';
import AskQuestionPicker from './AskQuestionPicker.svelte';
import TaskEvent from './TaskEvent.svelte';
import CompactBoundary from './CompactBoundary.svelte';
import ThinkingBlock from './ThinkingBlock.svelte';
import ResultError from './ResultError.svelte';
import DelegateBranch from '../DelegateBranch.svelte';
import AnswerDelegate from './AnswerDelegate.svelte';

/**
 * Registry of message renderers.
 * Sorted by priority (highest first).
 * Add new renderers here to handle new message types.
 */
const renderers: MessageRenderer[] = [
	// Interactive system message types (priority 100)
	{
		component: AskQuestionPicker,
		match: (m: Message) => {
			// Match system messages created during live conversation
			if (m.type === 'system.ask_question') {
				return true;
			}
			// Match tool.use/tool.result messages for AskUserQuestion (from DB after refresh)
			if ((m.type === 'tool.use' || m.type === 'tool.result') && m.metadata?.toolName === 'AskUserQuestion') {
				return true;
			}
			return false;
		},
		priority: 100,
		name: 'AskQuestionPicker',
		// A question is the one tool call that is addressed to the reader, so it
		// never joins a tool group: grouping renders its rows straight from the
		// descriptors and never asks the registry, which left a question showing
		// as `questions [{…}]` on the params floor — the picker below was written
		// and never reached.
		standalone: true
	},
	{
		// Writing the plan down is not work to inspect: these render as one
		// quiet line each, which is also why `standsAlone` keeps them out of
		// the tool groups. `TaskGet`/`TaskList` only read, so they stay generic.
		component: TaskEvent,
		match: (m: Message) => m.type === 'tool.use' && TASK_LEDGER_TOOLS.has(m.metadata?.toolName ?? ''),
		priority: 100,
		name: 'TaskEvent',
		standalone: true
	},

	// Visual system message types (priority 80)
	{
		component: CompactBoundary,
		match: (m: Message) => m.type === 'system.compact_boundary',
		priority: 80,
		name: 'CompactBoundary'
	},

	// Thinking blocks (priority 90 - show before regular messages)
	{
		component: ThinkingBlock,
		match: (m: Message) => m.type === 'thinking',
		priority: 90,
		name: 'ThinkingBlock'
	},

	// Result error messages (priority 85)
	{
		component: ResultError,
		match: (m: Message) => m.type === 'result.error',
		priority: 85,
		name: 'ResultError'
	},

	// A delegated session, folded out of the parent transcript into a branch the
	// reader opens on purpose (NEW.md §1). Only the `delegate` hand-off kind is
	// its own card; `handoff`/`start` keep the sender's receipt in ChatMessage.
	{
		component: DelegateBranch,
		match: (m: Message) => m.type === 'tool.handoff' && m.metadata?.handoffKind === 'delegate',
		priority: 100,
		name: 'DelegateBranch',
		standalone: true
	},

	// Answering a delegate's routed ask is bookkeeping, not work to inspect: a
	// readable one-line receipt, standalone so tool grouping cannot swallow it.
	{
		component: AnswerDelegate,
		match: (m: Message) =>
			m.type === 'tool.use' && (m.metadata?.toolName ?? '').includes('answer_delegate'),
		priority: 100,
		name: 'AnswerDelegate',
		standalone: true
	}

	// Future renderers will be added here:
	// - MCPStatus (fn-4.5)
	// - SubagentBranch (fn-5)
].sort((a, b) => b.priority - a.priority);

/**
 * Find the appropriate renderer for a message.
 * Returns the first matching renderer (by priority), or null for default handling.
 *
 * @param message The message to find a renderer for
 * @returns The matched renderer component and name, or null for default ChatMessage handling
 */
export function getRenderer(message: Message): RendererMatch {
	for (const renderer of renderers) {
		if (renderer.match(message)) {
			return {
				component: renderer.component,
				name: renderer.name
			};
		}
	}
	return null;
}

/**
 * Whether this message draws itself and must not be folded into a ToolGroup.
 * The transcript groups consecutive tool calls, which would swallow a renderer
 * that was written to stand on its own — so the one list that knows a message
 * has its own component is the one that says so, rather than each grouping
 * site keeping a list of tool names.
 *
 * Opt-in per renderer: `AskQuestionPicker` also matches `tool.use`, but it is
 * a card the reader answers rather than a line, and enabling it here would
 * change a surface nothing has asked to change.
 */
export function standsAlone(message: Message): boolean {
	return renderers.some((renderer) => renderer.standalone && renderer.match(message));
}

/**
 * Register a new renderer at runtime.
 * Useful for plugins or dynamic renderer loading.
 *
 * @param renderer The renderer to register
 */
export function registerRenderer(renderer: MessageRenderer): void {
	renderers.push(renderer);
	renderers.sort((a, b) => b.priority - a.priority);
}

/**
 * Get all registered renderers (for debugging).
 */
export function getRegisteredRenderers(): readonly MessageRenderer[] {
	return renderers;
}

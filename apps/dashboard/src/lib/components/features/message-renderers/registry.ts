import type { Message } from '$lib/stores/realtime.svelte';
import type { MessageRenderer, RendererMatch } from './types';
import LoginPrompt from './LoginPrompt.svelte';
import ModelPicker from './ModelPicker.svelte';
import MemoryPicker from './MemoryPicker.svelte';
import CompactBoundary from './CompactBoundary.svelte';
import ThinkingBlock from './ThinkingBlock.svelte';
import ResultError from './ResultError.svelte';

/**
 * Registry of message renderers.
 * Sorted by priority (highest first).
 * Add new renderers here to handle new message types.
 */
const renderers: MessageRenderer[] = [
	// Interactive system message types (priority 100)
	{
		component: LoginPrompt,
		match: (m: Message) => m.type === 'system' && m.metadata?.subtype === 'login_prompt',
		priority: 100,
		name: 'LoginPrompt'
	},
	{
		component: ModelPicker,
		match: (m: Message) => m.type === 'system' && m.metadata?.subtype === 'model_picker',
		priority: 100,
		name: 'ModelPicker'
	},
	{
		component: MemoryPicker,
		match: (m: Message) => m.type === 'system' && m.metadata?.subtype === 'memory_picker',
		priority: 100,
		name: 'MemoryPicker'
	},

	// Visual system message types (priority 80)
	{
		component: CompactBoundary,
		match: (m: Message) => m.type === 'system' && m.metadata?.subtype === 'compact_boundary',
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
		match: (m: Message) => m.type === 'result_error',
		priority: 85,
		name: 'ResultError'
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

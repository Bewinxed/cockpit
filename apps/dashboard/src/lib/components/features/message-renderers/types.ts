import type { Message } from '$lib/cockpit/types';
import type { Component } from 'svelte';

/**
 * Props passed to all message renderer components.
 * Each renderer receives the message and callbacks to handle interactions.
 */
export interface MessageRendererProps {
	message: Message;
	instanceId: string;
	/** Whether this interactive element is currently active/pending */
	isActive?: boolean;
	/** Show timestamp on hover */
	showTimestamp?: boolean;

	// Login prompt callbacks
	onLoginSubmit?: (code: string) => Promise<void>;
	onLoginCancel?: () => void;

	// Model picker callbacks
	onModelSelect?: (model: string) => Promise<void>;
	onModelCancel?: () => void;

	// Memory picker callbacks
	onMemorySelect?: (memoryType: 'project' | 'user') => void;
	onMemorySave?: (content: string) => Promise<void>;
	onMemoryCancel?: () => void;

	// Question picker callbacks (AskUserQuestion)
	onQuestionSubmit?: (requestId: string, answers: Record<string, string>) => Promise<void>;
	onQuestionCancel?: () => void;

	// Generic dismiss callback
	onDismissMessage?: () => void;
}

/**
 * A message renderer maps message types/subtypes to Svelte components.
 * Higher priority renderers are checked first.
 */
export interface MessageRenderer {
	/** The Svelte component to render this message type */
	component: Component<MessageRendererProps>;
	/** Function to match messages this renderer handles */
	match: (message: Message) => boolean;
	/** Higher priority = checked first (100 = highest, 0 = lowest) */
	priority: number;
	/** Name for debugging */
	name: string;
	/**
	 * The renderer draws a whole tool call by itself, so the transcript must
	 * not fold that call into a ToolGroup on its way past — see
	 * {@link import('./registry').standsAlone}. Only tool messages need this;
	 * nothing groups the other kinds.
	 */
	standalone?: boolean;
}

/**
 * Result from getRenderer - either a matched component or null for default handling
 */
export type RendererMatch = {
	component: Component<MessageRendererProps>;
	name: string;
} | null;

// Message Renderer Registry
// Maps SDK message types/subtypes to dedicated renderer components

// Types
export type { MessageRendererProps, MessageRenderer, RendererMatch } from './types';

// Registry functions
export { getRenderer, registerRenderer, getRegisteredRenderers } from './registry';

// Individual renderer components (for direct import if needed)
export { default as LoginPrompt } from './LoginPrompt.svelte';
export { default as ModelPicker } from './ModelPicker.svelte';
export { default as MemoryPicker } from './MemoryPicker.svelte';
export { default as CompactBoundary } from './CompactBoundary.svelte';
export { default as ThinkingBlock } from './ThinkingBlock.svelte';
export { default as ResultError } from './ResultError.svelte';

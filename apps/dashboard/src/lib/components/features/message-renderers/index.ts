// Message Renderer Registry
// Maps SDK message types/subtypes to dedicated renderer components

// Types
export type { MessageRendererProps, MessageRenderer, RendererMatch } from './types';

// Registry functions
export { getRenderer, registerRenderer, getRegisteredRenderers, standsAlone } from './registry';

// Individual renderer components (for direct import if needed)
export { default as CompactBoundary } from './CompactBoundary.svelte';
export { default as ThinkingBlock } from './ThinkingBlock.svelte';
export { default as ResultError } from './ResultError.svelte';
export { default as MCPStatus } from './MCPStatus.svelte';

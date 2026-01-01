/**
 * Type-safe API client using Eden Treaty
 */
import { treaty } from '@elysiajs/eden';
import type { App } from '@cockpit/hub-server';
import { HUB_URL } from './config';

// Create the Eden client with full type safety
export const api = treaty<App>(HUB_URL);

// Re-export for convenience
export type { App };
